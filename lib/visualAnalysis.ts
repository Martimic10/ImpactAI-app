import * as LegacyFS from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { SwingResult, VisualAnalysis, FrameAnalysis, SwingPhase, PoseLandmark } from '@/types';

const BUCKET = 'swing-videos';
const MEDIAPIPE_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

const PHASE_TIMES: Record<SwingPhase, number> = {
  setup:  200,
  top:    900,
  impact: 1600,
  finish: 2400,
};

const PHASE_LABELS: Record<SwingPhase, string> = {
  setup:  'Address',
  top:    'Top of Backswing',
  impact: 'Impact Zone',
  finish: 'Follow-Through',
};

function getVideoThumbnails() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-video-thumbnails');
    if (typeof mod?.getThumbnailAsync !== 'function') return null;
    return mod;
  } catch {
    return null;
  }
}

async function resolveLocalUri(videoUri: string, swingId: string): Promise<string> {
  if (!videoUri.startsWith('http')) {
    console.log('[visualAnalysis] using local URI directly');
    return videoUri;
  }
  const dest = `${LegacyFS.cacheDirectory}va_src_${swingId}.mp4`;
  try {
    const info = await LegacyFS.getInfoAsync(dest);
    if (info.exists) {
      console.log('[visualAnalysis] using cached local video');
      return dest;
    }
  } catch { /* proceed to download */ }

  console.log('[visualAnalysis] downloading video for frame extraction...');
  const { uri } = await LegacyFS.downloadAsync(videoUri, dest);
  console.log('[visualAnalysis] download complete:', uri.slice(0, 60));
  return uri;
}

function buildCoachingNotes(result: SwingResult): Record<SwingPhase, string> {
  const r = result.scoreReasoning;
  const issue = result.primaryIssue ?? 'swing issue';
  return {
    setup:  r?.setup ?? `Check your ${result.selectedClub ?? 'club'} setup — stance, grip, and ball position.`,
    top:    r?.swingPath ?? `At the top: ${issue.toLowerCase().includes('path') ? issue : 'evaluate your backswing plane and shoulder turn.'}`,
    impact: r?.contact ?? (result.contactPrediction ?? `Impact: ${result.ballFlightPrediction ?? 'focus on solid contact.'}`),
    finish: r?.balance ?? 'Hold a balanced finish — weight fully on lead foot, chest facing target.',
  };
}

// Returns { publicUrl, base64 } or null on failure
async function extractAndUploadFrame(
  localUri: string,
  userId: string,
  swingId: string,
  phase: SwingPhase
): Promise<{ publicUrl: string; base64: string } | null> {
  const VideoThumbnails = getVideoThumbnails();
  if (!VideoThumbnails) return null;

  try {
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(localUri, {
      time: PHASE_TIMES[phase],
      quality: 0.7,
    });

    const base64 = await LegacyFS.readAsStringAsync(thumbUri, { encoding: 'base64' });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const path = `${userId}/${swingId}_frame_${phase}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      console.warn(`[visualAnalysis] storage upload failed for ${phase}:`, error.message);
      return null;
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[visualAnalysis] frame uploaded: ${phase}`);
    return { publicUrl: data.publicUrl, base64 };
  } catch (e) {
    console.warn(`[visualAnalysis] frame extraction failed for ${phase}:`, e);
    return null;
  }
}

// Calls backend /analyze-frames with base64 images, returns per-frame landmarks (or nulls)
async function fetchLandmarks(base64Frames: (string | null)[]): Promise<(PoseLandmark[] | null)[]> {
  if (!MEDIAPIPE_URL) return base64Frames.map(() => null);
  try {
    const payload = base64Frames.map((f) => f ?? '');
    const res = await fetch(`${MEDIAPIPE_URL}/analyze-frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: payload }),
    });
    if (!res.ok) {
      console.warn('[visualAnalysis] /analyze-frames error:', res.status);
      return base64Frames.map(() => null);
    }
    const json = await res.json();
    return (json.frames ?? []) as (PoseLandmark[] | null)[];
  } catch (e) {
    console.warn('[visualAnalysis] /analyze-frames threw:', e);
    return base64Frames.map(() => null);
  }
}

export async function generateVisualAnalysis(
  videoUri: string,
  userId: string,
  swingId: string,
  result: SwingResult
): Promise<VisualAnalysis | null> {
  const VideoThumbnails = getVideoThumbnails();
  if (!VideoThumbnails) {
    console.warn('[visualAnalysis] expo-video-thumbnails unavailable — run `npx expo run:ios`');
    return null;
  }

  console.log('[visualAnalysis] resolving local URI from:', videoUri.slice(0, 60));

  let localUri: string;
  try {
    localUri = await resolveLocalUri(videoUri, swingId);
  } catch (e) {
    console.error('[visualAnalysis] failed to get local video:', e);
    return null;
  }

  const notes = buildCoachingNotes(result);
  const phases: SwingPhase[] = ['setup', 'top', 'impact', 'finish'];

  const frameResults = await Promise.all(
    phases.map((phase) => extractAndUploadFrame(localUri, userId, swingId, phase))
  );

  const successCount = frameResults.filter(Boolean).length;
  console.log(`[visualAnalysis] extracted ${successCount}/4 frames`);

  if (successCount < 2) {
    console.warn('[visualAnalysis] too few frames — aborting');
    return null;
  }

  // Optionally fetch pose landmarks from the MediaPipe backend
  const base64List = frameResults.map((r) => r?.base64 ?? null);
  const landmarkSets = await fetchLandmarks(base64List);
  console.log(`[visualAnalysis] landmarks fetched: ${landmarkSets.filter(Boolean).length}/4`);

  const analysis: VisualAnalysis = {
    setup:  buildFrame('setup',  frameResults[0]?.publicUrl ?? null, notes.setup,  landmarkSets[0]),
    top:    buildFrame('top',    frameResults[1]?.publicUrl ?? null, notes.top,    landmarkSets[1]),
    impact: buildFrame('impact', frameResults[2]?.publicUrl ?? null, notes.impact, landmarkSets[2]),
    finish: buildFrame('finish', frameResults[3]?.publicUrl ?? null, notes.finish, landmarkSets[3]),
  };

  return analysis;
}

function buildFrame(
  phase: SwingPhase,
  imageUrl: string | null,
  coachingNote: string,
  landmarks?: PoseLandmark[] | null
): FrameAnalysis {
  return {
    phase,
    imageUrl: imageUrl ?? '',
    label: PHASE_LABELS[phase],
    coachingNote,
    ...(landmarks && landmarks.length > 0 ? { landmarks } : {}),
  };
}

export async function saveVisualAnalysis(swingId: string, analysis: VisualAnalysis): Promise<void> {
  const { error } = await supabase
    .from('swings')
    .update({ visual_analysis: analysis })
    .eq('id', swingId);
  if (error) {
    console.error('[visualAnalysis] DB save failed:', error.message);
  } else {
    console.log('[visualAnalysis] saved to DB for swing', swingId);
  }
}
