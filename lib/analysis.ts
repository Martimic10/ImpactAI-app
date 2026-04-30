import * as LegacyFS from 'expo-file-system/legacy';
import { SwingResult } from '@/types';
import { uploadSwingVideo } from '@/lib/supabase/storage';
import { extractFrames } from '@/lib/video';
import { analyzeSwingFrames } from '@/lib/openrouter';
import { MOCK_SWING_RESULT } from '@/lib/frames';
import { generateAndUploadThumbnail } from '@/lib/thumbnails';
import { generateVisualAnalysis, saveVisualAnalysis } from '@/lib/visualAnalysis';
import { getSwingById, saveSwingThumbnail, updateSwingAnalysis } from '@/lib/swings';
import { supabase } from '@/lib/supabase';

// Download a remote video to the local cache so VideoThumbnails can read it
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

async function runFrameAnalysis(uri: string, club?: string): Promise<SwingResult> {
  if (useMock()) {
    await new Promise((r) => setTimeout(r, 1200));
    return { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub };
  }
  const frames = await extractFrames(uri);
  if (frames.length === 0) {
    console.warn('[analysis] No frames — using mock result');
    return { ...MOCK_SWING_RESULT, selectedClub: club ?? MOCK_SWING_RESULT.selectedClub };
  }
  return analyzeSwingFrames(frames, club);
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

  // 2. Analyze
  notify('extracting');
  notify('analyzing');
  const result = await runFrameAnalysis(uri, club);

  // 3. Save to DB
  notify('saving');

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Not authenticated — please sign in again.');

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
      privacy: 'private',
      last_analyzed_at: new Date().toISOString(),
    })
    .select('id')
    .single());

  if (error) {
    ({ data, error } = await supabase
      .from('swings')
      .insert({ user_id: userId, video_url: videoUrl, result_json: result, privacy: 'private' })
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

  // 5. Generate visual analysis — prefer Supabase URL so backend can download it
  generateVisualAnalysis(videoUrl, userId, swingId, result)
    .then((va) => { if (va) saveVisualAnalysis(swingId, va); })
    .catch(() => {});

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
  // Download remote video locally so VideoThumbnails can extract real frames
  let localUri = swing.video_url;
  if (swing.video_url.startsWith('http')) {
    try { localUri = await downloadToLocal(swing.video_url, swingId); } catch { /* use remote URL */ }
  }

  notify('analyzing');
  const result = await runFrameAnalysis(localUri, swing.club);

  notify('saving');
  await updateSwingAnalysis(swingId, result, swing.analysis_version ?? 1);

  // Regenerate thumbnail if missing
  if (!swing.thumbnail_url) {
    generateAndUploadThumbnail(localUri, userId, swingId)
      .then((url) => { if (url) saveSwingThumbnail(swingId, url); })
      .catch(() => {});
  }

  // Regenerate visual analysis
  generateVisualAnalysis(localUri, userId, swingId, result)
    .then((va) => { if (va) saveVisualAnalysis(swingId, va); })
    .catch(() => {});

  notify('done');
  return result;
}
