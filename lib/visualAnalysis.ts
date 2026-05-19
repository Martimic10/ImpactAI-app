import * as LegacyFS from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { SwingResult, VisualAnalysis, FrameAnalysis, SwingPhase, PoseLandmark, TemporalMetrics } from '@/types';
import {
  extractFramesFromVideoWithMeta,
  denseIndexToVideoFrameIndex,
  denseIndexToTimeMs,
  type ExtractFramesMeta,
} from '@/lib/frames';

import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const BUCKET = 'swing-videos';
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
const BACKEND_FETCH_TIMEOUT_MS = 120_000;
// Bumped to 16 when the timing-anchored picker replaced the motion-burst
// picker as the default for the dense pipeline. The motion-burst detector
// was systematically under-sizing the swing (its threshold only cleared
// during the downswing, missing the backswing), which shifted address →
// late backswing, top → impact, impact → follow-through. The new picker
// anchors on the motion peak ≈ impact and uses biomechanical timing
// priors (downswing 0.30s, hold 0.40s) to place the other phases — no
// burst-boundary detection required, so it doesn't suffer that failure
// mode. Existing swings auto-regenerate the next time their detail page
// mounts.
export const VISUAL_ANALYSIS_VERSION = 16;

// Fallback timestamps for the no-backend local thumbnails path. Only hit when
// EXPO_PUBLIC_BACKEND_URL is unset (development with no Render deployment).
const FALLBACK_PHASE_TIMES_MS: Record<SwingPhase, number> = {
  setup:  200,
  top:    1400,
  impact: 2600,
  finish: 3400,
};

// Dense-frame fallback windows (as fraction of the video).
// Used when MediaPipe / vision selection isn't available — picking
// from 75 evenly-spaced frames is dramatically better than picking
// from 6, because top and impact end up on actually-different frames.
const PHASE_FALLBACK_WINDOWS: Record<SwingPhase, { lo: number; hi: number; pick: number }> = {
  setup:  { lo: 0.05, hi: 0.15, pick: 0.10 },
  top:    { lo: 0.30, hi: 0.50, pick: 0.40 },
  impact: { lo: 0.55, hi: 0.72, pick: 0.63 },
  finish: { lo: 0.72, hi: 0.88, pick: 0.80 },
};
const DENSE_FRAME_COUNT = 75;

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
    setup:  r?.position ?? r?.setup  ?? `Check your ${result.selectedClub ?? 'club'} setup — stance, grip, and ball position.`,
    top:    r?.sequence ?? r?.swingPath ?? `At the top: ${issue.toLowerCase().includes('path') ? issue : 'evaluate your backswing plane and shoulder turn.'}`,
    impact: r?.contact  ?? (result.contactPrediction ?? `Impact: ${result.ballFlightPrediction ?? 'focus on solid contact.'}`),
    finish: r?.stability ?? r?.balance ?? 'Hold a balanced finish — weight fully on lead foot, chest facing target.',
  };
}

// ─── Backend phase-detection pipeline ────────────────────────────────────────
//
// POST /extract-frames mode=phaseDetection — dense JPEGs + motion + audio hint.
// Client picks setup/top/impact/finish, then uploads phase stills (no pose overlay).

interface BackendFrameResult {
  frame: string | null;       // base64 JPEG
  overlay_frame?: string | null;
  landmarks: PoseLandmark[] | null;
  time_ms?: number;
}

interface BackendResult {
  frames: BackendFrameResult[];
  metrics: TemporalMetrics | null;
}

export async function fetchBackendResult(
  videoUri: string,
  _club?: string,
): Promise<BackendResult | null> {
  if (!BACKEND_URL) return null;
  return extractPhasesViaDense(videoUri);
}

// ─── Client-side tempo metrics ───────────────────────────────────────────────
// Mirrors the math in backend's compute_temporal_metrics so dense-pipeline
// swings get the same deterministic tempo score that the AI prompt expects.

