import * as LegacyFS from 'expo-file-system/legacy';
import { SwingResult } from '@/types';
import { uploadSwingVideo } from '@/lib/supabase/storage';
import { extractFrames } from '@/lib/video';
import { analyzeSwingFrames } from '@/lib/openrouter';
import { MOCK_SWING_RESULT } from '@/lib/frames';
import { generateAndUploadThumbnail } from '@/lib/thumbnails';
import {
  fetchBackendResult,
  buildVisualAnalysisFromBackendResult,
} from '@/lib/visualAnalysis';
import { getSwingById, saveSwingThumbnail, updateSwingAnalysis } from '@/lib/swings';
import { supabase } from '@/lib/supabase';
import { getSwingPrivacy } from '@/lib/preferences';

async function downloadToLocal(remoteUrl: string, swingId: string): Promise<string> {
  const dest = `${LegacyFS.cacheDirectory}swing_${swingId}.mp4`;
  const { uri } = await LegacyFS.downloadAsync(remoteUrl, dest);
  return uri;
}

export type AnalysisStage =
  | 'uploading'
  | 'extracting'
  | 'analyzing'
  | 'saving'
  | 'done';

// Fine-grained progress milestone. Each emit advances the UI's percentage and
// updates the label. Use whole-number percentages — the UI interpolates between
// them smoothly with reanimated, so milestones can be sparse.
export interface AnalysisProgress {
  pct: number;
  label: string;
}

interface RunSwingAnalysisOptions {
  uri: string;
  userId: string;
  club?: string;
  // Coarse stage callback (back-compat).
  onStage?: (stage: AnalysisStage) => void;
  // Fine-grained progress with percentage + status label.
  onProgress?: (p: AnalysisProgress) => void;
}

const MEDIAPIPE_URL = process.env.EXPO_PUBLIC_MEDIAPIPE_URL ?? '';

