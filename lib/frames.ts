// Frame extraction utilities.
//
// Two distinct extraction modes are supported, because AI coaching and
// visual phase detection have very different needs:
//
//   • "analysis"        → 6–8 evenly-spaced frames for OpenRouter coaching.
//                         Cheap, fast, low bandwidth. Token-friendly.
//
//   • "phaseDetection"  → 60–90 evenly-spaced frames for selecting
//                         Address / Top / Impact / Follow-Through.
//                         Dense enough to distinguish top vs. impact.
//
// IMPORTANT: never feed phaseDetection frames into the coaching model.
// The cost would explode and the model doesn't need 75 frames to coach.

export type FrameExtractionMode = 'analysis' | 'phaseDetection';

export interface ExtractFramesOptions {
  mode?: FrameExtractionMode;
  frameCount?: number;
}

// Video metadata returned alongside the dense frame array. The client uses
// these to map a picked frame's index in the returned array back to its real
// timestamp in the source video — required for accurate tempo metrics.
export interface ExtractFramesMeta {
  fps: number;
  totalFrames: number;
  durationMs: number;
  // Fraction of total_frames the backend trimmed off head/tail before
  // sampling. For phaseDetection that's [0.02, 0.98]; for analysis [0.08, 0.92].
  loPct: number;
  hiPct: number;
  // Per-sampled-frame motion energy (grayscale absdiff mean). motion[0] = 0.
  // Only populated for phaseDetection mode; used by the burst-anchored phase
  // picker to find Address/Top/Impact/Finish even when the swing happens at
  // non-standard timing within the video.
  motion?: number[];
  // Audio-derived impact location. The clubface-on-ball click is the most
  // precise temporal signal in a swing recording (±1 frame); when present,
  // the dense-frame phase picker anchors impact here instead of relying on
  // motion-burst heuristics. Null/undefined when the backend doesn't have
  // ffmpeg, the audio is silent, or no clear peak was found.
  audioImpact?: {
    frameIdx: number;     // index in the source video's frame space
    denseIdx: number;     // index in the returned dense frames array (-1 if outside)
    timeMs: number;
    confidence: number;   // 0..1, log-scaled peak-to-median ratio
    peakToMedianRatio: number;
  };
}