function computeTempoMetricsFromIndices(
  phaseFis: number[],
  fps: number,
  motionSamples?: number[],
): TemporalMetrics {
  if (phaseFis.length !== 4 || fps <= 0) {
    return {
      backswingDurationMs: null,
      downswingDurationMs: null,
      tempoRatio: null,
      motionSmoothness: null,
      computedTempoScore: null,
    };
  }
  const [addrFi, topFi, impactFi] = phaseFis;
  const backswingMs = Math.round(((topFi - addrFi) / fps) * 1000);
  const downswingMs = Math.round(((impactFi - topFi) / fps) * 1000);
  const tempoRatio = Math.round((backswingMs / Math.max(downswingMs, 1)) * 100) / 100;

  let smoothness: number | null = null;
  if (motionSamples && motionSamples.length >= 3) {
    const mean = motionSamples.reduce((a, b) => a + b, 0) / motionSamples.length;
    const variance =
      motionSamples.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / motionSamples.length;
    const std = Math.sqrt(variance);
    const cv = mean > 1e-6 ? std / mean : 0;
    smoothness = Math.round(Math.max(0, Math.min(100, 100 - cv * 60)) * 10) / 10;
  }

  let tempoScore: number;
  const r = tempoRatio;
  if (r >= 2.5 && r <= 3.5) {
    tempoScore = Math.round(85 + Math.min(10, (1 - Math.abs(r - 3.0)) * 10));
  } else if ((r >= 2.0 && r < 2.5) || (r > 3.5 && r <= 4.0)) {
    tempoScore = Math.round(70 + (1 - Math.abs(r - 3.0) / 1.5) * 14);
  } else if ((r >= 1.5 && r < 2.0) || (r > 4.0 && r <= 5.0)) {
    tempoScore = Math.round(55 + (1 - Math.abs(r - 3.0) / 3.0) * 14);
  } else {
    tempoScore = Math.round(Math.max(30, 55 - Math.abs(r - 3.0) * 8));
  }
  tempoScore = Math.max(30, Math.min(98, tempoScore));

  return {
    backswingDurationMs: backswingMs,
    downswingDurationMs: downswingMs,
    tempoRatio,
    motionSmoothness: smoothness,
    computedTempoScore: tempoScore,
  };
}

// ─── Dense pipeline (primary) ────────────────────────────────────────────────

// Motion-burst-anchored phase detection.
// Given per-frame motion energy across the dense sample, find the swing burst
// (the contiguous high-motion region) and place phases relative to it:
//
//   Address: just before the burst starts (last quiet frame)
//   Top:     local motion minimum within the burst before peak (transition)
//   Impact:  peak motion within the burst
//   Finish:  after the burst settles back to quiet
//
// This is orders of magnitude more accurate than fixed percentage windows
// because it adapts to where the actual swing motion is in the video,
// regardless of how the user trimmed the recording.
function pickPhaseIndicesFromMotion(motion: number[]): number[] | null {
  const n = motion.length;
  if (n < 12) return null;

  // 3-tap box smooth — kills single-frame noise.
  const smooth = motion.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
      sum += motion[j];
      cnt++;
    }
    return sum / cnt;
  });

  const sorted = [...smooth].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const max = sorted[n - 1];
  if (max < 0.5) return null; // basically a still photo

  // Threshold tuned empirically: 2.2x median catches the burst, but at least
  // 25% of peak so very-active videos still get a sensible boundary.
  const threshold = Math.max(median * 2.2, max * 0.25);

  // Find ALL contiguous runs above threshold, then pick the one with the
  // highest peak. This handles the practice-waggle-before-real-swing case:
  // a low-amplitude waggle near threshold loses to the real swing's higher
  // peak even if the waggle is technically longer.
  const bursts: Array<{ start: number; end: number; peak: number }> = [];
  let curStart = -1;
  for (let i = 0; i < n; i++) {
    if (smooth[i] >= threshold) {
      if (curStart < 0) curStart = i;
      if (i === n - 1) {
        bursts.push({ start: curStart, end: i, peak: Math.max(...smooth.slice(curStart, i + 1)) });
      }
    } else if (curStart >= 0) {
      bursts.push({ start: curStart, end: i - 1, peak: Math.max(...smooth.slice(curStart, i)) });
      curStart = -1;
    }
  }
  if (bursts.length === 0) return null;
  // Drop tiny bursts (<3 frames) — noise/practice waggles.
  const real = bursts.filter((b) => b.end - b.start + 1 >= 3);
  if (real.length === 0) return null;
  real.sort((a, b) => b.peak - a.peak); // highest peak first
  const bestStart = real[0].start;
  const bestEnd = real[0].end;

  // IMPACT = global motion peak inside the burst.
  let impactIdx = bestStart;
  for (let i = bestStart; i <= bestEnd; i++) {
    if (smooth[i] > smooth[impactIdx]) impactIdx = i;
  }

  // TOP = local minimum between burst start and impact (the transition dip
  // where the club momentarily decelerates before downswing). If the burst
  // is too short for a clean minimum, fall back to 40% into the burst.
  let topIdx = -1;
  if (impactIdx - bestStart >= 3) {
    // Search the early-middle of the burst — skip the first frame to avoid
    // picking the ramp-up trough, and stop 2 frames before impact.
    const searchLo = bestStart + 1;
    const searchHi = Math.max(searchLo, impactIdx - 2);
    let minVal = Infinity;
    for (let i = searchLo; i <= searchHi; i++) {
      if (smooth[i] < minVal) { minVal = smooth[i]; topIdx = i; }
    }
  }
  if (topIdx < 0 || topIdx <= bestStart || topIdx >= impactIdx) {
    topIdx = bestStart + Math.max(1, Math.floor((impactIdx - bestStart) * 0.5));
    if (topIdx >= impactIdx) topIdx = impactIdx - 1;
    if (topIdx <= bestStart) topIdx = bestStart + 1;
  }

  // ADDRESS = a couple frames before the burst (give visual breathing room).
  // Clamp to >= 0 with a 1-frame minimum gap from top.
  let addrIdx = Math.max(0, bestStart - 2);
  if (addrIdx >= topIdx) addrIdx = Math.max(0, topIdx - 1);

  // FINISH = halfway from burst-end to the video tail (typical hold-finish).
  let finishIdx = Math.min(n - 1, bestEnd + Math.max(2, Math.floor((n - 1 - bestEnd) * 0.5)));
  if (finishIdx <= impactIdx) finishIdx = Math.min(n - 1, impactIdx + 2);

  const picks = [addrIdx, topIdx, impactIdx, finishIdx];
  for (let i = 1; i < picks.length; i++) {
    if (picks[i] <= picks[i - 1]) return null;
  }

  console.log(
    `[visualAnalysis] motion-anchored picks: burst=[${bestStart},${bestEnd}] ` +
      `peakMotion=${smooth[impactIdx].toFixed(2)} median=${median.toFixed(2)} ` +
      `addr=${addrIdx} top=${topIdx} impact=${impactIdx} finish=${finishIdx}`,
  );
  return picks;
}

