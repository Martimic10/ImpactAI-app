import * as LegacyFS from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { SwingResult, VisualAnalysis, FrameAnalysis, SwingPhase, PoseLandmark } from '@/types';

const BUCKET = 'swing-videos';
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
export const VISUAL_ANALYSIS_VERSION = 6;

const FALLBACK_PHASE_TIMES_MS: Record<SwingPhase, number> = {
  setup:  200,
  top:    1400,
  impact: 2600,
  finish: 3400,
};

const PHASE_LABELS: Record<SwingPhase, string> = {
  setup:  'Address',
  top:    'Top of Backswing',
  impact: 'Impact Zone',
  finish: 'Follow-Through',
};

const PHASES: SwingPhase[] = ['setup', 'top', 'impact', 'finish'];

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

// ─── Backend path (preferred) ────────────────────────────────────────────────
// Calls /extract-key-frames on Render — downloads the video server-side,
// extracts 4 frames + runs MediaPipe pose detection, returns everything in one go.
// Works in Expo Go with zero native build required.

interface BackendFrameResult {
  frame: string | null;       // base64 JPEG
  overlay_frame?: string | null;
  landmarks: PoseLandmark[] | null;
  time_ms?: number;
}

async function extractViaBackend(
  videoUrl: string
): Promise<BackendFrameResult[] | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/extract-key-frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl }),
    });
    if (!res.ok) {
      console.warn('[visualAnalysis] backend /extract-key-frames error:', res.status);
      return null;
    }
    const json = await res.json();
    return (json.frames ?? []) as BackendFrameResult[];
  } catch (e) {
    console.warn('[visualAnalysis] backend call threw:', e);
    return null;
  }
}

async function uploadFrame(
  base64: string,
  userId: string,
  swingId: string,
  phase: string
): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const path = `${userId}/${swingId}_v${VISUAL_ANALYSIS_VERSION}_frame_${phase}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.warn(`[visualAnalysis] upload failed for ${phase}:`, error.message);
      return null;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.warn(`[visualAnalysis] upload threw for ${phase}:`, e);
    return null;
  }
}

// Sends the local video file directly to the backend (for file:// URIs)
async function extractViaBackendUpload(
  localUri: string
): Promise<BackendFrameResult[] | null> {
  try {
    const formData = new FormData();
    formData.append('video', {
      uri: localUri,
      name: 'swing.mp4',
      type: 'video/mp4',
    } as unknown as Blob);

    const res = await fetch(`${BACKEND_URL}/extract-key-frames-upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      console.warn('[visualAnalysis] backend upload error:', res.status);
      return null;
    }
    const json = await res.json();
    return (json.frames ?? []) as BackendFrameResult[];
  } catch (e) {
    console.warn('[visualAnalysis] backend upload threw:', e);
    return null;
  }
}

// ─── Local fallback (expo-video-thumbnails) ──────────────────────────────────
// Only used when no backend URL is configured. Requires native build.

function getVideoThumbnails() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-video-thumbnails');
    return typeof mod?.getThumbnailAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
}

async function resolveLocalUri(videoUri: string, swingId: string): Promise<string> {
  if (!videoUri.startsWith('http')) return videoUri;
  const dest = `${LegacyFS.cacheDirectory}va_src_${swingId}.mp4`;
  try {
    const info = await LegacyFS.getInfoAsync(dest);
    if (info.exists) return dest;
  } catch { /* proceed */ }
  const { uri } = await LegacyFS.downloadAsync(videoUri, dest);
  return uri;
}

