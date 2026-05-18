// ─────────────────────────────────────────────────────────────────────────────
// ImpactAI — Deterministic Swing Scoring Engine (v4)
// ─────────────────────────────────────────────────────────────────────────────
//
// PRINCIPLES
//   1. The numeric score is computed from measurable swing signals only —
//      pose landmarks at phase frames + temporal metrics. The LLM never sets
//      numbers. The LLM writes narrative + drills given THESE category scores.
//   2. Each measurement is normalized by body size (shoulder-width) so a
//      golfer close to the camera does not score differently than one far
//      from the camera.
//   3. Each category emits a CONFIDENCE alongside its score. Low confidence
//      means low landmark visibility, missing phases, or invalid phase order.
//      Scoring with low confidence is softened toward neutral and flagged
//      for the UI to display a warning, with leaderboard submission blocked.
//   4. Categories: setup, balance, tempo, rotation, swingPath,
//      impactPosition, followThrough. Final = weighted average (weights
//      sum to 1.0; impact carries the highest weight at 20% because this
//      app is called ImpactAI and impact is what matters most).
//   5. Every penalty is named: { metric, value, ideal, penalty, severity }.
//      The debug block contains the full chain so any score can be
//      explained line-by-line.
//
// THIS FILE REPLACES lib/biomechanicalScoring.ts.

import { PoseLandmark, TemporalMetrics } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — MediaPipe BlazePose 33-point indices
// ─────────────────────────────────────────────────────────────────────────────
export const LM = {
  NOSE: 0,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
} as const;

const VIS_MIN = 0.35; // landmark visibility threshold

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────
export type CategoryKey =
  | 'setup'
  | 'balance'
  | 'tempo'
  | 'rotation'
  | 'swingPath'
  | 'impactPosition'
  | 'followThrough';

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  setup:          'Setup',
  balance:        'Balance',
  tempo:          'Tempo',
  rotation:       'Rotation',
  swingPath:      'Swing Path',
  impactPosition: 'Impact Position',
  followThrough:  'Follow-through',
};

// Final weights — total 1.00, ImpactPosition is heaviest.
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  setup:          0.10,
  balance:        0.15,
  tempo:          0.15,
  rotation:       0.15,
  swingPath:      0.15,
  impactPosition: 0.20,
  followThrough:  0.10,
};

export type ScoreBand =
  | 'excellent'    // 90-100
  | 'strong'       // 80-89
  | 'solid'        // 70-79
  | 'needs-work'   // 60-69
  | 'major-issues' // 50-59
  | 'poor';        // < 50

export const BAND_LABELS: Record<ScoreBand, string> = {
  excellent:      'Excellent',
  strong:         'Strong',
  solid:          'Solid',
  'needs-work':   'Needs work',
  'major-issues': 'Major issues',
  poor:           'Poor / unusable',
};

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ClubGroup =
  | 'driver'
  | 'fairway-wood'
  | 'hybrid'
  | 'long-iron'
  | 'mid-iron'
  | 'short-iron'
  | 'wedge'
  | 'putter'
  | 'unknown';

export interface PerFrameLandmarks {
  setup?:  PoseLandmark[] | null;
  top?:    PoseLandmark[] | null;
  impact?: PoseLandmark[] | null;
  finish?: PoseLandmark[] | null;
}

interface PenaltyEntry {
  metric: string;
  value: number;
  ideal: string;
  penalty: number;
  severity: 'minor' | 'moderate' | 'severe';
  fault: string;       // human-readable fault name
  fix: string;         // 1-sentence cue
}

export interface CategoryScore {
  key: CategoryKey;
  name: string;
  score: number;          // 0-100 (post confidence adjustment)
  rawScore: number;       // 0-100 (pre confidence adjustment)
  weight: number;         // 0-1
  confidence: number;     // 0-1
  reason: string;         // short user-facing summary
  topIssue?: string;      // single most damaging fault detected (if any)
  suggestedFix?: string;  // matching fix
  metrics: Record<string, number | null>;
  penalties: PenaltyEntry[];
}

export interface PhaseValidation {
  valid: boolean;
  warnings: string[];
  havePhases: {
    setup: boolean;
    top: boolean;
    impact: boolean;
    finish: boolean;
  };
}

export interface SwingScoringResult {
  overallScore: number;
  band: ScoreBand;
  bandLabel: string;

  categories: Record<CategoryKey, CategoryScore>;

  confidence: ConfidenceLevel;
  confidenceScore: number;          // aggregate 0-1
  phaseValidation: PhaseValidation;
  isLeaderboardEligible: boolean;
  warnings: string[];               // user-facing
  topFaults: string[];              // ordered most→least damaging

  club: {
    selected: string;
    group: ClubGroup;
  };

  debug: ScoringDebug;
}

export interface ScoringDebug {
  bodyUnit: number | null;
  weightsUsed: Record<CategoryKey, number>;
  confidenceMultiplier: number;
  log: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry primitives — all coordinates are MediaPipe-normalized [0,1].
// y increases DOWNWARD; we flip when computing "up = positive" tilt.
// ─────────────────────────────────────────────────────────────────────────────
type Pt = { x: number; y: number; vis: number };

function pt(lms: PoseLandmark[] | null | undefined, idx: number): Pt | null {
  if (!lms) return null;
  const p = lms[idx];
  if (!p) return null;
  const vis = p.visibility ?? 1;
  if (vis < VIS_MIN) return null;
  return { x: p.x, y: p.y, vis };
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vis: Math.min(a.vis, b.vis) };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180) / Math.PI;
}