// Fallback when no motion data is available (backend hasn't been redeployed).
// Less accurate than motion-anchored picking, but always produces 4 distinct
// strictly-increasing indices.
function pickPhaseIndicesFromWindows(totalDenseFrames: number): number[] | null {
  if (totalDenseFrames < 8) return null;
  const forbidden = new Set<number>();
  const picks: number[] = [];
  for (const phase of PHASES) {
    const idx = pickIndexInWindow(totalDenseFrames, PHASE_FALLBACK_WINDOWS[phase], forbidden);
    forbidden.add(idx);
    picks.push(idx);
  }
  for (let i = 1; i < picks.length; i++) {
    if (picks[i] <= picks[i - 1]) return null;
  }
  return picks;
}

// ── Timing-anchored picker (PRIMARY when fps is known) ──────────────────────
//
// The previous motion-burst picker had a real flaw: its threshold
// (`max(median*2.2, max*0.25)`) is high enough that the gentler backswing
// often falls below it. The detected "burst" then covered only downswing +
// follow-through, which caused every phase to be picked too late:
//   - address (bestStart-2) landed in late backswing
//   - top (local min before peak) landed near impact
//   - impact (motion peak) landed in early follow-through
//
// This picker fixes that by ditching burst-boundary detection entirely.
// Instead it anchors on the global motion peak (which lives reliably in the
// impact zone) and uses biomechanical timing priors to place the other
// phases relative to it:
//
//   Impact   = global motion peak − 1 dense frame (frame-diff peak lands
//              ~33ms after actual contact because pixel motion is
//              calculated BETWEEN frames; the clubhead reaches "most pixels
//              changed" on the frame just after it crosses the ball)
//   Top      = ~0.30s before impact (tour-average downswing duration),
//              refined to the local motion minimum within ±0.10s of that
//              anchor — picks up the brief transition pause precisely
//   Address  = lowest-motion frame in the first 30% of the dense window
//              AND ≥0.30s before top (so it can't slip into the backswing)
//   Finish   = 0.40s after impact (long enough for a real hold-finish)
//
// Why this is robust: it doesn't care whether the backswing exceeded a
// motion threshold, or how fast the golfer's tempo is, or how long they
// waggle. It only needs the peak (always present and unambiguous) and the
// FPS (always available from /extract-frames meta).
function pickPhaseIndicesFromTimingPriors(
  motion: number[],
  meta: ExtractFramesMeta,
): number[] | null {
  const n = motion.length;
  if (n < 12 || meta.fps <= 0 || meta.totalFrames <= 0) return null;

  // 3-tap box smooth — same kernel the other pickers use, so peaks/minima
  // are comparable across detectors.
  const smooth = motion.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
      sum += motion[j];
      cnt++;
    }
    return sum / cnt;
  });

  // 1. Global motion peak ≈ impact zone (within 1-2 frames).
  let peakIdx = 0;
  let peakVal = 0;
  for (let i = 0; i < n; i++) {
    if (smooth[i] > peakVal) {
      peakVal = smooth[i];
      peakIdx = i;
    }
  }
  if (peakVal < 0.5) return null; // basically a still photo / no swing

  // 2. Seconds → dense-frame count. The dense array covers
  //    [loPct, hiPct] * totalFrames source frames, with n samples evenly
  //    spaced through it. 1s = (n-1) * fps / (span_source_frames) dense frames.
  const sourceFramesInDense = Math.max(1, (meta.hiPct - meta.loPct) * meta.totalFrames);
  const denseFramesPerSec = ((n - 1) * meta.fps) / sourceFramesInDense;
  const denseFor = (sec: number) => Math.max(1, Math.round(sec * denseFramesPerSec));

  // 3. Impact: peak − 1 dense frame to compensate for the frame-diff lag.
  //    This is a small correction (~1 frame) but it consistently moves the
  //    pick off "early follow-through" and onto "actual contact".
  const impactIdx = Math.max(0, peakIdx - 1);

  // 4. Top: anchor at impact − 0.30s, then refine to the local motion
  //    minimum within ±0.10s. The minimum captures the brief deceleration
  //    pause at the top of the swing — much more accurate than just using
  //    the timing anchor naively.
  const downswingFrames = denseFor(0.30);
  const topAnchor = Math.max(0, impactIdx - downswingFrames);
  const topRadius = denseFor(0.10);
  const topLo = Math.max(0, topAnchor - topRadius);
  const topHi = Math.min(impactIdx - 2, topAnchor + topRadius);
  let topIdx = Math.max(0, Math.min(impactIdx - 2, topAnchor));
  if (topHi > topLo) {
    let minVal = smooth[topLo];
    topIdx = topLo;
    for (let i = topLo + 1; i <= topHi; i++) {
      if (smooth[i] < minVal) {
        minVal = smooth[i];
        topIdx = i;
      }
    }
  }

  // 5. Address: lowest-motion frame in the early portion of the clip,
  //    but constrained to be at least 0.30s before top so it can't
  //    accidentally land inside the backswing on a video with a short
  //    setup. Hard cap at 30% of the dense window — golfers' addresses
  //    are essentially always in the first third of a recorded swing clip.
  const minAddrGap = denseFor(0.30);
  const addrHi = Math.max(0, Math.min(topIdx - minAddrGap, Math.floor(n * 0.30)));
  let addrIdx = 0;
  if (addrHi > 0) {
    let minVal = smooth[0];
    for (let i = 1; i <= addrHi; i++) {
      if (smooth[i] < minVal) {
        minVal = smooth[i];
        addrIdx = i;
      }
    }
  }

  // 6. Finish: 0.40s after impact (clamped to clip end). At 30fps that's
  //    12 source frames — comfortable post-impact for a held finish.
  const followThroughFrames = denseFor(0.40);
  const finishIdx = Math.min(n - 1, impactIdx + followThroughFrames);

  // Sanity: strict monotonicity.
  const picks = [addrIdx, topIdx, impactIdx, finishIdx];
  for (let i = 1; i < picks.length; i++) {
    if (picks[i] <= picks[i - 1]) {
      console.warn(`[visualAnalysis] timing picker: non-monotonic ${picks.join(',')}`);
      return null;
    }
  }

  console.log(
    `[visualAnalysis] timing-anchored picks: peak=${peakIdx} ` +
      `addr=${addrIdx} top=${topIdx} impact=${impactIdx} finish=${finishIdx} ` +
      `(downswing=${downswingFrames}df = ${(downswingFrames / denseFramesPerSec).toFixed(2)}s, ` +
      `finish=${followThroughFrames}df)`,
  );
  return picks;
}

