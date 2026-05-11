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

interface RunSwingAnalysisOptions {
  uri: string;
  userId: string;
  club?: string;
  onStage?: (stage: AnalysisStage) => void;
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

async function runFrameAnalysis(uri: string, club?: string): Promise<FrameAnalysisResult> {
  if (useMock()) {
    await new Promise((r) => setTimeout(r, 1200));
    return { result: { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub } };
  }

  // Try the phase-detection backend first — gives us temporal metrics for the AI
  const backendResult = await fetchBackendResult(uri, club);
  const goodFrames = backendResult?.frames.filter((f) => f.frame) ?? [];

  let frames: string[];
  if (goodFrames.length >= 2) {
    frames = goodFrames.map((f) => f.frame!);
    console.log(`[analysis] using ${frames.length} phase-aligned backend frames`);
  } else {
    // Fallback: evenly-spaced frames via /extract-frames (no temporal metrics)
    frames = await extractFrames(uri);
    console.log(`[analysis] fallback: ${frames.length} frames, sizes: ${frames.slice(0, 3).map(f => f.length).join(',')}`);
  }

  if (frames.length === 0) {
    console.warn('[analysis] No frames — using mock result');
    return { result: { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub } };
  }

  const metrics = goodFrames.length >= 2 ? (backendResult?.metrics ?? undefined) : undefined;
  const result = await analyzeSwingFrames(frames, club, undefined, metrics ?? undefined);
  return { result, backendResult: goodFrames.length >= 2 ? backendResult : undefined };
}

// ── New swing analysis ─────────────────────────────────────────────────────
export async function runSwingAnalysis({
  uri,
  userId,
  club,
  onStage,
}: RunSwingAnalysisOptions): Promise<{ swingId: string; result: SwingResult }> {
  const notify = (s: AnalysisStage) => onStage?.(s);

  // 1. Upload video
  notify('uploading');
  let videoUrl = uri;
  try {
    const tempId = `${userId}-${Date.now()}`;
    videoUrl = await uploadSwingVideo(uri, userId, tempId);
  } catch {
    // non-fatal — continue with local URI
  }

  // 2. Analyze (phase frames + temporal metrics + AI in one shot)
  notify('extracting');
  notify('analyzing');
  const { result, backendResult } = await runFrameAnalysis(uri, club);

  // 3. Save to DB
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

  // 4. Generate thumbnail (non-blocking)
  generateAndUploadThumbnail(uri, userId, swingId)
    .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
    .catch(() => {});

  // 5. Save visual analysis immediately from the backend result we already have.
  //    This avoids a second backend call when the user opens the swing detail.
  if (backendResult) {
    buildVisualAnalysisFromBackendResult(backendResult, swingId, userId, result)
      .then((va) => {
        if (va) console.log('[analysis] visual analysis saved inline for', swingId);
      })
      .catch((e) => console.warn('[analysis] inline VA save failed:', e));
  }

  // 6. MediaPipe overlay (non-blocking)
  if (MEDIAPIPE_URL && videoUrl !== uri && data) {
    requestOverlay(swingId, videoUrl, userId);
  }

  notify('done');
  return { swingId, result };
}

// ── Re-analyze existing swing ──────────────────────────────────────────────
export async function reanalyzeSwing(
  swingId: string,
  userId: string,
  onStage?: (stage: AnalysisStage) => void
): Promise<SwingResult> {
  const notify = (s: AnalysisStage) => onStage?.(s);

  const swing = await getSwingById(swingId);
  if (!swing) throw new Error('Swing not found.');
  if (swing.user_id !== userId) throw new Error('Unauthorized.');

  notify('extracting');
  let localUri = swing.video_url;
  if (swing.video_url.startsWith('http')) {
    try { localUri = await downloadToLocal(swing.video_url, swingId); } catch { /* use remote URL */ }
  }

  notify('analyzing');
  const { result, backendResult } = await runFrameAnalysis(localUri, swing.club);

  notify('saving');
  await updateSwingAnalysis(swingId, result, swing.analysis_version ?? 1);

  if (!swing.thumbnail_url) {
    generateAndUploadThumbnail(localUri, userId, swingId)
      .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
      .catch(() => {});
  }

  // Regenerate visual analysis from the already-fetched backend result
  if (backendResult) {
    buildVisualAnalysisFromBackendResult(backendResult, swingId, userId, result)
      .catch(() => {});
  }

  notify('done');
  return result;
}
