import * as LegacyFS from 'expo-file-system/legacy';
import { SwingResult } from '@/types';
import { uploadSwingVideo } from '@/lib/supabase/storage';
import { extractFrames } from '@/lib/video';
import { extractCoachingFrames, pickCoachingFramesForLlm, MOCK_SWING_RESULT } from '@/lib/frames';
import { analyzeSwingFrames } from '@/lib/openrouter';
import { generateAndUploadThumbnail, prefetchSwingThumbnail } from '@/lib/thumbnails';
import {
  fetchBackendResult,
  buildVisualAnalysisFromBackendResult,
} from '@/lib/visualAnalysis';
import { getSwingById, saveSwingThumbnail, updateSwingAnalysis } from '@/lib/swings';
import { supabase } from '@/lib/supabase';
import { getSwingPrivacy } from '@/lib/preferences';
import { notifySwingDataUpdates } from '@/lib/swingDataUpdates';
import { assertVideoFileReadable } from '@/lib/verifyVideoFile';
import { DEV_MODE } from '@/lib/devMode';
import { runWithProgressTicks } from '@/lib/analysisProgress';

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

const useMock = () =>
  !process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ||
  process.env.EXPO_PUBLIC_OPENROUTER_API_KEY === 'your_openrouter_api_key';

interface FrameAnalysisResult {
  result: SwingResult;
}

/** Rich phase overlays + landmarks — runs after the user sees coaching results. */
function scheduleRichVisualAnalysis(
  swingId: string,
  userId: string,
  uri: string,
  club: string | undefined,
  result: SwingResult,
) {
  if (!process.env.EXPO_PUBLIC_BACKEND_URL) return;

  void (async () => {
    const t0 = Date.now();
    try {
      console.log('[analysis] background visual analysis start', swingId);
      const backendResult = await fetchBackendResult(uri, club);
      if (!backendResult) return;
      await buildVisualAnalysisFromBackendResult(backendResult, swingId, userId, result, uri);
      console.log(`[analysis] background visual analysis done in ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn('[analysis] background visual analysis failed:', e);
    }
  })();
}

/**
 * Fast coaching path: one small frame extract + LLM.
 * Skips pose tracking and 75-frame dense pipeline during the loading screen.
 */
async function runFrameAnalysis(
  uri: string,
  club?: string,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<FrameAnalysisResult> {
  if (useMock()) {
    await new Promise((r) => setTimeout(r, 400));
    return { result: { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub } };
  }

  const extractStart = Date.now();
  onProgress?.({ pct: 14, label: 'Reading swing…' });

  let rawFrames: string[] = [];
  try {
    rawFrames = await runWithProgressTicks(
      onProgress,
      14,
      48,
      'Extracting key frames…',
      () => extractCoachingFrames(uri),
      200,
    );
  } catch (e) {
    console.warn('[analysis] coaching extract failed, trying fallback:', e);
  }

  if (rawFrames.length < 2) {
    onProgress?.({ pct: 36, label: 'Extracting frames…' });
    rawFrames = await runWithProgressTicks(
      onProgress,
      36,
      50,
      'Extracting frames…',
      () => extractFrames(uri),
      180,
    );
  }

  const frames = pickCoachingFramesForLlm(rawFrames);
  console.log(
    `[analysis] coaching frames: ${frames.length} for LLM (${rawFrames.length} extracted) in ${Date.now() - extractStart}ms`,
  );

  if (frames.length === 0) {
    console.warn('[analysis] No frames — using mock result');
    return { result: { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub } };
  }

  onProgress?.({ pct: 52, label: 'Coaching with AI…' });

  const coachStart = Date.now();
  const result = await runWithProgressTicks(
    onProgress,
    54,
    88,
    'Coaching with AI…',
    () => analyzeSwingFrames(frames, club),
    220,
  );
  console.log(`[analysis] LLM coaching done in ${Date.now() - coachStart}ms`);

  return { result };
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

  console.log('[analysis] runSwingAnalysis start', {
    userId,
    club: club ?? '(none)',
    uriPrefix: uri.slice(0, 60),
    mock: useMock(),
    backend: Boolean(process.env.EXPO_PUBLIC_BACKEND_URL),
  });

  progress(2, 'Checking video…');
  await assertVideoFileReadable(uri);

  const totalStart = Date.now();
  progress(4, 'Preparing…');
  notify('uploading');
  const tempId = `${userId}-${Date.now()}`;

  // Start upload in background — coaching only needs the local file.
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

  notify('extracting');
  notify('analyzing');
  progress(12, 'Analyzing swing…');

  const analysisOut = await runFrameAnalysis(uri, club, (p) => progress(p.pct, p.label)).catch(
    (err) => {
      console.error('[analysis] frame analysis failed:', err);
      throw err;
    },
  );
  const result = analysisOut.result;

  progress(82, 'Saving video…');
  const videoUrl = await uploadPromise;
  console.log(`[analysis] coaching pipeline done in ${Date.now() - totalStart}ms`);

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
  prefetchSwingThumbnail(swingId, uri);
  notifySwingDataUpdates();

  progress(94, 'Finalizing…');

  // 4. Thumbnail + visual analysis save run in background — don't block the
  //    UI on these. The user already has their swing record; these light up
  //    asynchronously when their detail page mounts.
  generateAndUploadThumbnail(uri, userId, swingId)
    .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
    .catch(() => {});

  scheduleRichVisualAnalysis(swingId, userId, uri, club, result);

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
  const { result } = await runFrameAnalysis(localUri, swing.club, (p) => progress(p.pct, p.label));

  progress(86, 'Saving results…');
  notify('saving');
  await updateSwingAnalysis(swingId, result, swing.analysis_version ?? 1);

  if (!swing.thumbnail_url) {
    generateAndUploadThumbnail(localUri, userId, swingId)
      .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
      .catch(() => {});
  }

  scheduleRichVisualAnalysis(swingId, userId, localUri, swing.club, result);

  progress(100, 'Done');
  notify('done');
  return result;
}