function requestOverlay(swingId: string, videoUrl: string, userId: string) {
  if (!MEDIAPIPE_URL) return;
  fetch(`${MEDIAPIPE_URL}/process-overlay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ swing_id: swingId, video_url: videoUrl, user_id: userId }),
  }).catch((e) => console.warn('[overlay] request failed:', e));
}

const useMock = () =>
  !process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ||
  process.env.EXPO_PUBLIC_OPENROUTER_API_KEY === 'your_openrouter_api_key';

// ─── Unified backend analysis ─────────────────────────────────────────────────
// Calls /extract-key-frames once to get phase-aligned frames + temporal metrics,
// feeds them directly to the AI. Eliminates the separate /extract-frames call.
// Falls back to /extract-frames if the backend is unavailable.
interface FrameAnalysisResult {
  result: SwingResult;
  backendResult?: Awaited<ReturnType<typeof fetchBackendResult>>;
}

async function runFrameAnalysis(
  uri: string,
  club?: string,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<FrameAnalysisResult> {
  if (useMock()) {
    await new Promise((r) => setTimeout(r, 1200));
    return { result: { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub } };
  }

  // /extract-frames + /analyze-frames pipeline
  onProgress?.({ pct: 28, label: 'Reading frames…' });
  const backendResult = await fetchBackendResult(uri, club);
  const bfFrames = backendResult?.frames ?? [];
  const goodFrames = bfFrames.filter((f) => f.frame);

  let frames: string[];
  let landmarks: Parameters<typeof analyzeSwingFrames>[4] | undefined;
  if (goodFrames.length >= 2) {
    frames = goodFrames.map((f) => f.frame!);
    if (bfFrames.length === 4) {
      landmarks = {
        setup:  bfFrames[0]?.landmarks ?? null,
        top:    bfFrames[1]?.landmarks ?? null,
        impact: bfFrames[2]?.landmarks ?? null,
        finish: bfFrames[3]?.landmarks ?? null,
      };
    }
    console.log(`[analysis] using ${frames.length} phase-aligned backend frames` +
      (landmarks ? ' with landmarks' : ''));
  } else {
    frames = await extractFrames(uri);
    console.log(`[analysis] fallback: ${frames.length} frames, sizes: ${frames.slice(0, 3).map(f => f.length).join(',')}`);
  }

  if (frames.length === 0) {
    console.warn('[analysis] No frames — using mock result');
    return { result: { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub } };
  }

  onProgress?.({ pct: 58, label: 'Coaching with AI…' });
  const metrics = goodFrames.length >= 2 ? (backendResult?.metrics ?? undefined) : undefined;
  const result = await analyzeSwingFrames(frames, club, undefined, metrics ?? undefined, landmarks);
  return { result, backendResult: goodFrames.length >= 2 ? backendResult : undefined };
}

// ── New swing analysis ─────────────────────────────────────────────────────
export async function runSwingAnalysis({
  uri,
  userId,
  club,
  onStage,
  onProgress,
}: RunSwingAnalysisOptions): Promise<{ swingId: string; result: SwingResult }> {
  const notify = (s: AnalysisStage) => onStage?.(s);
  const progress = (pct: number, label: string) => onProgress?.({ pct, label });

  // 1. Fire upload + frame extraction in parallel. Both read the local video
  //    file and both have meaningful latency (~3-8s for upload, ~4-6s for the
  //    backend frame pipeline). Running them sequentially was wasting ~30%
  //    of the wall-clock; running them concurrently saves that flat.
  progress(6, 'Preparing…');
  notify('uploading');
  const tempId = `${userId}-${Date.now()}`;

  progress(14, 'Uploading video…');
  const uploadStart = Date.now();
  const uploadPromise: Promise<string> = uploadSwingVideo(uri, userId, tempId)
    .then((url) => {
      console.log(`[analysis] upload done in ${Date.now() - uploadStart}ms`);
      return url;
    })
    .catch((e) => {
      console.warn('[analysis] upload failed, using local URI:', e);
      return uri;
    });

  progress(22, 'Reading frames…');
  notify('extracting');
  notify('analyzing');
  const analysisPromise = runFrameAnalysis(uri, club, (p) => progress(p.pct, p.label));

  const [videoUrl, { result, backendResult }] = await Promise.all([
    uploadPromise,
    analysisPromise,
  ]);

  // 3. Save to DB
  progress(86, 'Saving results…');
  notify('saving');

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Not authenticated — please sign in again.');

  const privacy = await getSwingPrivacy();

  let data: { id: string } | null = null;
  let error: { message: string } | null = null;

  ({ data, error } = await supabase
    .from('swings')
    .insert({
      user_id: userId,
      video_url: videoUrl,
      club: club ?? null,
      status: 'completed',
      result_json: result,
      privacy,
      last_analyzed_at: new Date().toISOString(),
    })
    .select('id')
    .single());

  if (error) {
    ({ data, error } = await supabase
      .from('swings')
      .insert({ user_id: userId, video_url: videoUrl, result_json: result, privacy })
      .select('id')
      .single());
  }

  if (error || !data) {
    throw new Error(`Save failed: ${error?.message ?? 'no data'}`);
  }

  const swingId = data.id;
  progress(94, 'Finalizing…');

  // 4. Thumbnail + visual analysis save run in background — don't block the
  //    UI on these. The user already has their swing record; these light up
  //    asynchronously when their detail page mounts.
  generateAndUploadThumbnail(uri, userId, swingId)
    .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
    .catch(() => {});

  if (backendResult) {
    buildVisualAnalysisFromBackendResult(backendResult, swingId, userId, result, uri)
      .then((va) => {
        if (va) console.log('[analysis] visual analysis saved inline for', swingId);
      })
      .catch((e) => console.warn('[analysis] inline VA save failed:', e));
  }

  if (MEDIAPIPE_URL && videoUrl !== uri && data) {
    requestOverlay(swingId, videoUrl, userId);
  }

  progress(100, 'Done');
  notify('done');
  return { swingId, result };
}

// ── Re-analyze existing swing ──────────────────────────────────────────────
export async function reanalyzeSwing(
  swingId: string,
  userId: string,
  onStage?: (stage: AnalysisStage) => void,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<SwingResult> {
  const notify = (s: AnalysisStage) => onStage?.(s);
  const progress = (pct: number, label: string) => onProgress?.({ pct, label });

  progress(5, 'Loading swing…');
  const swing = await getSwingById(swingId);
  if (!swing) throw new Error('Swing not found.');
  if (swing.user_id !== userId) throw new Error('Unauthorized.');

  progress(12, 'Fetching video…');
  notify('extracting');
  let localUri = swing.video_url;
  if (swing.video_url.startsWith('http')) {
    try { localUri = await downloadToLocal(swing.video_url, swingId); } catch { /* use remote URL */ }
  }

  progress(22, 'Reading frames…');
  notify('analyzing');
  const { result, backendResult } = await runFrameAnalysis(localUri, swing.club, (p) =>
    progress(p.pct, p.label),
  );

  progress(86, 'Saving results…');
  notify('saving');
  await updateSwingAnalysis(swingId, result, swing.analysis_version ?? 1);

  if (!swing.thumbnail_url) {
    generateAndUploadThumbnail(localUri, userId, swingId)
      .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
      .catch(() => {});
  }

  if (backendResult) {
    buildVisualAnalysisFromBackendResult(backendResult, swingId, userId, result, localUri)
      .catch(() => {});
  }

  progress(100, 'Done');
  notify('done');
  return result;
}