// Audio-anchored picker — used when /extract-frames returned an audio impact
// index with sufficient confidence. We treat audio impact as ground truth and
// derive the other three phases around it from the motion curve. This is far
// more accurate than motion-only burst anchoring because impact is the only
// phase with a deterministic physical signature (the clubface-ball click).
//
//   Impact   = audio-detected frame
//   Top      = local motion minimum in [impact*0.35, impact-2]  (the brief
//              transition pause before the downswing reversal)
//   Address  = lowest-motion frame in the first 25% of the dense window
//   Finish   = a frame after impact, far enough to capture the hold position
//              but inside the clip
function pickPhaseIndicesFromAudio(
  motion: number[],
  audioImpactDense: number,
): number[] | null {
  const n = motion.length;
  if (audioImpactDense < 3 || audioImpactDense >= n - 1) return null;

  const impactIdx = Math.min(n - 1, Math.max(2, audioImpactDense));

  // Smooth motion to suppress single-frame noise (same kernel as the
  // motion-burst picker so results are comparable across the two paths).
  const smooth = motion.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
      sum += motion[j];
      cnt++;
    }
    return sum / cnt;
  });

  // TOP: local motion minimum in the early-middle of the run-up to impact.
  // Restrict search to the actually-rising-then-pausing window: 35% of the
  // way through the pre-impact span up to 2 frames before impact.
  const topLo = Math.max(1, Math.floor(impactIdx * 0.35));
  const topHi = Math.max(topLo, impactIdx - 2);
  let topIdx = topLo;
  let topVal = smooth[topLo];
  for (let i = topLo + 1; i <= topHi; i++) {
    if (smooth[i] < topVal) {
      topVal = smooth[i];
      topIdx = i;
    }
  }

  // ADDRESS: lowest-motion frame in the first 25% of the dense array, capped
  // at one frame before top. This finds the actual stillness at setup rather
  // than just picking frame 0 (which may include camera/microphone settling).
  const addrHi = Math.max(0, Math.min(topIdx - 1, Math.floor(n * 0.25)));
  let addrIdx = 0;
  let addrVal = smooth[0];
  for (let i = 1; i <= addrHi; i++) {
    if (smooth[i] < addrVal) {
      addrVal = smooth[i];
      addrIdx = i;
    }
  }

  // FINISH: about halfway from impact to the end of the dense window — gives
  // the golfer time to reach a hold-finish pose. Guard the minimum gap so
  // very tight clips still produce a distinct finish frame.
  const tail = n - 1 - impactIdx;
  let finishIdx = impactIdx + Math.max(3, Math.floor(tail * 0.5));
  finishIdx = Math.min(n - 1, finishIdx);

  const picks = [addrIdx, topIdx, impactIdx, finishIdx];
  for (let i = 1; i < picks.length; i++) {
    if (picks[i] <= picks[i - 1]) return null;
  }

  console.log(
    `[visualAnalysis] audio-anchored picks: addr=${addrIdx} top=${topIdx} ` +
      `impact=${impactIdx}(audio) finish=${finishIdx}`,
  );
  return picks;
}