// Angle of line p1→p2 vs. horizontal. y is flipped so "up" is positive degrees.
function lineTiltDeg(p1: Pt, p2: Pt): number {
  const dx = p2.x - p1.x;
  const dy = -(p2.y - p1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// Spine tilt vs vertical (0 = perfectly upright, 30 = typical iron posture)
function spineTilt(lms: PoseLandmark[] | null | undefined): number | null {
  const ls = pt(lms, LM.LEFT_SHOULDER);
  const rs = pt(lms, LM.RIGHT_SHOULDER);
  const lh = pt(lms, LM.LEFT_HIP);
  const rh = pt(lms, LM.RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  const tilt = lineTiltDeg(mid(lh, rh), mid(ls, rs));
  return Math.abs(tilt - 90);
}

// Shoulder line tilt vs. horizontal. +ve = lead (left) shoulder higher.
function shoulderTilt(lms: PoseLandmark[] | null | undefined): number | null {
  const ls = pt(lms, LM.LEFT_SHOULDER);
  const rs = pt(lms, LM.RIGHT_SHOULDER);
  if (!ls || !rs) return null;
  return lineTiltDeg(rs, ls);
}

function hipTilt(lms: PoseLandmark[] | null | undefined): number | null {
  const lh = pt(lms, LM.LEFT_HIP);
  const rh = pt(lms, LM.RIGHT_HIP);
  if (!lh || !rh) return null;
  return lineTiltDeg(rh, lh);
}

function leadArmFold(lms: PoseLandmark[] | null | undefined): number | null {
  const s = pt(lms, LM.LEFT_SHOULDER);
  const e = pt(lms, LM.LEFT_ELBOW);
  const w = pt(lms, LM.LEFT_WRIST);
  if (!s || !e || !w) return null;
  return angleAt(s, e, w);
}

function trailArmFold(lms: PoseLandmark[] | null | undefined): number | null {
  const s = pt(lms, LM.RIGHT_SHOULDER);
  const e = pt(lms, LM.RIGHT_ELBOW);
  const w = pt(lms, LM.RIGHT_WRIST);
  if (!s || !e || !w) return null;
  return angleAt(s, e, w);
}

function leadKneeFlex(lms: PoseLandmark[] | null | undefined): number | null {
  const h = pt(lms, LM.LEFT_HIP);
  const k = pt(lms, LM.LEFT_KNEE);
  const a = pt(lms, LM.LEFT_ANKLE);
  if (!h || !k || !a) return null;
  return angleAt(h, k, a);
}

function trailKneeFlex(lms: PoseLandmark[] | null | undefined): number | null {
  const h = pt(lms, LM.RIGHT_HIP);
  const k = pt(lms, LM.RIGHT_KNEE);
  const a = pt(lms, LM.RIGHT_ANKLE);
  if (!h || !k || !a) return null;
  return angleAt(h, k, a);
}

function shoulderWidth(lms: PoseLandmark[] | null | undefined): number | null {
  const ls = pt(lms, LM.LEFT_SHOULDER);
  const rs = pt(lms, LM.RIGHT_SHOULDER);
  if (!ls || !rs) return null;
  return dist(ls, rs);
}

function hipWidth(lms: PoseLandmark[] | null | undefined): number | null {
  const lh = pt(lms, LM.LEFT_HIP);
  const rh = pt(lms, LM.RIGHT_HIP);
  if (!lh || !rh) return null;
  return dist(lh, rh);
}

function stanceWidth(lms: PoseLandmark[] | null | undefined): number | null {
  const la = pt(lms, LM.LEFT_ANKLE);
  const ra = pt(lms, LM.RIGHT_ANKLE);
  if (!la || !ra) return null;
  return dist(la, ra);
}

// Avg visibility of a set of indices in a frame.
function avgVis(lms: PoseLandmark[] | null | undefined, idxs: number[]): number {
  if (!lms) return 0;
  let sum = 0; let n = 0;
  for (const i of idxs) {
    const v = lms[i]?.visibility;
    if (typeof v === 'number') { sum += v; n += 1; }
  }
  return n === 0 ? 0 : sum / n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Penalty engine
// ─────────────────────────────────────────────────────────────────────────────
//
// `rangePenalty` — value falls in [minIdeal, maxIdeal] → no penalty. Outside,
// penalties ramp linearly through a "yellow" zone, then a "red" zone, then cap
// at `maxPenalty`. Returns the penalty + the severity for reporting.
//
// `deviationPenalty` — same but for one-sided deviation from a target. Used
// for things like "head drift should be near zero" or "trail knee should be
// near 180° at finish".
// Penalty curve — calibrated to give clean swings 85-100, swings with one
// clear flaw 70-85, swings with multiple flaws 55-70, and swings with severe
// faults 35-55.
//   Yellow (0 → yellowExt) : 0 → 28% of maxPenalty   (minor — small flag)
//   Red    (yellow → red)  : 28% → 72% of maxPenalty (moderate — real fault)
//   Beyond red             : 72% → 95% of maxPenalty (severe — major fault)
function bandedPenalty(
  dev: number,
  yellowExt: number,
  redExt: number,
  maxPenalty: number,
): { penalty: number; severity: 'minor' | 'moderate' | 'severe' } {
  if (dev <= yellowExt) {
    const t = yellowExt > 0 ? dev / yellowExt : 0;
    const p = Math.round(t * maxPenalty * 0.28);
    return { penalty: p, severity: 'minor' };
  }
  if (dev <= redExt) {
    const t = (dev - yellowExt) / Math.max(0.0001, redExt - yellowExt);
    const p = Math.round(maxPenalty * 0.28 + t * maxPenalty * 0.44);
    return { penalty: p, severity: 'moderate' };
  }
  const overshoot = Math.min(1, (dev - redExt) / Math.max(0.0001, redExt));
  const p = Math.min(
    Math.round(maxPenalty * 0.95),
    Math.round(maxPenalty * 0.72 + overshoot * maxPenalty * 0.23),
  );
  return { penalty: p, severity: 'severe' };
}

function rangePenalty(
  value: number,
  minIdeal: number,
  maxIdeal: number,
  yellowExt: number,
  redExt: number,
  maxPenalty: number,
): { penalty: number; severity: 'minor' | 'moderate' | 'severe' | 'ok' } {
  if (value >= minIdeal && value <= maxIdeal) {
    return { penalty: 0, severity: 'ok' };
  }
  const dev = value < minIdeal ? minIdeal - value : value - maxIdeal;
  return bandedPenalty(dev, yellowExt, redExt, maxPenalty);
}

function deviationPenalty(
  value: number,
  target: number,
  yellowExt: number,
  redExt: number,
  maxPenalty: number,
): { penalty: number; severity: 'minor' | 'moderate' | 'severe' | 'ok' } {
  const dev = Math.abs(value - target);
  if (dev <= yellowExt * 0.25) return { penalty: 0, severity: 'ok' };
  return bandedPenalty(dev, yellowExt, redExt, maxPenalty);
}

// ─────────────────────────────────────────────────────────────────────────────
// Club profiles — adjust expected ranges by club
// ─────────────────────────────────────────────────────────────────────────────
export function detectClubGroup(club: string | undefined | null): ClubGroup {
  if (!club) return 'unknown';
  const c = club.toLowerCase();
  if (c.includes('driver')) return 'driver';
  if (c.includes('3w') || c.includes('5w') || c.includes('wood') || c.includes('fairway')) return 'fairway-wood';
  if (c.includes('hybrid')) return 'hybrid';
  if (c.includes('putter')) return 'putter';
  if (c.includes('lw') || c.includes('lob') || c.includes('sw') || c.includes('sand') ||
      c.includes('gw') || c.includes('gap') || c.includes('pw') || c.includes('pitching') ||
      c.includes('wedge') || c.includes('60') || c.includes('58') || c.includes('56') ||
      c.includes('54') || c.includes('52') || c.includes('50') || c.includes('48') || c.includes('46')) {
    return 'wedge';
  }
  if (c.includes('9') || c.includes('8') || c.includes('7i')) return 'short-iron';
  if (c.includes('6') || c.includes('5i')) return 'mid-iron';
  if (c.includes('4') || c.includes('3i') || c.includes('2i') || c.includes('long iron')) return 'long-iron';
  if (c.includes('iron')) return 'mid-iron';
  return 'unknown';
}

interface ClubProfile {
  setupSpineMin: number;
  setupSpineMax: number;
  setupStanceRatioMin: number; // stance/shoulder
  setupStanceRatioMax: number;
  hipTurnAtTopMin: number;
  hipTurnAtTopMax: number;
  shoulderTurnAtTopMin: number;
  shoulderTurnAtTopMax: number;
  swayToleranceShW: number; // multiplier on default head/hip drift tolerances
}

function clubProfile(group: ClubGroup): ClubProfile {
  switch (group) {
    case 'driver': return {
      setupSpineMin: 22, setupSpineMax: 38,
      setupStanceRatioMin: 1.30, setupStanceRatioMax: 1.80,
      hipTurnAtTopMin: 40, hipTurnAtTopMax: 60,
      shoulderTurnAtTopMin: 80, shoulderTurnAtTopMax: 110,
      swayToleranceShW: 1.20,
    };
    case 'fairway-wood':
    case 'hybrid': return {
      setupSpineMin: 25, setupSpineMax: 40,
      setupStanceRatioMin: 1.15, setupStanceRatioMax: 1.55,
      hipTurnAtTopMin: 38, hipTurnAtTopMax: 58,
      shoulderTurnAtTopMin: 80, shoulderTurnAtTopMax: 110,
      swayToleranceShW: 1.10,
    };
    case 'long-iron':
    case 'mid-iron': return {
      setupSpineMin: 28, setupSpineMax: 42,
      setupStanceRatioMin: 1.05, setupStanceRatioMax: 1.40,
      hipTurnAtTopMin: 35, hipTurnAtTopMax: 55,
      shoulderTurnAtTopMin: 80, shoulderTurnAtTopMax: 108,
      swayToleranceShW: 1.00,
    };
    case 'short-iron': return {
      setupSpineMin: 30, setupSpineMax: 44,
      setupStanceRatioMin: 0.95, setupStanceRatioMax: 1.25,
      hipTurnAtTopMin: 30, hipTurnAtTopMax: 50,
      shoulderTurnAtTopMin: 78, shoulderTurnAtTopMax: 105,
      swayToleranceShW: 0.95,
    };
    case 'wedge': return {
      setupSpineMin: 30, setupSpineMax: 45,
      setupStanceRatioMin: 0.85, setupStanceRatioMax: 1.15,
      hipTurnAtTopMin: 28, hipTurnAtTopMax: 50,
      shoulderTurnAtTopMin: 70, shoulderTurnAtTopMax: 100,
      swayToleranceShW: 0.90,
    };
    case 'putter': return {
      setupSpineMin: 30, setupSpineMax: 50,
      setupStanceRatioMin: 0.80, setupStanceRatioMax: 1.20,
      hipTurnAtTopMin: 0, hipTurnAtTopMax: 15,
      shoulderTurnAtTopMin: 15, shoulderTurnAtTopMax: 40,
      swayToleranceShW: 0.60,
    };
    case 'unknown':
    default: return {
      setupSpineMin: 25, setupSpineMax: 42,
      setupStanceRatioMin: 1.00, setupStanceRatioMax: 1.45,
      hipTurnAtTopMin: 35, hipTurnAtTopMax: 55,
      shoulderTurnAtTopMin: 78, shoulderTurnAtTopMax: 105,
      swayToleranceShW: 1.05,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase order validation
// ─────────────────────────────────────────────────────────────────────────────
function validatePhases(lms: PerFrameLandmarks): PhaseValidation {
  const havePhases = {
    setup:  !!lms.setup  && lms.setup.length  >= 29,
    top:    !!lms.top    && lms.top.length    >= 29,
    impact: !!lms.impact && lms.impact.length >= 29,
    finish: !!lms.finish && lms.finish.length >= 29,
  };
  const warnings: string[] = [];

  // We require setup + impact minimum.
  if (!havePhases.setup || !havePhases.impact) {
    warnings.push('Setup and impact frames are required for scoring.');
    return { valid: false, warnings, havePhases };
  }

  // Check wrist height progression — at top of backswing, hands should be
  // HIGHER than setup (y less). At finish, hands should be HIGHER than at
  // impact again. If hands trace anything else, the detected phases are
  // probably out of order.
  const handY = (l?: PoseLandmark[] | null) => {
    if (!l) return null;
    const lw = pt(l, LM.LEFT_WRIST);
    const rw = pt(l, LM.RIGHT_WRIST);
    if (lw && rw) return (lw.y + rw.y) / 2;
    if (lw) return lw.y;
    if (rw) return rw.y;
    return null;
  };
  const ySetup  = handY(lms.setup);
  const yTop    = handY(lms.top);
  const yImpact = handY(lms.impact);
  const yFinish = handY(lms.finish);

  if (havePhases.top && ySetup != null && yTop != null && yTop >= ySetup - 0.05) {
    warnings.push('Top-of-backswing frame: hands not visibly above setup position — phase may be mis-detected.');
  }
  if (yImpact != null && ySetup != null && Math.abs(yImpact - ySetup) > 0.18) {
    warnings.push('Impact frame: hands far from setup level — phase may be mis-detected.');
  }
  if (havePhases.finish && yImpact != null && yFinish != null && yFinish >= yImpact - 0.03) {
    warnings.push('Finish frame: hands not visibly above impact — phase may be mis-detected.');
  }

  return { valid: warnings.length === 0, warnings, havePhases };
}

// ─────────────────────────────────────────────────────────────────────────────
// Category scoring helpers
// ─────────────────────────────────────────────────────────────────────────────
const CONFIDENCE_FLOOR = 0.15;

function makeCategory(
  key: CategoryKey,
  weight: number,
  rawScore: number,
  confidence: number,
  metrics: Record<string, number | null>,
  penalties: PenaltyEntry[],
): CategoryScore {
  // Confidence-aware clamping. CRITICAL RULE: confidence NEVER floors a
  // score upward. If the measurements say a swing is bad, the score reflects
  // it. Confidence only caps the TOP end (so we don't broadcast "elite" from
  // low-quality detection) and allows mild softening for uncertainty.
  //   High conf (≥ 0.65): no clamp.
  //   Medium (0.30–0.65): cap top at 92 only.
  //   Low (< 0.30): cap top at 78 only — but bad raw scores stay bad.
  let score = rawScore;
  if (confidence >= 0.65) {
    score = rawScore;
  } else if (confidence >= 0.30) {
    score = Math.min(92, rawScore);
  } else {
    score = Math.min(78, rawScore);
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  const ranked = penalties.slice().sort((a, b) => b.penalty - a.penalty);
  const top = ranked[0];

  return {
    key,
    name: CATEGORY_LABELS[key],
    score,
    rawScore: Math.round(Math.max(0, Math.min(100, rawScore))),
    weight,
    confidence: Math.round(confidence * 100) / 100,
    reason: buildReason(key, score, penalties, confidence),
    topIssue: top?.fault,
    suggestedFix: top?.fix,
    metrics,
    penalties,
  };
}

function buildReason(
  key: CategoryKey,
  score: number,
  penalties: PenaltyEntry[],
  confidence: number,
): string {
  if (confidence < 0.30) {
    return `Could not measure ${CATEGORY_LABELS[key].toLowerCase()} reliably — low landmark visibility.`;
  }
  if (penalties.length === 0) {
    if (score >= 85) return `${CATEGORY_LABELS[key]} is on plan — measurements all in range.`;
    return `${CATEGORY_LABELS[key]} is acceptable — no notable issues measured.`;
  }
  const top = penalties[0];
  return `${top.fault}. Measurement: ${top.metric} = ${top.value} (target ${top.ideal}).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP — posture, knee flex, stance width, shoulder/hip alignment
// ─────────────────────────────────────────────────────────────────────────────
function scoreSetup(
  lms: PerFrameLandmarks,
  profile: ClubProfile,
  shW: number | null,
): CategoryScore {
  const f = lms.setup;
  const metrics: Record<string, number | null> = {};
  const penalties: PenaltyEntry[] = [];
  let totalPenalty = 0;

  if (!f) {
    return makeCategory('setup', CATEGORY_WEIGHTS.setup, 60, 0, metrics, penalties);
  }

  // Confidence: avg visibility of shoulders, hips, knees.
  const conf = avgVis(f, [
    LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP,
    LM.LEFT_KNEE, LM.RIGHT_KNEE,
  ]);

  // 1. Spine tilt (posture) — VERY forgiving range. Measurement is highly
  // camera-angle dependent from 2D pose (face-on sees ~0° lateral, DTL sees
  // forward lean), so we only flag clearly-extreme readings.
  const spine = spineTilt(f);
  metrics.spineTiltDeg = spine != null ? Math.round(spine * 10) / 10 : null;
  if (spine != null) {
    const r = rangePenalty(spine, 12, 55, 12, 30, 10);
    if (r.severity !== 'ok') {
      const fault = spine < profile.setupSpineMin
        ? 'Setup posture too upright — not enough hip hinge'
        : 'Setup posture over-bent — too much forward lean';
      penalties.push({
        metric: 'spineTiltDeg', value: Math.round(spine * 10) / 10,
        ideal: `${profile.setupSpineMin}–${profile.setupSpineMax}°`,
        penalty: r.penalty, severity: r.severity, fault,
        fix: spine < profile.setupSpineMin
          ? 'Hinge from the hips, not the lower back — let your tailbone point back as you tilt forward.'
          : 'Stand a touch taller and keep weight in the middle of your feet.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 2. Trail knee flex
  const trailKnee = trailKneeFlex(f);
  metrics.trailKneeDeg = trailKnee != null ? Math.round(trailKnee * 10) / 10 : null;
  if (trailKnee != null) {
    const r = rangePenalty(trailKnee, 152, 178, 10, 25, 14);
    if (r.severity !== 'ok') {
      const fault = trailKnee < 158
        ? 'Setup trail knee over-flexed (squatty)'
        : 'Setup trail knee locked out';
      penalties.push({
        metric: 'trailKneeDeg', value: Math.round(trailKnee * 10) / 10,
        ideal: '158–175°', penalty: r.penalty, severity: r.severity, fault,
        fix: 'Soft knee flex — about the same amount of bend in each knee.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 3. Stance width relative to shoulder width
  const stance = stanceWidth(f);
  if (stance != null && shW != null && shW > 0.01) {
    const ratio = stance / shW;
    metrics.stanceToShoulderRatio = Math.round(ratio * 100) / 100;
    const isDriverLike = profile.setupStanceRatioMin >= 1.25;
    const stanceYellow = isDriverLike ? 0.10 : 0.18;
    const stanceRed = isDriverLike ? 0.28 : 0.45;
    const stanceMaxPenalty = isDriverLike ? 36 : 18;
    const r = rangePenalty(
      ratio,
      profile.setupStanceRatioMin,
      profile.setupStanceRatioMax,
      stanceYellow,
      stanceRed,
      stanceMaxPenalty,
    );
    if (r.severity !== 'ok') {
      const fault = ratio < profile.setupStanceRatioMin
        ? 'Setup stance too narrow for this club'
        : 'Setup stance too wide for this club';
      penalties.push({
        metric: 'stanceToShoulderRatio', value: Math.round(ratio * 100) / 100,
        ideal: `${profile.setupStanceRatioMin.toFixed(2)}–${profile.setupStanceRatioMax.toFixed(2)}× shoulders`,
        penalty: r.penalty, severity: r.severity, fault,
        fix: ratio < profile.setupStanceRatioMin
          ? 'Widen stance — ankles roughly under the shoulders for a full swing.'
          : 'Bring feet in — overly wide stance restricts the turn.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 4. Shoulder line tilt — for irons/woods, lead shoulder slightly higher.
  const sTilt = shoulderTilt(f);
  metrics.shoulderTiltDeg = sTilt != null ? Math.round(sTilt * 10) / 10 : null;
  // No penalty here for now — driver vs iron variance is wide. Tracked for debug.

  // Cap total per-category penalty — one bad measurement shouldn't tank a
  // whole category below 30 unless multiple severe issues compound.
  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  return makeCategory('setup', CATEGORY_WEIGHTS.setup, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE — head drift, head rise (early extension), hip lateral slide
// ─────────────────────────────────────────────────────────────────────────────
function scoreBalance(
  lms: PerFrameLandmarks,
  profile: ClubProfile,
  shW: number | null,
): CategoryScore {
  const metrics: Record<string, number | null> = {};
  const penalties: PenaltyEntry[] = [];
  let totalPenalty = 0;

  const setup  = lms.setup;
  const impact = lms.impact;
  const finish = lms.finish;

  if (!setup || !impact) {
    return makeCategory('balance', CATEGORY_WEIGHTS.balance, 60, 0, metrics, penalties);
  }

  const conf = (avgVis(setup, [LM.NOSE, LM.LEFT_HIP, LM.RIGHT_HIP]) +
                avgVis(impact, [LM.NOSE, LM.LEFT_HIP, LM.RIGHT_HIP])) / 2;

  const swayTol = profile.swayToleranceShW;
  const unit = shW && shW > 0.01 ? shW : 0.18;

  // 1. Head horizontal drift — RELIABLE metric, tightened to bite real sway.
  const aHead = pt(setup, LM.NOSE);
  const iHead = pt(impact, LM.NOSE);
  if (aHead && iHead) {
    const driftShW = Math.abs(iHead.x - aHead.x) / unit;
    metrics.headDriftShoulderUnits = Math.round(driftShW * 100) / 100;
    const r = bandedPenalty(
      Math.max(0, driftShW - 0.10 * swayTol),
      0.10 * swayTol,
      0.25 * swayTol,
      36,
    );
    if (r.penalty > 0) {
      penalties.push({
        metric: 'headDriftShoulderUnits', value: Math.round(driftShW * 100) / 100,
        ideal: `< ${(0.10 * swayTol).toFixed(2)} shoulder-widths`,
        penalty: r.penalty, severity: r.severity,
        fault: 'Head sway off the ball',
        fix: 'Pretend a wall touches your trail-side temple — turn around your head, not past it.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 2. Head vertical rise (early extension) — RELIABLE high-signal metric.
  // Tight bands so clear early extension (rise > 0.12 sw) registers as severe.
  if (aHead && iHead) {
    const riseShW = (aHead.y - iHead.y) / unit;
    metrics.headRiseShoulderUnits = Math.round(riseShW * 100) / 100;
    if (riseShW > 0.03) {
      const r = bandedPenalty(riseShW - 0.03, 0.05, 0.12, 44);
      if (r.penalty > 0) {
        penalties.push({
          metric: 'headRiseShoulderUnits', value: Math.round(riseShW * 100) / 100,
          ideal: '~ 0 (no head rise into impact)',
          penalty: r.penalty, severity: r.severity,
          fault: 'Early extension at impact — body thrusts toward ball, head rises',
          fix: 'Wall Drill: glutes touching a wall, swing keeping butt on the wall through impact.',
        });
        totalPenalty += r.penalty;
      }
    }
  }

  // 3. Hip lateral slide
  const aLh = pt(setup, LM.LEFT_HIP), aRh = pt(setup, LM.RIGHT_HIP);
  const iLh = pt(impact, LM.LEFT_HIP), iRh = pt(impact, LM.RIGHT_HIP);
  if (aLh && aRh && iLh && iRh) {
    const aMid = mid(aLh, aRh), iMid = mid(iLh, iRh);
    const slideShW = Math.abs(iMid.x - aMid.x) / unit;
    metrics.hipSlideShoulderUnits = Math.round(slideShW * 100) / 100;
    const r = bandedPenalty(
      Math.max(0, slideShW - 0.15 * swayTol),
      0.18 * swayTol,
      0.40 * swayTol,
      24,
    );
    if (r.penalty > 0) {
      penalties.push({
        metric: 'hipSlideShoulderUnits', value: Math.round(slideShW * 100) / 100,
        ideal: `< ${(0.12 * swayTol).toFixed(2)} shoulder-widths`,
        penalty: r.penalty, severity: r.severity,
        fault: 'Lateral hip slide instead of rotation',
        fix: 'Lead Hip Into Wall: feel your lead hip clear up and back, not sideways.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 4. Finish balance — if we have finish frame, head should be over lead foot.
  if (finish) {
    const fHead = pt(finish, LM.NOSE);
    const fLA = pt(finish, LM.LEFT_ANKLE);
    const fRA = pt(finish, LM.RIGHT_ANKLE);
    if (fHead && fLA && fRA && unit > 0) {
      const stanceMid = (fLA.x + fRA.x) / 2;
      const towardLead = (fLA.x - stanceMid); // direction toward lead foot
      const headOffset = (fHead.x - stanceMid);
      const ratio = towardLead === 0 ? 0 : headOffset / towardLead;
      metrics.finishHeadOverLeadFoot = Math.round(ratio * 100) / 100;
      // Want head 0.4–1.1 of the way toward lead foot. < 0 = falling back.
      if (ratio < 0) {
        const r = bandedPenalty(-ratio, 0.30, 0.80, 22);
        penalties.push({
          metric: 'finishHeadOverLeadFoot', value: Math.round(ratio * 100) / 100,
          ideal: '0.4–1.1 toward lead foot',
          penalty: r.penalty, severity: r.severity,
          fault: 'Hanging back at finish — weight stuck on trail side',
          fix: 'Step-Through Drill: step the trail foot forward after impact to feel the transfer.',
        });
        totalPenalty += r.penalty;
      }
    }
  }

  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  return makeCategory('balance', CATEGORY_WEIGHTS.balance, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPO — entirely from temporal metrics
// ─────────────────────────────────────────────────────────────────────────────
function scoreTempo(temporal: TemporalMetrics | undefined): CategoryScore {
  const metrics: Record<string, number | null> = {
    backswingMs:    temporal?.backswingDurationMs ?? null,
    downswingMs:    temporal?.downswingDurationMs ?? null,
    tempoRatio:     temporal?.tempoRatio ?? null,
    motionSmoothness: temporal?.motionSmoothness ?? null,
  };
  const penalties: PenaltyEntry[] = [];

  if (
    temporal?.tempoRatio == null &&
    temporal?.computedTempoScore == null &&
    temporal?.backswingDurationMs == null
  ) {
    // No data — neutral 65 at low confidence
    return makeCategory('tempo', CATEGORY_WEIGHTS.tempo, 65, 0.10, metrics, penalties);
  }

  if (temporal?.computedTempoScore != null) {
    const rawScore = Math.max(0, Math.min(100, temporal.computedTempoScore));
    if (rawScore < 65) {
      penalties.push({
        metric: 'computedTempoScore',
        value: Math.round(rawScore),
        ideal: '75+',
        penalty: Math.round(75 - rawScore),
        severity: rawScore < 50 ? 'severe' : rawScore < 62 ? 'moderate' : 'minor',
        fault: 'Tempo is hurting swing sequencing',
        fix: 'Use a steady 3-to-1 count: three beats back, one beat through.',
      });
    }
    return makeCategory('tempo', CATEGORY_WEIGHTS.tempo, rawScore, 0.90, metrics, penalties);
  }

  let totalPenalty = 0;
  const ratio = temporal?.tempoRatio;

  if (ratio != null) {
    // Tour average ~3.0. Acceptable 2.4-3.6. Rushed < 2.0, lazy > 4.5.
    const r = rangePenalty(ratio, 2.4, 3.6, 0.5, 1.5, 32);
    if (r.severity !== 'ok') {
      const fault = ratio < 2.4
        ? 'Downswing rushed compared to backswing'
        : 'Downswing too slow / lazy transition';
      penalties.push({
        metric: 'tempoRatio', value: Math.round(ratio * 100) / 100,
        ideal: '2.5–3.5 (tour ~3.0)',
        penalty: r.penalty, severity: r.severity, fault,
        fix: ratio < 2.4
          ? 'Practice 3-1 count: "1-2-3" back, "1" through. Keep transition smooth, accelerate AFTER the top.'
          : 'Add a brisk through-swing — "smooth back, athletic through". Don\'t lazily steer the downswing.',
      });
      totalPenalty += r.penalty;
    }
  }

  // Motion smoothness
  if (temporal?.motionSmoothness != null) {
    const ms = temporal.motionSmoothness;
    if (ms < 55) {
      const r = bandedPenalty(55 - ms, 15, 35, 18);
      penalties.push({
        metric: 'motionSmoothness', value: Math.round(ms),
        ideal: '> 65 / 100',
        penalty: r.penalty, severity: r.severity,
        fault: 'Jerky / inconsistent swing motion',
        fix: 'Pump Drill: rehearse smooth halves of the swing slowly before each rep.',
      });
      totalPenalty += r.penalty;
    }
  }

  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  const conf = ratio != null ? 0.85 : 0.55;
  return makeCategory('tempo', CATEGORY_WEIGHTS.tempo, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROTATION — shoulder turn, hip turn, X-factor, impact rotation
// ─────────────────────────────────────────────────────────────────────────────
function scoreRotation(
  lms: PerFrameLandmarks,
  profile: ClubProfile,
): CategoryScore {
  const metrics: Record<string, number | null> = {};
  const penalties: PenaltyEntry[] = [];
  let totalPenalty = 0;

  const setup = lms.setup, top = lms.top, impact = lms.impact;
  if (!setup) {
    return makeCategory('rotation', CATEGORY_WEIGHTS.rotation, 60, 0, metrics, penalties);
  }

  const confSources = [
    avgVis(setup, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP]),
  ];
  if (top) confSources.push(avgVis(top, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP]));
  if (impact) confSources.push(avgVis(impact, [LM.LEFT_HIP, LM.RIGHT_HIP]));
  const conf = confSources.reduce((a, b) => a + b, 0) / confSources.length;

  // 1. Shoulder turn at top — VERY forgiving range. Shoulder rotation around
  // spine axis is hard to measure from 2D — face-on sees clear horizontal
  // shoulder line change, DTL sees occlusion. Wide range, modest penalty.
  if (top) {
    const sSetup = shoulderTilt(setup);
    const sTop = shoulderTilt(top);
    if (sSetup != null && sTop != null) {
      const turn = Math.abs(sTop - sSetup);
      metrics.shoulderTurnAtTopDeg = Math.round(turn * 10) / 10;
      const r = rangePenalty(turn, 45, 130, 20, 45, 12);
      if (r.severity !== 'ok') {
        const fault = turn < profile.shoulderTurnAtTopMin
          ? 'Restricted shoulder turn at top'
          : 'Over-rotated shoulder turn at top';
        penalties.push({
          metric: 'shoulderTurnAtTopDeg', value: Math.round(turn),
          ideal: `${profile.shoulderTurnAtTopMin}–${profile.shoulderTurnAtTopMax}°`,
          penalty: r.penalty, severity: r.severity, fault,
          fix: turn < profile.shoulderTurnAtTopMin
            ? 'Lead Shoulder Under Chin: feel your lead shoulder come UNDER your chin at the top.'
            : 'Keep your trail hip from sliding past parallel — turn, don\'t over-rotate.',
        });
        totalPenalty += r.penalty;
      }
    }

    // 2. Hip turn at top
    const hSetup = hipTilt(setup);
    const hTop = hipTilt(top);
    if (hSetup != null && hTop != null) {
      const hipT = Math.abs(hTop - hSetup);
      metrics.hipTurnAtTopDeg = Math.round(hipT * 10) / 10;
      const r = rangePenalty(hipT, 15, 75, 15, 35, 10);
      if (r.severity !== 'ok') {
        const fault = hipT < profile.hipTurnAtTopMin
          ? 'Hips under-rotated at the top'
          : 'Hips over-rotated at the top';
        penalties.push({
          metric: 'hipTurnAtTopDeg', value: Math.round(hipT),
          ideal: `${profile.hipTurnAtTopMin}–${profile.hipTurnAtTopMax}°`,
          penalty: r.penalty, severity: r.severity, fault,
          fix: hipT < profile.hipTurnAtTopMin
            ? 'Allow your trail hip to clear back — don\'t pin it in place.'
            : 'Resist over-rotating — half-back, half-through awareness.',
        });
        totalPenalty += r.penalty;
      }

      // 3. X-factor (shoulder − hip turn)
      const sSetup2 = shoulderTilt(setup), sTop2 = shoulderTilt(top);
      if (sSetup2 != null && sTop2 != null) {
        const shoulderT = Math.abs(sTop2 - sSetup2);
        const xFactor = shoulderT - hipT;
        metrics.xFactorDeg = Math.round(xFactor * 10) / 10;
        const r2 = rangePenalty(xFactor, 10, 70, 15, 35, 8);
        if (r2.severity !== 'ok') {
          const fault = xFactor < 25
            ? 'Low shoulder-hip differential (X-factor)'
            : 'Excessive shoulder-hip differential';
          penalties.push({
            metric: 'xFactorDeg', value: Math.round(xFactor),
            ideal: '25–55°',
            penalty: r2.penalty, severity: r2.severity, fault,
            fix: xFactor < 25
              ? 'Keep lower body quiet at the top — let shoulders turn while hips stabilize.'
              : 'Allow hips to follow shoulders slightly — don\'t over-restrict.',
          });
          totalPenalty += r2.penalty;
        }
      }
    }
  }

  // 4. Hip rotation at impact — critical, bigger weight
  if (impact) {
    const hSetup = hipTilt(setup);
    const hImp = hipTilt(impact);
    if (hSetup != null && hImp != null) {
      const impRot = Math.abs(hImp - hSetup);
      metrics.hipRotationAtImpactDeg = Math.round(impRot * 10) / 10;
      const r = rangePenalty(impRot, 10, 70, 15, 35, 14);
      if (r.severity !== 'ok') {
        const fault = impRot < 30
          ? 'Hips stuck / not open enough at impact'
          : 'Hips spinning open too aggressively';
        penalties.push({
          metric: 'hipRotationAtImpactDeg', value: Math.round(impRot),
          ideal: '30–55°',
          penalty: r.penalty, severity: r.severity, fault,
          fix: impRot < 30
            ? 'Step-Change Drill: step trail foot through after impact to feel hips clear.'
            : 'Lower-body sequencing — feel hips lead, but don\'t open without arm delivery.',
        });
        totalPenalty += r.penalty;
      }
    }
  }

  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  return makeCategory('rotation', CATEGORY_WEIGHTS.rotation, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// SWING PATH — lead arm at top, wrist height vs shoulder, transition plane
// ─────────────────────────────────────────────────────────────────────────────
function scoreSwingPath(
  lms: PerFrameLandmarks,
  shW: number | null,
): CategoryScore {
  const metrics: Record<string, number | null> = {};
  const penalties: PenaltyEntry[] = [];
  let totalPenalty = 0;

  const top = lms.top, impact = lms.impact;
  if (!top) {
    return makeCategory('swingPath', CATEGORY_WEIGHTS.swingPath, 60, 0.10, metrics, penalties);
  }

  const conf = avgVis(top, [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_ELBOW, LM.RIGHT_WRIST]);

  // 1. Lead arm fold at top — RELIABLE. Collapsed lead arm (< 130°) is a
  // real fault, gets meaningful penalty.
  const topLA = leadArmFold(top);
  if (topLA != null) {
    metrics.topLeadArmDeg = Math.round(topLA);
    const r = rangePenalty(topLA, 140, 180, 8, 22, 28);
    if (r.severity !== 'ok') {
      penalties.push({
        metric: 'topLeadArmDeg', value: Math.round(topLA),
        ideal: '150–180°',
        penalty: r.penalty, severity: r.severity,
        fault: 'Lead arm collapses at the top',
        fix: 'L-to-L Drill: feel a straight lead arm at the top — left arm and shaft form an "L".',
      });
      totalPenalty += r.penalty;
    }
  }

  // 2. Trail arm fold at top
  const topTA = trailArmFold(top);
  if (topTA != null) {
    metrics.topTrailArmDeg = Math.round(topTA);
    const r = rangePenalty(topTA, 65, 125, 12, 30, 14);
    if (r.severity !== 'ok') {
      const fault = topTA < 75
        ? 'Trail arm over-folded — backswing too short'
        : 'Trail arm too straight at top — likely too long / across the line';
      penalties.push({
        metric: 'topTrailArmDeg', value: Math.round(topTA),
        ideal: '75–115°',
        penalty: r.penalty, severity: r.severity, fault,
        fix: 'Headcover Under Trail Arm: keep the trail elbow tucked through the takeaway.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 3. Wrist height vs trail shoulder at top — flat / arm-only check
  const tLw = pt(top, LM.LEFT_WRIST), tRw = pt(top, LM.RIGHT_WRIST);
  const tRs = pt(top, LM.RIGHT_SHOULDER);
  if (tRs && (tLw || tRw)) {
    const wMidY = tLw && tRw ? (tLw.y + tRw.y) / 2 : (tLw ?? tRw)!.y;
    const heightDelta = (tRs.y - wMidY);
    metrics.wristAboveShoulderDelta = Math.round(heightDelta * 1000) / 1000;
    if (heightDelta < -0.02) {
      const r = bandedPenalty(-heightDelta - 0.02, 0.04, 0.10, 18);
      penalties.push({
        metric: 'wristAboveShoulderDelta', value: Math.round(heightDelta * 1000) / 1000,
        ideal: '> 0.02 (wrists above trail shoulder at top)',
        penalty: r.penalty, severity: r.severity,
        fault: 'Flat / arm-only backswing — wrists below shoulder at the top',
        fix: 'Mirror Top-Check: feel hands finish at chin height with full shoulder turn.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 4. Over-the-top check at impact — tighter
  if (impact) {
    const iLw = pt(impact, LM.LEFT_WRIST);
    const iRs = pt(impact, LM.RIGHT_SHOULDER);
    if (iLw && iRs && shW && shW > 0.01) {
      const overshootShW = Math.max(0, iLw.x - iRs.x) / shW;
      metrics.overTopShoulderUnits = Math.round(overshootShW * 100) / 100;
      if (overshootShW > 0.12) {
        const r = bandedPenalty(overshootShW - 0.12, 0.12, 0.30, 22);
        penalties.push({
          metric: 'overTopShoulderUnits', value: Math.round(overshootShW * 100) / 100,
          ideal: '~ 0 (hands tracking inside trail shoulder approaching impact)',
          penalty: r.penalty, severity: r.severity,
          fault: 'Over-the-top — hands move outside trail shoulder in transition',
          fix: 'Pump Drill: pause at top, pump down half-speed, feel trail elbow tuck inside.',
        });
        totalPenalty += r.penalty;
      }
    }
  }

  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  return makeCategory('swingPath', CATEGORY_WEIGHTS.swingPath, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPACT POSITION — the heaviest category. Lead arm, spine retention,
// hip openness, head over ball, weight transfer.
// ─────────────────────────────────────────────────────────────────────────────
function scoreImpactPosition(
  lms: PerFrameLandmarks,
  shW: number | null,
): CategoryScore {
  const metrics: Record<string, number | null> = {};
  const penalties: PenaltyEntry[] = [];
  let totalPenalty = 0;

  const setup = lms.setup, impact = lms.impact;
  if (!setup || !impact) {
    return makeCategory('impactPosition', CATEGORY_WEIGHTS.impactPosition, 60, 0, metrics, penalties);
  }

  const conf = avgVis(impact, [
    LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST,
    LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.NOSE,
  ]);

  // 1. Lead arm at impact — RELIABLE high-signal metric. Tight bands so a
  // clear chicken wing (< 138°) registers as severe.
  const impLA = leadArmFold(impact);
  if (impLA != null) {
    metrics.impactLeadArmDeg = Math.round(impLA);
    const r = rangePenalty(impLA, 148, 180, 5, 14, 44);
    if (r.severity !== 'ok') {
      const fault = impLA < 155 ? 'Chicken wing — bent lead arm at impact' : 'Lead arm hyper-extended at impact';
      penalties.push({
        metric: 'impactLeadArmDeg', value: Math.round(impLA),
        ideal: '155–180°',
        penalty: r.penalty, severity: r.severity, fault,
        fix: impLA < 155
          ? 'Punch-out Drill: hit punch shots focusing on a long, straight lead arm through impact.'
          : 'Allow trail-arm soft release — don\'t hyper-extend.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 2. Spine angle retention setup → impact — camera-dependent, small penalty
  const sS = spineTilt(setup), iS = spineTilt(impact);
  if (sS != null && iS != null) {
    const change = Math.abs(iS - sS);
    metrics.spineTiltChangeDeg = Math.round(change * 10) / 10;
    const r = bandedPenalty(Math.max(0, change - 8), 8, 20, 12);
    if (r.penalty > 0) {
      penalties.push({
        metric: 'spineTiltChangeDeg', value: Math.round(change * 10) / 10,
        ideal: '< 3°',
        penalty: r.penalty, severity: r.severity,
        fault: 'Loss of posture into impact',
        fix: 'Chair Drill: stand with a chair touching your butt at address; keep it touching through impact.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 3. Head horizontal position retention
  const aHead = pt(setup, LM.NOSE), iHead = pt(impact, LM.NOSE);
  if (aHead && iHead && shW && shW > 0.01) {
    const driftShW = Math.abs(iHead.x - aHead.x) / shW;
    metrics.impactHeadDriftShoulderUnits = Math.round(driftShW * 100) / 100;
    if (driftShW > 0.20) {
      const r = bandedPenalty(driftShW - 0.20, 0.15, 0.35, 18);
      penalties.push({
        metric: 'impactHeadDriftShoulderUnits', value: Math.round(driftShW * 100) / 100,
        ideal: '< 0.10 shoulder-widths',
        penalty: r.penalty, severity: r.severity,
        fault: 'Head moves off the ball at impact',
        fix: 'Headcover Outside Trail Foot: keeps the head centered during the turn.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 4. Lead knee extension
  const iLk = leadKneeFlex(impact);
  if (iLk != null) {
    metrics.impactLeadKneeDeg = Math.round(iLk);
    const r = rangePenalty(iLk, 138, 178, 12, 28, 14);
    if (r.severity !== 'ok') {
      const fault = iLk < 145
        ? 'Lead leg too flexed at impact (weight not transferred)'
        : 'Lead leg over-extended / locked at impact';
      penalties.push({
        metric: 'impactLeadKneeDeg', value: Math.round(iLk),
        ideal: '145–175°',
        penalty: r.penalty, severity: r.severity, fault,
        fix: 'Pressure-into-Lead-Heel Drill: feel pressure stack into the lead heel as you post up.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 5. Hip openness at impact — camera-dependent, very small penalty
  const hSet = hipTilt(setup), hImp = hipTilt(impact);
  if (hSet != null && hImp != null) {
    const open = Math.abs(hImp - hSet);
    metrics.impactHipOpenDeg = Math.round(open);
    if (open < 10) {
      const r = bandedPenalty(10 - open, 8, 20, 10);
      penalties.push({
        metric: 'impactHipOpenDeg', value: Math.round(open),
        ideal: '≥ 25° open at impact',
        penalty: r.penalty, severity: r.severity,
        fault: 'Hips not clearing through impact',
        fix: 'Belt-Buckle-to-Target: get the belt buckle pointing target-side at the strike.',
      });
      totalPenalty += r.penalty;
    }
  }

  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  return makeCategory('impactPosition', CATEGORY_WEIGHTS.impactPosition, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-THROUGH — trail knee, rotation completion, finish balance
// ─────────────────────────────────────────────────────────────────────────────
function scoreFollowThrough(
  lms: PerFrameLandmarks,
): CategoryScore {
  const metrics: Record<string, number | null> = {};
  const penalties: PenaltyEntry[] = [];
  let totalPenalty = 0;

  const setup = lms.setup, finish = lms.finish;
  if (!finish) {
    return makeCategory('followThrough', CATEGORY_WEIGHTS.followThrough, 60, 0.10, metrics, penalties);
  }

  const conf = avgVis(finish, [
    LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.NOSE,
  ]);

  // 1. Trail knee — should be near straight (160-180°) as weight transfers.
  const finishTrailK = trailKneeFlex(finish);
  if (finishTrailK != null) {
    metrics.finishTrailKneeDeg = Math.round(finishTrailK);
    const r = rangePenalty(finishTrailK, 145, 180, 15, 35, 18);
    if (r.severity !== 'ok') {
      penalties.push({
        metric: 'finishTrailKneeDeg', value: Math.round(finishTrailK),
        ideal: '155–180°',
        penalty: r.penalty, severity: r.severity,
        fault: 'Incomplete weight transfer — trail leg still loaded at finish',
        fix: 'Step-Through Drill: walk the trail foot forward after impact to feel transfer.',
      });
      totalPenalty += r.penalty;
    }
  }

  // 2. Rotation completion at finish
  if (setup) {
    const sSet = shoulderTilt(setup), sFin = shoulderTilt(finish);
    if (sSet != null && sFin != null) {
      const rot = Math.abs(sFin - sSet);
      metrics.finishShoulderRotationDeg = Math.round(rot);
      const r = rangePenalty(rot, 65, 180, 15, 35, 18);
      if (r.severity !== 'ok' && rot < 75) {
        penalties.push({
          metric: 'finishShoulderRotationDeg', value: Math.round(rot),
          ideal: '≥ 75° (full shoulder rotation through)',
          penalty: r.penalty, severity: r.severity,
          fault: 'Incomplete rotation through to finish',
          fix: 'Hold Finish Drill: hold a balanced, fully-rotated finish for 3 seconds after every rep.',
        });
        totalPenalty += r.penalty;
      }
    }
  }

  // 3. Finish balance — head over lead ankle area.
  const fHead = pt(finish, LM.NOSE);
  const fLA = pt(finish, LM.LEFT_ANKLE), fRA = pt(finish, LM.RIGHT_ANKLE);
  if (fHead && fLA && fRA) {
    const stanceCenter = (fLA.x + fRA.x) / 2;
    const towardLeadX = (fLA.x - stanceCenter);
    const headOffsetX = (fHead.x - stanceCenter);
    const ratio = towardLeadX === 0 ? 0 : headOffsetX / towardLeadX;
    metrics.finishBalanceRatio = Math.round(ratio * 100) / 100;
    // Acceptable: 0.2-1.3 toward lead. Less = trailing back. More = falling.
    if (ratio < 0.1) {
      const r = bandedPenalty(0.1 - ratio, 0.30, 0.70, 22);
      penalties.push({
        metric: 'finishBalanceRatio', value: Math.round(ratio * 100) / 100,
        ideal: '0.4–1.1 toward lead foot',
        penalty: r.penalty, severity: r.severity,
        fault: 'Loss of balance at finish — falling back',
        fix: 'Hold Finish: pose and balance on lead leg until the ball lands.',
      });
      totalPenalty += r.penalty;
    } else if (ratio > 1.6) {
      const r = bandedPenalty(ratio - 1.6, 0.30, 0.80, 20);
      penalties.push({
        metric: 'finishBalanceRatio', value: Math.round(ratio * 100) / 100,
        ideal: '0.4–1.1 toward lead foot',
        penalty: r.penalty, severity: r.severity,
        fault: 'Falling toward the target / off balance at finish',
        fix: 'Hold Finish: anchor lead foot, balance until ball lands.',
      });
      totalPenalty += r.penalty;
    }
  }

  const cappedPenalty = Math.min(totalPenalty, 70);
  const rawScore = Math.max(25, Math.min(100, 100 - cappedPenalty));
  return makeCategory('followThrough', CATEGORY_WEIGHTS.followThrough, rawScore, conf, metrics, penalties);
}

// ─────────────────────────────────────────────────────────────────────────────
// Score banding
// ─────────────────────────────────────────────────────────────────────────────
function bandFor(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'solid';
  if (score >= 60) return 'needs-work';
  if (score >= 50) return 'major-issues';
  return 'poor';
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
export function scoreSwing(opts: {
  landmarks?: PerFrameLandmarks;
  temporal?: TemporalMetrics;
  club?: string;
}): SwingScoringResult {
  const lms: PerFrameLandmarks = opts.landmarks ?? {};
  const club = opts.club ?? 'Unknown';
  const group = detectClubGroup(club);
  const profile = clubProfile(group);

  // Body-size normalization — use the highest-confidence shoulder-width
  // across all four phases. Falls back to ~0.18 (typical face-on frame).
  const shoulderWidths = [
    shoulderWidth(lms.setup), shoulderWidth(lms.top),
    shoulderWidth(lms.impact), shoulderWidth(lms.finish),
  ].filter((w): w is number => w != null && w > 0.01);
  const shW = shoulderWidths.length > 0
    ? shoulderWidths.reduce((a, b) => a + b, 0) / shoulderWidths.length
    : null;

  const phaseValidation = validatePhases(lms);

  // Score each category
  const setupCat        = scoreSetup(lms, profile, shW);
  const balanceCat      = scoreBalance(lms, profile, shW);
  const tempoCat        = scoreTempo(opts.temporal);
  const rotationCat     = scoreRotation(lms, profile);
  const swingPathCat    = scoreSwingPath(lms, shW);
  const impactCat       = scoreImpactPosition(lms, shW);
  const followCat       = scoreFollowThrough(lms);

  const categories: Record<CategoryKey, CategoryScore> = {
    setup:          setupCat,
    balance:        balanceCat,
    tempo:          tempoCat,
    rotation:       rotationCat,
    swingPath:      swingPathCat,
    impactPosition: impactCat,
    followThrough:  followCat,
  };

  // Effective weights — categories with no usable data are excluded and
  // their weight is redistributed proportionally among the others. This
  // prevents a missing-data category (which returns a neutral placeholder)
  // from inflating a bad swing's score.
  //
  // A category is considered "no usable data" when its confidence is below
  // a measurement threshold (0.08). Tempo specifically goes to 0 when no
  // timing metrics were supplied.
  const weightsUsed: Record<CategoryKey, number> = { ...CATEGORY_WEIGHTS };
  const noTempoData = opts.temporal?.tempoRatio == null && opts.temporal?.computedTempoScore == null;

  const excluded: CategoryKey[] = [];
  (Object.keys(categories) as CategoryKey[]).forEach((k) => {
    if (k === 'tempo' && noTempoData) { excluded.push(k); return; }
    if (categories[k].confidence < 0.08) excluded.push(k);
  });

  if (excluded.length > 0) {
    for (const k of excluded) weightsUsed[k] = 0;
    const remainder = (Object.keys(weightsUsed) as CategoryKey[])
      .filter((k) => !excluded.includes(k))
      .reduce((sum, k) => sum + CATEGORY_WEIGHTS[k], 0);
    if (remainder > 0) {
      const factor = 1 / remainder;
      (Object.keys(weightsUsed) as CategoryKey[]).forEach((k) => {
        if (!excluded.includes(k)) weightsUsed[k] = CATEGORY_WEIGHTS[k] * factor;
      });
    }
  }

  // Assign effective weights to each category (for the UI)
  (Object.keys(categories) as CategoryKey[]).forEach((k) => {
    categories[k].weight = weightsUsed[k];
  });

  // ── Outlier suppression — pose tracking from 4 still frames is NOISY.
  // ONE wildly-low category surrounded by clean ones is most likely a
  // single-frame measurement error, and we soften it. Multiple low
  // categories are signs of a genuinely bad swing and stay un-softened.
  //
  // Rule: soften ONLY if the lowest score is ≥ 35 below the 75th percentile
  // AND no other category is more than 12 below the 75th percentile (i.e.
  // the lowest is truly isolated).
  const measured = (Object.keys(categories) as CategoryKey[])
    .filter((k) => !excluded.includes(k));
  if (measured.length >= 4) {
    const allScores = measured.map((k) => categories[k].score);
    const sorted = allScores.slice().sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const lowest = sorted[0];
    const secondLowest = sorted[1];
    const lowestCat = measured.find((k) => categories[k].score === lowest);
    const isolated =
      p75 - lowest >= 35 &&
      p75 - secondLowest <= 12 &&
      lowestCat != null;
    if (isolated && lowestCat) {
      const c = categories[lowestCat];
      const hasSevere = c.penalties.some((p) => p.severity === 'severe');
      const moderateCount = c.penalties.filter((p) => p.severity === 'moderate').length;
      const mayBePoseNoise = c.confidence < 0.45 && !hasSevere && moderateCount <= 1;
      if (mayBePoseNoise) {
        const softened = Math.round(c.score + (p75 - c.score) * 0.35);
        console.log(
          `[scoring] isolated low-confidence outlier suppression: ${CATEGORY_LABELS[lowestCat]} ${c.score} → ${softened} ` +
            `(p75=${p75}, second-lowest=${secondLowest})`,
        );
        c.score = softened;
      } else {
        console.log(
          `[scoring] isolated outlier is supported by confident faults — NOT suppressing ` +
            `${CATEGORY_LABELS[lowestCat]} (score=${c.score}, conf=${c.confidence}, severe=${hasSevere}, moderate=${moderateCount})`,
        );
      }
    } else if (p75 - lowest >= 35) {
      console.log(
        `[scoring] outlier present but not isolated — NOT suppressing ` +
          `(p75=${p75}, lowest=${lowest}, second-lowest=${secondLowest})`,
      );
    }
  }

  // Now compute the weighted sum from possibly-softened category scores
  let totalWeight = 0;
  let weightedScore = 0;
  let weightedConf = 0;
  (Object.keys(categories) as CategoryKey[]).forEach((k) => {
    const w = weightsUsed[k];
    const c = categories[k];
    weightedScore += c.score * w;
    weightedConf += c.confidence * w;
    totalWeight += w;
  });

  const overallScoreRaw = totalWeight > 0 ? weightedScore / totalWeight : 55;
  const confidenceScore = totalWeight > 0
    ? Math.max(CONFIDENCE_FLOOR, weightedConf / totalWeight)
    : 0;

  // Final confidence adjustment — same rule as per-category: confidence only
  // caps the TOP end. Bad swings score badly regardless of confidence; great
  // swings can't claim "elite" without high-confidence data.
  let overallScore = overallScoreRaw;
  let confLevel: ConfidenceLevel = 'high';
  let confMultNote = 1;
  if (confidenceScore < 0.30) {
    confLevel = 'low';
    overallScore = Math.min(78, Math.round(overallScoreRaw));
    confMultNote = 0.65;
  } else if (confidenceScore < 0.55) {
    confLevel = 'medium';
    overallScore = Math.min(92, Math.round(overallScoreRaw));
    confMultNote = 0.85;
  } else {
    overallScore = Math.round(overallScoreRaw);
  }

  // Compound-fault amplifier — multiple SEVERE faults compound. A swing
  // with corroborating evidence of brokenness (e.g. head rise + chicken
  // wing + hip slide all firing severe) gets pulled down further.
  const allPenalties = Object.values(categories).flatMap((c) => c.penalties);
  const severeCount = allPenalties.filter((p) => p.severity === 'severe').length;
  const moderateCount = allPenalties.filter((p) => p.severity === 'moderate').length;
  let compoundDeduction = 0;
  if (severeCount >= 4) compoundDeduction = 12;
  else if (severeCount >= 3) compoundDeduction = 8;
  else if (severeCount >= 2) compoundDeduction = 5;
  else if (severeCount >= 1) compoundDeduction = 2;
  if (moderateCount + severeCount * 2 >= 8) compoundDeduction += 5;
  else if (moderateCount + severeCount * 2 >= 5) compoundDeduction += 2;
  if (compoundDeduction > 0) {
    console.log(`[scoring] compound-fault deduction: -${compoundDeduction} (severe=${severeCount}, moderate=${moderateCount})`);
    overallScore = Math.max(0, overallScore - compoundDeduction);
  }

  // Phase validation: cap and warn. Phase detection uncertainty does NOT
  // raise scores — it only caps the high end.
  const warnings: string[] = [];
  warnings.push(...phaseValidation.warnings);

  let isLeaderboardEligible = confLevel === 'high' && phaseValidation.valid;

  if (!phaseValidation.valid) {
    overallScore = Math.min(overallScore, 68);
    warnings.push('Phase detection uncertain — score capped and excluded from leaderboards.');
    isLeaderboardEligible = false;
    if (confLevel === 'high') confLevel = 'medium';
  }

  if (confLevel === 'low') {
    overallScore = Math.min(overallScore, 65);
    warnings.push('Low-confidence analysis — re-film with better lighting and a clearer camera angle for a precise score.');
  }

  overallScore = Math.max(0, Math.min(100, overallScore));

  const topFaults = Object.values(categories)
    .flatMap((c) => c.penalties.map((p) => ({ fault: p.fault, penalty: p.penalty, severity: p.severity })))
    .sort((a, b) => b.penalty - a.penalty)
    .map((x) => x.fault);

  const band = bandFor(overallScore);

  // Build the debug log
  const debugLines: string[] = [];
  debugLines.push('═══ ImpactAI Scoring Engine v4 ═══');
  debugLines.push(`Club: ${club} (group=${group})`);
  debugLines.push(`Phases present: setup=${phaseValidation.havePhases.setup} top=${phaseValidation.havePhases.top} impact=${phaseValidation.havePhases.impact} finish=${phaseValidation.havePhases.finish}`);
  debugLines.push(`Phase order valid: ${phaseValidation.valid}` + (phaseValidation.warnings.length ? ` (warnings: ${phaseValidation.warnings.length})` : ''));
  debugLines.push(`Shoulder-width unit: ${shW != null ? shW.toFixed(3) : 'fallback'}`);
  debugLines.push(`Confidence aggregate: ${(confidenceScore * 100).toFixed(0)}% → ${confLevel}`);
  debugLines.push(`Overall: ${overallScore} (${BAND_LABELS[band]}, raw=${overallScoreRaw.toFixed(1)})`);
  debugLines.push('────────────────────────────────────');
  (Object.keys(categories) as CategoryKey[]).forEach((k) => {
    const c = categories[k];
    debugLines.push(
      `${CATEGORY_LABELS[k].padEnd(16)} ` +
        `score=${String(c.score).padStart(3)} ` +
        `raw=${String(c.rawScore).padStart(3)} ` +
        `w=${(c.weight * 100).toFixed(0).padStart(2)}% ` +
        `conf=${(c.confidence * 100).toFixed(0)}%` +
        (c.topIssue ? `   issue: ${c.topIssue}` : ''),
    );
    for (const p of c.penalties) {
      debugLines.push(`    • ${p.metric}=${p.value} (target ${p.ideal}) → −${p.penalty} (${p.severity})`);
    }
  });
  if (warnings.length > 0) {
    debugLines.push('────────────────────────────────────');
    debugLines.push('Warnings:');
    for (const w of warnings) debugLines.push(`  - ${w}`);
  }

  return {
    overallScore,
    band,
    bandLabel: BAND_LABELS[band],
    categories,
    confidence: confLevel,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
    phaseValidation,
    isLeaderboardEligible,
    warnings,
    topFaults,
    club: { selected: club, group },
    debug: {
      bodyUnit: shW,
      weightsUsed,
      confidenceMultiplier: confMultNote,
      log: debugLines.join('\n'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter — convert v4 scoring result to the legacy v3 SwingScores shape
// used by existing UI code so old screens keep working. The UI can also
// read result.scoringV4 directly when it knows about v4.
// ─────────────────────────────────────────────────────────────────────────────
export function toLegacyScores(r: SwingScoringResult): {
  overallScore: number;
  positionScore: number;
  tempoScore: number;
  sequenceScore: number;
  stabilityScore: number;
  contactScore: number;
  confidence: number;
} {
  const c = r.categories;
  return {
    overallScore:   r.overallScore,
    // position ~ blend of setup + impact-position geometry
    positionScore:  Math.round((c.setup.score + c.impactPosition.score) / 2),
    tempoScore:     c.tempo.score,
    // sequence ~ rotation
    sequenceScore:  c.rotation.score,
    // stability ~ balance
    stabilityScore: c.balance.score,
    // contact ~ impact position
    contactScore:   c.impactPosition.score,
    // confidence: convert 0-1 to 1-10 scale used by legacy field
    confidence:     Math.max(1, Math.min(10, Math.round(r.confidenceScore * 10))),
  };
}

export function legacyReasoning(r: SwingScoringResult): {
  position: string;
  tempo: string;
  sequence: string;
  stability: string;
  contact: string;
} {
  const c = r.categories;
  return {
    position:  `${c.setup.reason} ${c.impactPosition.reason}`.trim(),
    tempo:     c.tempo.reason,
    sequence:  c.rotation.reason,
    stability: c.balance.reason,
    contact:   c.impactPosition.reason,
  };
}