async function extractViaLocal(
  videoUri: string,
  userId: string,
  swingId: string
): Promise<{ publicUrl: string | null; base64: string | null }[]> {
  const VideoThumbnails = getVideoThumbnails();
  if (!VideoThumbnails) {
    console.warn('[visualAnalysis] expo-video-thumbnails unavailable');
    return PHASES.map(() => ({ publicUrl: null, base64: null }));
  }

  const localUri = await resolveLocalUri(videoUri, swingId);
  return Promise.all(
    PHASES.map(async (phase) => {
      try {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(localUri, {
          time: FALLBACK_PHASE_TIMES_MS[phase],
          quality: 0.7,
        });
        const base64 = await LegacyFS.readAsStringAsync(thumbUri, { encoding: 'base64' });
        const publicUrl = await uploadFrame(base64, userId, swingId, phase);
        return { publicUrl, base64 };
      } catch (e) {
        console.warn(`[visualAnalysis] local extraction failed for ${phase}:`, e);
        return { publicUrl: null, base64: null };
      }
    })
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateVisualAnalysis(
  videoUri: string,
  userId: string,
  swingId: string,
  result: SwingResult
): Promise<VisualAnalysis | null> {
  const notes = buildCoachingNotes(result);

  // Prefer backend — works in Expo Go, handles frames + landmarks in one call
  if (BACKEND_URL) {
    console.log('[visualAnalysis] using backend extraction for', swingId);
    const backendFrames = videoUri.startsWith('http')
      ? await extractViaBackend(videoUri)
      : await extractViaBackendUpload(videoUri);

    if (backendFrames && backendFrames.length === 4) {
      const successCount = backendFrames.filter((f: BackendFrameResult) => f.frame).length;
      console.log(`[visualAnalysis] backend returned ${successCount}/4 frames`);

      if (successCount < 2) {
        console.warn('[visualAnalysis] too few frames from backend');
        return null;
      }

      // Upload frames to Supabase storage in parallel
      const uploadedUrls = await Promise.all(
        PHASES.map((phase, i) => {
          const f = backendFrames[i];
          return f.frame ? uploadFrame(f.frame, userId, swingId, phase) : Promise.resolve(null);
        })
      );
      const uploadedOverlayUrls = await Promise.all(
        PHASES.map((phase, i) => {
          const f = backendFrames[i];
          return f.overlay_frame ? uploadFrame(f.overlay_frame, userId, swingId, `${phase}_overlay`) : Promise.resolve(null);
        })
      );

      const landmarkCount = backendFrames.filter((f: BackendFrameResult) => f.landmarks).length;
      console.log(`[visualAnalysis] landmarks detected: ${landmarkCount}/4`);

      return {
        setup:  buildFrame('setup',  uploadedUrls[0], notes.setup,  backendFrames[0]?.landmarks, uploadedOverlayUrls[0], backendFrames[0]?.time_ms),
        top:    buildFrame('top',    uploadedUrls[1], notes.top,    backendFrames[1]?.landmarks, uploadedOverlayUrls[1], backendFrames[1]?.time_ms),
        impact: buildFrame('impact', uploadedUrls[2], notes.impact, backendFrames[2]?.landmarks, uploadedOverlayUrls[2], backendFrames[2]?.time_ms),
        finish: buildFrame('finish', uploadedUrls[3], notes.finish, backendFrames[3]?.landmarks, uploadedOverlayUrls[3], backendFrames[3]?.time_ms),
      };
    }
    // Backend is configured but failed — return null rather than falling back to
    // local extraction which has no landmarks and would overwrite good data.
    console.warn('[visualAnalysis] backend failed — not falling back to local (would lose landmarks)');
    return null;
  }

  // Local fallback — only used when no backend URL is configured at all
  console.log('[visualAnalysis] using local extraction for', swingId);
  try {
    const localFrames = await extractViaLocal(videoUri, userId, swingId);
    const successCount = localFrames.filter((f) => f.publicUrl).length;
    console.log(`[visualAnalysis] local extracted ${successCount}/4 frames`);
    if (successCount < 2) return null;

    return {
      setup:  buildFrame('setup',  localFrames[0].publicUrl, notes.setup),
      top:    buildFrame('top',    localFrames[1].publicUrl, notes.top),
      impact: buildFrame('impact', localFrames[2].publicUrl, notes.impact),
      finish: buildFrame('finish', localFrames[3].publicUrl, notes.finish),
    };
  } catch (e) {
    console.error('[visualAnalysis] local extraction threw:', e);
    return null;
  }
}

function buildFrame(
  phase: SwingPhase,
  imageUrl: string | null,
  coachingNote: string,
  landmarks?: PoseLandmark[] | null,
  overlayImageUrl?: string | null,
  timeMs?: number
): FrameAnalysis {
  return {
    phase,
    imageUrl: imageUrl ?? '',
    ...(overlayImageUrl ? { overlayImageUrl } : {}),
    ...(typeof timeMs === 'number' ? { timeMs } : {}),
    label: PHASE_LABELS[phase],
    coachingNote,
    ...(landmarks && landmarks.length > 0 ? { landmarks } : {}),
  };
}

export async function saveVisualAnalysis(swingId: string, analysis: VisualAnalysis): Promise<void> {
  const { error } = await supabase
    .from('swings')
    .update({ visual_analysis: analysis, analysis_version: VISUAL_ANALYSIS_VERSION })
    .eq('id', swingId);
  if (error) {
    console.error('[visualAnalysis] DB save failed:', error.message);
  } else {
    console.log('[visualAnalysis] saved to DB for swing', swingId);
  }
}