// Picker priority chain. We try the most accurate detector first and fall
// through to less precise ones if its preconditions aren't met or it fails
// validation. Every fallback is strictly worse than the one above it.
//
//   1. AUDIO-ANCHORED  — needs meta.audioImpact with confidence ≥ 0.40.
//      Impact is locked from the audio click (±1 frame), other phases
//      derive from motion around it. Best accuracy available.
//
//   2. TIMING-ANCHORED — needs meta.fps + meta.totalFrames. Uses the
//      motion peak as impact-zone proxy and biomechanical timing priors
//      (downswing 0.30s, hold 0.40s) to place top/address/finish.
//      Robust because it doesn't depend on burst-boundary detection.
//
//   3. MOTION-BURST   — legacy. Only used when meta is unavailable.
//      Tends to mis-localize when the backswing falls below the burst
//      threshold (see fix history). Kept as a final motion-only safety
//      net; the timing-anchored picker above should handle every case
//      where the motion array exists and meta is present.
//
//   4. FIXED WINDOWS  — last resort. Always produces 4 distinct picks.
function pickPhaseIndicesFromDense(
  totalDenseFrames: number,
  motion?: number[],
  meta?: ExtractFramesMeta,
): number[] | null {
  const haveMotion = motion && motion.length === totalDenseFrames;
  const ai = meta?.audioImpact;

  // 1. Audio-anchored: same 0.40 threshold the backend uses.
  if (
    haveMotion &&
    ai &&
    ai.denseIdx >= 0 &&
    ai.denseIdx < totalDenseFrames &&
    ai.confidence >= 0.40
  ) {
    const audioPicks = pickPhaseIndicesFromAudio(motion, ai.denseIdx);
    if (audioPicks) return audioPicks;
    console.warn('[visualAnalysis] audio anchor picker returned null — trying timing priors');
  }

  // 2. Timing-anchored: the new default whenever meta is available.
  if (haveMotion && meta) {
    const timingPicks = pickPhaseIndicesFromTimingPriors(motion, meta);
    if (timingPicks) return timingPicks;
    console.warn('[visualAnalysis] timing picker returned null — falling back to motion burst');
  }

  // 3. Motion-burst (legacy): only when meta is missing.
  if (haveMotion) {
    const motionPicks = pickPhaseIndicesFromMotion(motion);
    if (motionPicks) return motionPicks;
    console.warn('[visualAnalysis] motion picker returned null — falling back to windows');
  }

  // 4. Fixed-percentage windows.
  return pickPhaseIndicesFromWindows(totalDenseFrames);
}