export interface ExtractFramesResult {
  frames: string[];
  meta: ExtractFramesMeta | null;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

const ANALYSIS_DEFAULT_FRAMES = 8;
const PHASE_DETECTION_DEFAULT_FRAMES = 75;

// Hard caps prevent accidentally requesting absurd counts that would
// blow up bandwidth or run the model out of context.
const ANALYSIS_MIN_FRAMES = 4;
const ANALYSIS_MAX_FRAMES = 12;
const PHASE_DETECTION_MIN_FRAMES = 24;
const PHASE_DETECTION_MAX_FRAMES = 120;

function clampFrameCount(mode: FrameExtractionMode, requested: number): number {
  if (mode === 'phaseDetection') {
    return Math.max(PHASE_DETECTION_MIN_FRAMES, Math.min(PHASE_DETECTION_MAX_FRAMES, requested));
  }
  return Math.max(ANALYSIS_MIN_FRAMES, Math.min(ANALYSIS_MAX_FRAMES, requested));
}

export async function extractFramesFromVideo(
  videoUri: string,
  options: ExtractFramesOptions = {}
): Promise<string[]> {
  const { frames } = await extractFramesFromVideoWithMeta(videoUri, options);
  return frames;
}

export async function extractFramesFromVideoWithMeta(
  videoUri: string,
  options: ExtractFramesOptions = {}
): Promise<ExtractFramesResult> {
  const mode: FrameExtractionMode = options.mode ?? 'analysis';
  const requested =
    options.frameCount ??
    (mode === 'phaseDetection' ? PHASE_DETECTION_DEFAULT_FRAMES : ANALYSIS_DEFAULT_FRAMES);
  const frameCount = clampFrameCount(mode, requested);

  console.log(`[frames] extract mode=${mode} requested=${requested} clamped=${frameCount}`);

  if (!BACKEND_URL) {
    console.log('[frames] no BACKEND_URL — returning mock frames');
    return { frames: getMockFrames(frameCount), meta: null };
  }

  const formData = new FormData();
  formData.append('video', {
    uri: videoUri,
    name: 'swing.mp4',
    type: 'video/mp4',
  } as unknown as Blob);
  formData.append('mode', mode);
  formData.append('frameCount', String(frameCount));

  // NOTE: don't set Content-Type manually — RN needs to inject the
  // multipart boundary itself, and overriding the header silently
  // breaks the upload on some platforms.
  const response = await fetch(`${BACKEND_URL}/extract-frames`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Frame extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const frames = (data.frames ?? []) as string[];

  const ai = data.audio_impact;
  const audioImpact = ai && typeof ai === 'object' && Number.isFinite(ai.frameIdx)
    ? {
        frameIdx: Number(ai.frameIdx),
        denseIdx: Number.isFinite(ai.denseIdx) ? Number(ai.denseIdx) : -1,
        timeMs: Number(ai.timeMs) || 0,
        confidence: Number(ai.confidence) || 0,
        peakToMedianRatio: Number(ai.peakToMedianRatio) || 0,
      }
    : undefined;

  const meta: ExtractFramesMeta | null = data.total_frames
    ? {
        fps: Number(data.fps) || 30,
        totalFrames: Number(data.total_frames) || 0,
        durationMs: Number(data.duration_ms) || 0,
        loPct: typeof data.lo_pct === 'number' ? data.lo_pct : (mode === 'phaseDetection' ? 0.02 : 0.08),
        hiPct: typeof data.hi_pct === 'number' ? data.hi_pct : (mode === 'phaseDetection' ? 0.98 : 0.92),
        motion: Array.isArray(data.motion) ? (data.motion as number[]) : undefined,
        audioImpact,
      }
    : null;

  console.log(
    `[frames] backend returned ${frames.length} frames (mode=${mode})` +
      (meta ? ` fps=${meta.fps.toFixed(1)} dur=${meta.durationMs}ms` : '') +
      (meta?.motion ? ` motion=${meta.motion.length}pts` : '') +
      (meta?.audioImpact
        ? ` audio_impact_dense=${meta.audioImpact.denseIdx} conf=${meta.audioImpact.confidence.toFixed(2)}`
        : ''),
  );
  return { frames, meta };
}

function getMockFrames(count: number = ANALYSIS_DEFAULT_FRAMES): string[] {
  return Array(count).fill('');
}

// Map a picked dense-frame array index back to the source video frame index.
// Dense samples are evenly spaced across [loPct, hiPct] of total_frames.
export function denseIndexToVideoFrameIndex(
  denseIdx: number,
  pickedCount: number,
  meta: ExtractFramesMeta,
): number {
  if (pickedCount <= 1 || meta.totalFrames <= 0) return 0;
  const span = meta.hiPct - meta.loPct;
  const frac = meta.loPct + (denseIdx / (pickedCount - 1)) * span;
  return Math.round(frac * meta.totalFrames);
}

export function denseIndexToTimeMs(
  denseIdx: number,
  pickedCount: number,
  meta: ExtractFramesMeta,
): number {
  if (meta.fps <= 0) return 0;
  const fi = denseIndexToVideoFrameIndex(denseIdx, pickedCount, meta);
  return Math.round((fi / meta.fps) * 1000);
}

export const MOCK_SWING_RESULT = {
  selectedClub: 'Driver',
  detectedClubType: 'Driver',
  clubMatch: 'match' as const,
  clubMatchReason: 'Club appears long with a large head consistent with a driver.',
  cameraAngle: 'down-the-line' as const,
  scores: {
    overallScore: 58,
    positionScore: 72,
    tempoScore: 70,
    sequenceScore: 42,
    stabilityScore: 63,
    contactScore: 51,
    confidence: 8,
  },
  evidence: [
    'From the down-the-line view, the club appears to approach steeply from outside the ball line.',
    'The transition appears to start with the shoulders before the lower body has cleared.',
    'Finish position shows the weight is not fully on the lead side.',
  ],
  scoreReasoning: {
    setup: 'Stance width looks appropriate for driver. Ball position appears slightly too far back which can promote a steeper attack angle.',
    posture: 'Good spine angle at address but some early extension visible approaching impact, reducing the ability to deliver the club on plane.',
    swingPath: 'Clear outside-in path visible from the downswing frames. Club approaches significantly from above and outside the target line.',
    tempo: 'Backswing pace is reasonable but the transition is abrupt — the downswing starts before the backswing is complete.',
    balance: 'Some lateral sway in the backswing. Finish position shows weight forward but not fully on the lead side.',
    contact: 'Steep angle of attack with an outside-in path strongly suggests heel-biased contact and a pull-fade or slice ball flight.',
  },
  primaryIssue: 'Over the top swing path',
  issueCategory: 'path',
  whyItHappens: 'Your downswing starts with the shoulders before the hips clear, causing the club to attack from outside the target line. This creates a steep, left-to-right swing path that imparts clockwise spin on the ball.',
  ballFlightPrediction: 'Pull-fade with significant distance loss. Ball starts left and curves further left.',
  contactPrediction: 'Likely heel-biased or thin strike due to steep angle of attack.',
  clubSpecificNotes: 'With a driver you need a shallow, sweeping attack angle. An over-the-top path is especially punishing off the tee because there is no turf to compress — all energy goes into spin rather than distance.',
  fixes: [
    'Start the downswing by bumping your lead hip toward the target before your shoulders turn',
    'Feel your trail elbow drop close to your hip pocket during the transition',
    'Keep your head behind the ball through impact to encourage an inside-out delivery',
  ],
  drill: {
    name: 'Headcover Under Trail Arm',
    whyThisDrill: 'Forces your trail elbow to stay connected, preventing the over-the-top move that starts at the shoulders.',
    steps: [
      'Place a headcover or towel under your trail armpit at address',
      'Make full practice swings keeping light pressure on the headcover through the transition',
      'If the headcover drops early, your shoulder is initiating the downswing — reset and repeat',
    ],
  },
  keyCheckpoints: [
    'Lead hip moves toward target before shoulders begin to unwind',
    'Trail elbow is in front of the hip at the halfway-down position',
    'Head stays behind the ball at the moment of impact',
  ],
  summary: 'Your main issue is an over-the-top swing path driven by early shoulder rotation. This is robbing you of distance and producing left-to-right spin. Fix the sequencing — hips first, shoulders follow — and you will immediately see a more penetrating ball flight with the driver.',
};