async function extractPhasesViaDense(videoUri: string): Promise<BackendResult | null> {
  // /extract-frames requires a local URI (multipart upload). Download once
  // if we were handed an https URL.
  let localUri = videoUri;
  if (videoUri.startsWith('http')) {
    try {
      // Hash the URL into a stable cache key so repeated calls reuse the file.
      const cacheKey = videoUri.split('/').pop()?.split('?')[0] ?? `va_${Date.now()}`;
      localUri = await resolveLocalUri(videoUri, cacheKey.replace(/\W+/g, '_'));
    } catch (e) {
      console.warn('[visualAnalysis] dense: failed to fetch video to local cache:', e);
      return null;
    }
  }

  let frames: string[];
  let meta: ExtractFramesMeta | null;
  try {
    const result = await extractFramesFromVideoWithMeta(localUri, {
      mode: 'phaseDetection',
      frameCount: DENSE_FRAME_COUNT,
    });
    frames = result.frames;
    meta = result.meta;
  } catch (e) {
    console.warn('[visualAnalysis] dense: extract-frames threw:', e);
    return null;
  }

  const usable = frames.filter((f) => f && f.length > 0);
  const n = usable.length;
  if (n < 8) {
    console.warn(`[visualAnalysis] dense: only ${n} usable frames`);
    return null;
  }

  // If meta.motion is present (backend redeployed), align motion array to the
  // usable-frames slice — usable.length may be < frames.length if some
  // decodes failed. In practice motion.length matches frames.length 1:1.
  const motionSlice =
    meta?.motion && meta.motion.length === frames.length
      ? meta.motion.slice(0, n)
      : meta?.motion;

  // Pass the full meta into the picker so it can use fps/totalFrames for
  // timing-anchored picks AND audioImpact for the audio-anchored path.
  const picks = pickPhaseIndicesFromDense(n, motionSlice, meta ?? undefined);
  if (!picks) {
    console.warn('[visualAnalysis] dense: could not select 4 distinct phase indices');
    return null;
  }

  const selectedFrames = picks.map((p) => usable[p]);

  // Map picked dense indices back to source video frame indices and compute
  // tempo metrics deterministically.
  let metrics: TemporalMetrics | null = null;
  let timeMs: number[] = [];
  if (meta && meta.totalFrames > 0 && meta.fps > 0) {
    const phaseFis = picks.map((p) => denseIndexToVideoFrameIndex(p, n, meta));
    timeMs = picks.map((p) => denseIndexToTimeMs(p, n, meta));
    metrics = computeTempoMetricsFromIndices(phaseFis, meta.fps, motionSlice);
  } else {
    // No meta means the backend isn't deployed with the new response shape yet.
    // The AI will fall back to tempoScore=68 and won't claim tempo as the issue.
    timeMs = picks.map((_, i) => i * 1000);
  }

  console.log(
    `[visualAnalysis] dense pipeline: picks=${picks.join(',')} ` +
      (metrics?.tempoRatio != null
        ? `tempoRatio=${metrics.tempoRatio} tempoScore=${metrics.computedTempoScore}`
        : 'no metrics'),
  );

  const bfFrames: BackendFrameResult[] = PHASES.map((_, i) => ({
    frame: selectedFrames[i],
    landmarks: null,
    time_ms: timeMs[i],
  }));

  return { frames: bfFrames, metrics };
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

// ─── Dense-frame window picker ───────────────────────────────────────────────
// Used by extractPhasesViaDense() above to map 4 swing phases onto distinct
// indices within the dense (75-frame) array.

function pickIndexInWindow(
  totalFrames: number,
  window: { lo: number; hi: number; pick: number },
  forbidden: Set<number>,
): number {
  const loIdx = Math.max(0, Math.floor(window.lo * (totalFrames - 1)));
  const hiIdx = Math.min(totalFrames - 1, Math.ceil(window.hi * (totalFrames - 1)));
  const preferred = Math.round(window.pick * (totalFrames - 1));
  const clampedPreferred = Math.max(loIdx, Math.min(hiIdx, preferred));

  if (!forbidden.has(clampedPreferred)) return clampedPreferred;

  for (let offset = 1; offset <= hiIdx - loIdx; offset++) {
    const up = clampedPreferred + offset;
    const down = clampedPreferred - offset;
    if (up <= hiIdx && !forbidden.has(up)) return up;
    if (down >= loIdx && !forbidden.has(down)) return down;
  }
  return clampedPreferred;
}

// ─── expo-video-thumbnails fallback (legacy) ─────────────────────────────────
// Kept only as a last resort when no BACKEND_URL is configured at all.
// Requires a native build (doesn't work in Expo Go).

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

// ─── VisualAnalysis builders ─────────────────────────────────────────────────

// Convert a (post-dense-pipeline) BackendResult into a VisualAnalysis with
// inline data-URI images. Cheap, synchronous, returns immediately so the UI
// can render while the slower Supabase upload runs in the background.
function buildInlinePreviewFromBackendResult(
  bf: BackendFrameResult[],
  notes: Record<SwingPhase, string>,
): VisualAnalysis {
  const inlineUrls = bf.map((f) => (f.frame ? `data:image/jpeg;base64,${f.frame}` : null));
  return {
    setup:  buildFrame('setup',  inlineUrls[0], notes.setup,  bf[0]?.landmarks, undefined, bf[0]?.time_ms),
    top:    buildFrame('top',    inlineUrls[1], notes.top,    bf[1]?.landmarks, undefined, bf[1]?.time_ms),
    impact: buildFrame('impact', inlineUrls[2], notes.impact, bf[2]?.landmarks, undefined, bf[2]?.time_ms),
    finish: buildFrame('finish', inlineUrls[3], notes.finish, bf[3]?.landmarks, undefined, bf[3]?.time_ms),
  };
}

// Same shape but with Supabase-hosted public URLs (durable, survives across
// devices). Used for persisted VisualAnalysis records.
async function buildPersistedFromBackendResult(
  bf: BackendFrameResult[],
  notes: Record<SwingPhase, string>,
  userId: string,
  swingId: string,
): Promise<VisualAnalysis> {
  const uploadedUrls = await Promise.all(
    PHASES.map((phase, i) =>
      bf[i].frame ? uploadFrame(bf[i].frame!, userId, swingId, phase) : Promise.resolve(null),
    ),
  );
  return {
    setup:  buildFrame('setup',  uploadedUrls[0], notes.setup,  bf[0]?.landmarks, undefined, bf[0]?.time_ms),
    top:    buildFrame('top',    uploadedUrls[1], notes.top,    bf[1]?.landmarks, undefined, bf[1]?.time_ms),
    impact: buildFrame('impact', uploadedUrls[2], notes.impact, bf[2]?.landmarks, undefined, bf[2]?.time_ms),
    finish: buildFrame('finish', uploadedUrls[3], notes.finish, bf[3]?.landmarks, undefined, bf[3]?.time_ms),
  };
}

// If the backend pipeline produced fresh temporal metrics, patch them onto
// the swing record so subsequent loads / AI re-runs see the same numbers.
function patchSwingMetricsAsync(swingId: string, metrics: TemporalMetrics | null) {
  if (!metrics || metrics.computedTempoScore == null) return;
  (async () => {
    try {
      const { data } = await supabase.from('swings').select('result_json').eq('id', swingId).single();
      if (!data?.result_json) return;
      const updated = {
        ...data.result_json,
        temporalMetrics: metrics,
        scores: { ...data.result_json.scores, tempoScore: metrics.computedTempoScore },
      };
      await supabase.from('swings').update({ result_json: updated }).eq('id', swingId);
    } catch { /* non-fatal */ }
  })();
}

// ─── Main exports ────────────────────────────────────────────────────────────

export async function generateVisualAnalysis(
  videoUri: string,
  userId: string,
  swingId: string,
  result: SwingResult,
): Promise<VisualAnalysis | null> {
  const notes = buildCoachingNotes(result);

  if (BACKEND_URL) {
    console.log('[visualAnalysis] dense pipeline for', swingId);
    const backendResult = await fetchBackendResult(videoUri, result.selectedClub);
    if (backendResult && backendResult.frames.filter((f) => f.frame).length >= 2) {
      patchSwingMetricsAsync(swingId, backendResult.metrics);
      const va = await buildPersistedFromBackendResult(backendResult.frames, notes, userId, swingId);
      return va;
    }
    console.warn('[visualAnalysis] dense pipeline returned no usable frames');
    return null;
  }

  // No BACKEND_URL at all — last-resort local thumbnails path.
  console.log('[visualAnalysis] no BACKEND_URL — using local thumbnails for', swingId);
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

export type { BackendResult };

export async function buildVisualAnalysisFromBackendResult(
  backendResult: BackendResult,
  swingId: string,
  userId: string,
  result: SwingResult,
  _videoUri?: string,
): Promise<VisualAnalysis | null> {
  const notes = buildCoachingNotes(result);
  const { frames: bf } = backendResult;
  if (bf.length !== 4 || bf.filter((f) => f.frame).length < 2) return null;

  const va = await buildPersistedFromBackendResult(bf, notes, userId, swingId);
  await saveVisualAnalysis(swingId, va);
  return va;
}

export async function generateVisualAnalysisPreview(
  videoUri: string,
  userId: string,
  swingId: string,
  result: SwingResult,
): Promise<{ preview: VisualAnalysis; persist: () => Promise<VisualAnalysis | null> } | null> {
  if (!BACKEND_URL) {
    const analysis = await generateVisualAnalysis(videoUri, userId, swingId, result);
    return analysis ? { preview: analysis, persist: async () => analysis } : null;
  }

  console.log('[visualAnalysis] preview: dense pipeline for', swingId);
  const notes = buildCoachingNotes(result);

  const backendResult = await fetchBackendResult(videoUri, result.selectedClub);
  if (!backendResult || backendResult.frames.filter((f) => f.frame).length < 2) {
    console.warn('[visualAnalysis] preview: dense pipeline produced no usable frames');
    return null;
  }

  patchSwingMetricsAsync(swingId, backendResult.metrics);

  // Show the preview from inline base64 immediately. Persist (upload + DB
  // save) happens asynchronously when the caller invokes `persist()`.
  const preview = buildInlinePreviewFromBackendResult(backendResult.frames, notes);
  const persist = async () =>
    buildPersistedFromBackendResult(backendResult.frames, notes, userId, swingId);

  return { preview, persist };
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

export async function saveManualFrameOverride(
  swingId: string,
  phase: SwingPhase,
  timeMs: number
): Promise<void> {
  try {
    const { data } = await supabase
      .from('swings')
      .select('visual_analysis')
      .eq('id', swingId)
      .single();

    if (!data?.visual_analysis) return;

    const updated: VisualAnalysis = {
      ...data.visual_analysis,
      [phase]: { ...data.visual_analysis[phase], manualTimeMs: timeMs },
    };
    await supabase.from('swings').update({ visual_analysis: updated }).eq('id', swingId);
    console.log(`[visualAnalysis] manual override saved: ${phase} → ${timeMs}ms`);
  } catch (e) {
    console.warn('[visualAnalysis] manual override failed:', e);
  }
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
