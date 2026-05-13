import { SwingResult, SwingScores, TemporalMetrics, PoseLandmark } from '@/types';

const OPENROUTER_API_KEY  = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─────────────────────────────────────────────────────────────────────────────
// Weighted overall score — backend owns this, AI never sets it directly
// ─────────────────────────────────────────────────────────────────────────────
export function calculateOverallScore(scores: SwingScores): number {
  return Math.round(
    scores.positionScore  * 0.25 +
    scores.tempoScore     * 0.20 +
    scores.sequenceScore  * 0.20 +
    scores.stabilityScore * 0.20 +
    scores.contactScore   * 0.15
  );
}

// Maps issueCategory → which SwingScores key should be the lowest
const ISSUE_TO_SCORE_KEY: Record<string, 'positionScore' | 'tempoScore' | 'sequenceScore' | 'stabilityScore' | 'contactScore'> = {
  setup:    'positionScore',
  posture:  'stabilityScore',
  path:     'sequenceScore',
  clubface: 'contactScore',
  tempo:    'tempoScore',
  contact:  'contactScore',
  balance:  'stabilityScore',
  rotation: 'sequenceScore',
};

// ─────────────────────────────────────────────────────────────────────────────
// Generic / duplicate detection
// ─────────────────────────────────────────────────────────────────────────────
const GENERIC_PHRASES = [
  'work on fundamentals', 'improve consistency', 'keep practicing',
  'needs practice', 'work on your game', 'focus on consistency',
];

function isGenericAnalysis(result: SwingResult): boolean {
  if (result.scores) {
    const s = result.scores;
    const allKeys = ['positionScore', 'tempoScore', 'sequenceScore', 'stabilityScore', 'contactScore'] as const;
    const vals = allKeys.map((k) => s[k] as number);
    const spread = Math.max(...vals) - Math.min(...vals);

    // All 5 scores too similar — AI isn't differentiating
    if (spread < 12) {
      console.warn('[openrouter] generic: scores too clustered (spread=' + spread + ')');
      return true;
    }

    // Issue category not far enough below the others
    const issueKey = ISSUE_TO_SCORE_KEY[result.issueCategory ?? ''];
    if (issueKey && s[issueKey] != null) {
      const issueScore = s[issueKey] as number;
      const others = allKeys
        .filter((k) => k !== issueKey)
        .map((k) => s[k] as number);
      const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
      if (avgOthers - issueScore < 12) {
        console.warn(`[openrouter] generic: issue gap too small (${issueKey}=${issueScore} avg-others=${avgOthers.toFixed(0)})`);
        return true;
      }
    }

    // Non-issue scores too clustered — AI didn't differentiate what's good vs. ok
    const issueKeyForFilter = ISSUE_TO_SCORE_KEY[result.issueCategory ?? ''];
    const nonIssueVals = allKeys
      .filter((k) => k !== issueKeyForFilter)
      .map((k) => s[k] as number);
    const nonIssueSpread = Math.max(...nonIssueVals) - Math.min(...nonIssueVals);
    if (nonIssueVals.length >= 3 && nonIssueSpread < 8) {
      console.warn(`[openrouter] generic: non-issue scores clustered (spread=${nonIssueSpread})`);
      return true;
    }
  }

  if (!result.evidence || result.evidence.length < 3) {
    console.warn('[openrouter] generic: insufficient evidence');
    return true;
  }
  const evidenceLower = result.evidence.join(' ').toLowerCase();
  if (GENERIC_PHRASES.some(p => evidenceLower.includes(p))) {
    console.warn('[openrouter] generic: evidence contains generic phrase');
    return true;
  }
  return false;
}

function isTooSimilarToPrevious(current: SwingResult, previous: SwingResult): boolean {
  if (
    current.primaryIssue === previous.primaryIssue &&
    current.drill?.name  === previous.drill?.name &&
    current.scores?.overallScore === previous.scores?.overallScore
  ) {
    console.warn('[openrouter] duplicate: same issue, drill, and score as previous swing');
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────
// Compact PGA-instructor prompt. Was ~3000 tokens — tightened to ~1500 by
// turning prose into tables, dropping repeated framing, and inlining the
// essential rules. Schema, tempo rule, primary-issue gap rule, and score
// differentiation rule are preserved exactly (validateAndFix enforces them).
const SYSTEM_PROMPT = `You are an elite PGA Tour instructor (Sean Foley / Butch Harmon level). Analyze with biomechanics and the P-system. Be specific, anatomy-aware, root-cause first.

FRAMES: 4 phase-aligned in order — P1 Address → P4 Top → P6/P7 Impact → P9 Finish.

CAMERA ANGLE — call it first.
- Down-the-line (behind golfer): see shaft plane, club path, trail elbow, right-side bend at impact, trail hip clearance, head dive. Cannot see: hip slide, X-factor.
- Face-on (facing chest): see weight shift, hip slide vs. rotation, head sway, shaft lean at impact, lead-arm angle at top, secondary tilt, finish balance. Cannot see: club path direction, shaft plane.
- If unclear, say so and set confidence 4-6.

SCORING CATEGORIES (1-100):
- positionScore — static geometry at P1/P4/P7/P9 (stance, grip, posture from hips, ball position, lead-arm angle at top, shaft plane, handle ahead at impact, balanced finish).
- sequenceScore — kinematic chain. Lower body initiates downswing (proximal-to-distal). Flags: over-the-top, casting, reverse pivot.
- stabilityScore — postural integrity. Head drift <2", spine angle held into impact (early extension = hips thrust to ball), trail leg flex similar to address, balanced finish.
- contactScore — impact geometry. Shaft lean appropriate to club, lead wrist flat/bowed, trail wrist bent, low point relative to ball, face square to path.
- tempoScore — TIMING ONLY. See TEMPO RULE below.

TEMPO RULE (non-negotiable):
- If computedTempoScore is provided: tempoScore = that exact value.
- If computedTempoScore ≥ 75: do NOT use "tempo" as issueCategory.
- If no metrics: tempoScore = 68 and NEVER use "tempo" as issueCategory.

SCORING SCALE:
90-100 tour | 80-89 single-digit | 70-79 one visible flaw | 60-69 clear fault | 50-59 major break | <50 severe.

PRIMARY ISSUE — issueCategory's score MUST be ≥22 below the AVG of the other four. Push the issue score down until that gap holds.

DIFFERENTIATION — the four non-issue categories must vary; no two within 4 points unless evidence forces it. Ask "what does THIS swing do well?" and score that high (80s). What does it do poorly outside the main issue? Score lower (60s).

EVIDENCE — each string names a specific body part / angle / position at a specific frame.
GOOD: "At P4 the lead arm has folded to ~80° — across the line, an arm-pickup backswing."
GOOD: "Through impact the right hip has thrust toward the ball — head has risen ~3" vs. address (early extension)."
BAD: "Work on your posture." "Needs practice."
If a checkpoint is GOOD, name it: "Posture at P1 is on-plane — hips tilted from the joint, arms hanging below shoulders."

DRILLS — use established ones, match to the root cause, explain why mechanically:
- Over-the-top → Pump Drill, Headcover Under Trail Arm, Anti-Casting Pump
- Early extension → Wall Drill (glutes on wall), Chair Drill, Pelvic Tilt Hold
- Casting / early release → Punch shot lead-hand only, Towel Under Both Armpits
- Sway → Headcover Outside Trail Foot, Wall-Behind-Lead-Hip
- Steep / chicken wing → Pump-to-Slot, Tucked-Elbow Throw
- Stuck on trail side → Step-Change (Sam Snead step-through)
- Reverse pivot → Lead-Heel-Up at Top, Cross-Foot Hit

CLUB-SPECIFIC IMPACT TARGETS:
- Driver: attack +3 to +5°, neutral-to-back shaft, ball forward, secondary tilt, trail-side bend.
- 3W/hybrid: slight up, ball inside lead heel, sweeping bottom.
- Long irons (2-5): shaft lean 4-6°, attack -2 to -4°, divot after ball.
- Mid irons (6-8): shaft lean 5-8°, attack -3 to -5°, ball-then-turf.
- Short irons (9-PW): shaft lean 6-10°, attack -4 to -6°, clear divot.
- Wedges: shaft lean 5-12°, attack -3 to -7°, hands lead.
Don't give driver advice for a wedge or vice versa.

FAULT VOCABULARY (use these names): over the top | early extension | casting / early release | steep | sway | reverse pivot | chicken wing | stuck | hanging back.

OUTPUT — JSON ONLY. Start with { end with }. No prose, no markdown.

{
  "selectedClub": "string",
  "detectedClubType": "string",
  "clubMatch": "match | possible_mismatch | unclear",
  "clubMatchReason": "string",
  "cameraAngle": "down-the-line | face-on | unclear",
  "scores": {
    "overallScore": 0,
    "positionScore": 0,
    "tempoScore": 0,
    "sequenceScore": 0,
    "stabilityScore": 0,
    "contactScore": 0,
    "confidence": 0
  },
  "primaryIssue": "string — precise mechanical fault, e.g. 'Early extension at impact'",
  "issueCategory": "setup | posture | path | clubface | tempo | contact | balance | rotation | unclear",
  "whyItHappens": "string — biomechanical root cause in 1-2 sentences",
  "ballFlightPrediction": "string — start direction, curve, height, distance vs. expected",
  "contactPrediction": "string — face location, divot, sound/feel",
  "evidence": ["string", "string", "string", "string"],
  "scoreReasoning": {
    "position": "string",
    "tempo":    "string — reference the metric or say 'no timing data — neutral 68'",
    "sequence": "string",
    "stability":"string",
    "contact":  "string"
  },
  "clubSpecificNotes": "string",
  "fixes": ["string", "string", "string"],
  "drill": {
    "name": "string — established drill name",
    "whyThisDrill": "string — mechanical reason it targets the fault",
    "steps": ["string", "string", "string"]
  },
  "keyCheckpoints": ["string", "string", "string"],
  "summary": "string — 2-3 sentences: issue → fix → expected outcome"
}`;

const SECOND_PASS_SUFFIX = `

SECOND PASS — the first analysis was rejected for one or more of these reasons:
• All 5 category scores were too close together (less than 12 pts spread)
• The non-issue categories were identical or near-identical
• Tempo was flagged as the primary issue without timing data to support it
• Evidence was too generic

You MUST fix all of the above:
1. Find THIS swing's single biggest fault. Name it precisely (e.g. "early extension at impact" not "posture issue").
2. Score the four non-issue categories as INDEPENDENT observations — not all at 70-75.
3. If tempo was your previous issue but no timing metrics exist, pick a different issueCategory.
4. Evidence must name specific body parts, joint angles, or positions you can see in the frames.
5. The issue category score must be ≥ 22 points below the average of the other four.`;

// ─────────────────────────────────────────────────────────────────────────────
// API call
// ─────────────────────────────────────────────────────────────────────────────
// Pose-derived numeric hints for a single phase frame.
// We compute these from MediaPipe landmarks (when available) so the model has
// concrete anchor measurements to reason from, not just pixels. Numbers are
// rounded; angles are in degrees with the conventions described inline.
interface PhaseGeometry {
  phase: 'address' | 'top' | 'impact' | 'finish';
  spineTiltDeg?: number;      // 0 = vertical, + = away from target (down-the-line view)
  shoulderTiltDeg?: number;   // shoulder line vs. horizontal (+ = lead shoulder higher)
  hipTiltDeg?: number;        // hip line vs. horizontal
  headXNorm?: number;         // 0..1 normalized horizontal head position
  headYNorm?: number;         // 0..1 normalized vertical head position
  leadArmFoldDeg?: number;    // 180 = straight, 90 = fully folded
  trailArmFoldDeg?: number;
  kneeFlexLeadDeg?: number;
  kneeFlexTrailDeg?: number;
}

// MediaPipe BlazePose joint indices we care about
const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function v(lms: PoseLandmark[], idx: number): { x: number; y: number; vis: number } | null {
  const p = lms[idx];
  if (!p || (p.visibility ?? 1) < 0.35) return null;
  return { x: p.x, y: p.y, vis: p.visibility ?? 1 };
}

function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
}

function lineTiltDeg(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  // Angle of the line p1→p2 against horizontal, in degrees. Positive = p2 above p1
  // (image y increases downward, so we negate dy to get visual "up" as positive).
  const dx = p2.x - p1.x;
  const dy = -(p2.y - p1.y);
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

function computeGeometry(phase: PhaseGeometry['phase'], lms?: PoseLandmark[] | null): PhaseGeometry | null {
  if (!lms || lms.length < 29) return null;
  const ls = v(lms, LM.LEFT_SHOULDER);
  const rs = v(lms, LM.RIGHT_SHOULDER);
  const lh = v(lms, LM.LEFT_HIP);
  const rh = v(lms, LM.RIGHT_HIP);
  const lw = v(lms, LM.LEFT_WRIST);
  const rw = v(lms, LM.RIGHT_WRIST);
  const le = v(lms, LM.LEFT_ELBOW);
  const re = v(lms, LM.RIGHT_ELBOW);
  const lk = v(lms, LM.LEFT_KNEE);
  const rk = v(lms, LM.RIGHT_KNEE);
  const la = v(lms, LM.LEFT_ANKLE);
  const ra = v(lms, LM.RIGHT_ANKLE);
  const head = v(lms, LM.NOSE);

  const out: PhaseGeometry = { phase };
  const r1 = (n: number | undefined) => (typeof n === 'number' ? Math.round(n * 10) / 10 : undefined);

  if (ls && rs && lh && rh) {
    // Spine: midpoint of shoulders → midpoint of hips. Tilt vs. vertical (90°).
    const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    const spineLineTilt = lineTiltDeg(hipMid, shoulderMid);  // angle vs. horizontal
    out.spineTiltDeg = r1(spineLineTilt - 90);                // 0 = perfectly vertical
  }
  if (ls && rs) {
    // Shoulder line tilt vs. horizontal. +ve = lead (left for RH) shoulder higher.
    out.shoulderTiltDeg = r1(lineTiltDeg(rs, ls));
  }
  if (lh && rh) {
    out.hipTiltDeg = r1(lineTiltDeg(rh, lh));
  }
  if (head) {
    out.headXNorm = r1(head.x * 100) != null ? Math.round(head.x * 1000) / 1000 : undefined;
    out.headYNorm = r1(head.y * 100) != null ? Math.round(head.y * 1000) / 1000 : undefined;
  }
  if (ls && le && lw) out.leadArmFoldDeg = r1(angleDeg(ls, le, lw));
  if (rs && re && rw) out.trailArmFoldDeg = r1(angleDeg(rs, re, rw));
  if (lh && lk && la) out.kneeFlexLeadDeg = r1(angleDeg(lh, lk, la));
  if (rh && rk && ra) out.kneeFlexTrailDeg = r1(angleDeg(rh, rk, ra));

  return out;
}

interface PerFrameLandmarks {
  setup?: PoseLandmark[] | null;
  top?: PoseLandmark[] | null;
  impact?: PoseLandmark[] | null;
  finish?: PoseLandmark[] | null;
}

async function callOpenRouter(
  base64Frames: string[],
  club: string | undefined,
  systemPrompt: string,
  temporalMetrics?: TemporalMetrics,
  landmarks?: PerFrameLandmarks,
): Promise<string> {
  const imageContent = base64Frames
    .filter((f) => f.length > 0)
    .map((frame) => ({
      type: 'image_url' as const,
      // 'auto' lets the model pick resolution — 'low' was shrinking frames to
      // 512px thumbnails where swing mechanics are invisible
      image_url: { url: `data:image/jpeg;base64,${frame}`, detail: 'auto' as const },
    }));

  const hasMetrics = temporalMetrics != null;
  const metricsBlock = hasMetrics
    ? {
        backswingDurationMs: temporalMetrics!.backswingDurationMs,
        downswingDurationMs: temporalMetrics!.downswingDurationMs,
        tempoRatio:          temporalMetrics!.tempoRatio,
        motionSmoothness:    temporalMetrics!.motionSmoothness,
        computedTempoScore:  temporalMetrics!.computedTempoScore,
        note: 'tempoRatio = backswing ÷ downswing. Tour average ≈ 3.0. computedTempoScore is authoritative.',
      }
    : null;

  const geometry: PhaseGeometry[] = [];
  if (landmarks) {
    const setupG  = computeGeometry('address', landmarks.setup);
    const topG    = computeGeometry('top',     landmarks.top);
    const impactG = computeGeometry('impact',  landmarks.impact);
    const finishG = computeGeometry('finish',  landmarks.finish);
    for (const g of [setupG, topG, impactG, finishG]) if (g) geometry.push(g);
  }

  // Compute movement deltas address→impact: lateral head sway, head rise,
  // hip-vs-shoulder rotation differential. These flag early extension, swaying,
  // and over-rotation without the model having to eyeball pixels.
  const deltas: Record<string, number> = {};
  const a = landmarks?.setup;
  const i = landmarks?.impact;
  if (a && i && a.length >= 29 && i.length >= 29) {
    const aHead = v(a, LM.NOSE);
    const iHead = v(i, LM.NOSE);
    if (aHead && iHead) {
      deltas.headHorizontalDriftPct = Math.round((iHead.x - aHead.x) * 1000) / 10; // % of frame width
      deltas.headVerticalRisePct    = Math.round((aHead.y - iHead.y) * 1000) / 10; // + = head moved up (early extension)
    }
    const aLh = v(a, LM.LEFT_HIP), aRh = v(a, LM.RIGHT_HIP);
    const iLh = v(i, LM.LEFT_HIP), iRh = v(i, LM.RIGHT_HIP);
    if (aLh && aRh && iLh && iRh) {
      const aHipMid = { x: (aLh.x + aRh.x) / 2, y: (aLh.y + aRh.y) / 2 };
      const iHipMid = { x: (iLh.x + iRh.x) / 2, y: (iLh.y + iRh.y) / 2 };
      deltas.hipLateralSlidePct = Math.round((iHipMid.x - aHipMid.x) * 1000) / 10;
      deltas.hipRotationDeg = Math.round((lineTiltDeg(iRh, iLh) - lineTiltDeg(aRh, aLh)) * 10) / 10;
    }
  }

  const tempoInstruction = hasMetrics
    ? `Tempo metrics provided above — use computedTempoScore (${temporalMetrics!.computedTempoScore}) for tempoScore. ${
        (temporalMetrics!.computedTempoScore ?? 0) >= 75
          ? 'Tempo is acceptable — do NOT use "tempo" as issueCategory.'
          : 'Tempo ratio is poor — "tempo" is a valid issueCategory.'
      }`
    : 'NO timing data available — set tempoScore=68 and do NOT use "tempo" as issueCategory. Tempo cannot be assessed from still frames.';

  const geometryBlock = geometry.length > 0
    ? `\nPose-derived geometry per phase (degrees; spineTilt 0=vertical; angles from MediaPipe — use as anchors, but trust your eyes too):\n${JSON.stringify(geometry, null, 2)}`
    : '';

  const deltasBlock = Object.keys(deltas).length > 0
    ? `\nAddress→Impact deltas (in % of frame for translations, degrees for rotations):\n${JSON.stringify(deltas, null, 2)}\nInterpretation hints:\n• headVerticalRisePct > 1.5 → likely early extension\n• |hipLateralSlidePct| > 6 → lateral hip slide rather than rotation\n• hipRotationDeg < 20 (FO view) → hips under-rotated at impact`
    : '';

  const userText = `Analyze this golf swing like a top-100 PGA instructor. Be specific, anatomy-aware, and brutal about differentiation.

Selected club: ${club ?? 'unknown'}
Frames: ${imageContent.length} phase-aligned frames in order: P1 Address → P4 Top → P6/P7 Impact → P9 Finish.

${metricsBlock ? `Timing metrics:\n${JSON.stringify(metricsBlock, null, 2)}` : 'No timing metrics available.'}${geometryBlock}${deltasBlock}

TEMPO INSTRUCTION: ${tempoInstruction}

Step 1: Determine cameraAngle (down-the-line, face-on, or unclear) — analyze accordingly.
Step 2: Walk through P1→P4→P7→P9. Note one specific thing at each.
Step 3: Identify the single most damaging fault. Score that category at least 22 below the average of the others.
Step 4: Score the four non-issue categories independently — they MUST vary, not cluster.

Return ONLY the JSON object — start with { end with }.`;

  const response = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://impactai.app',
      'X-Title': 'ImpactAI Golf Coach',
    },
    body: JSON.stringify({
      // gpt-4o-mini is ~3x faster than gpt-4o for vision tasks while still
      // handling JSON-schema output reliably. The structured prompt above
      // does the heavy lifting; the model size matters less when the rules
      // are explicit. If quality regresses, swap back to 'openai/gpt-4o'.
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'text', text: userText }, ...imageContent] },
      ],
      // 1500 covers a full structured response (typical output ~1000-1300
      // tokens). Was 2500 — the extra ceiling just slowed generation.
      max_tokens: 1500,
      temperature: 0.20,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    console.error('[openrouter] API error body:', errBody.slice(0, 200));
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse + validate
// ─────────────────────────────────────────────────────────────────────────────
function parseResult(content: string): SwingResult | null {
  try {
    const start = content.indexOf('{');
    const end   = content.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(content.slice(start, end + 1)) as SwingResult;
  } catch {
    return null;
  }
}

function clamp(v: number | undefined, min = 1, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v || 50)));
}

function validateAndFix(result: SwingResult, club?: string, temporalMetrics?: TemporalMetrics): SwingResult {
  if (!result.evidence || !Array.isArray(result.evidence)) result.evidence = [];

  if (!result.scores) {
    result.scores = {
      overallScore: 50, positionScore: 50, tempoScore: 50,
      sequenceScore: 50, stabilityScore: 50, contactScore: 50, confidence: 3,
    };
  }

  const s = result.scores;

  // Handle AI returning old-schema field names — map them to new categories
  if (!s.positionScore  && (s.setupScore || s.postureScore)) {
    s.positionScore  = clamp(((s.setupScore ?? 50) + (s.postureScore ?? 50)) / 2);
  }
  if (!s.sequenceScore  && s.swingPathScore) s.sequenceScore  = clamp(s.swingPathScore);
  if (!s.stabilityScore && s.balanceScore)   s.stabilityScore = clamp(s.balanceScore);

  s.positionScore  = clamp(s.positionScore);
  s.sequenceScore  = clamp(s.sequenceScore);
  s.stabilityScore = clamp(s.stabilityScore);
  s.contactScore   = clamp(s.contactScore);
  s.confidence     = clamp(s.confidence, 1, 10);

  // Tempo: prefer the deterministic computed score from pose metrics
  const computedTempo = temporalMetrics?.computedTempoScore;
  s.tempoScore = computedTempo != null ? computedTempo : clamp(s.tempoScore);

  // ── Tempo gating: if backend says tempo is fine (≥75) or no data exists,
  //    the AI cannot call "tempo" the primary issue — reassign to actual worst ─
  const allScoreKeys = ['positionScore', 'tempoScore', 'sequenceScore', 'stabilityScore', 'contactScore'] as const;
  if (result.issueCategory === 'tempo') {
    const tempoIsGood = computedTempo != null && computedTempo >= 75;
    const noTempoData = computedTempo == null;
    if (tempoIsGood || noTempoData) {
      const NON_TEMPO: (typeof allScoreKeys[number])[] = ['positionScore', 'sequenceScore', 'stabilityScore', 'contactScore'];
      const worst = NON_TEMPO.reduce((a, b) => (s[a] as number) <= (s[b] as number) ? a : b);
      const catMap: Record<string, string> = {
        positionScore: 'setup', sequenceScore: 'rotation',
        stabilityScore: 'balance', contactScore: 'contact',
      };
      const reason = tempoIsGood
        ? `tempo is fine (computed=${computedTempo})`
        : 'no temporal data — cannot assess from frames';
      console.log(`[openrouter] overriding tempo issue (${reason}) → ${catMap[worst]} (score=${s[worst]})`);
      result.issueCategory = catMap[worst] as SwingResult['issueCategory'];
    }
  }

  // ── Enforce: issue category must score at least 20 pts below avg of others ──
  const issueKey = ISSUE_TO_SCORE_KEY[result.issueCategory ?? ''];
  if (issueKey && s[issueKey] != null) {
    const otherScores = allScoreKeys
      .filter((k) => k !== issueKey)
      .map((k) => s[k] as number);
    const avgOthers = otherScores.reduce((a, b) => a + b, 0) / otherScores.length;
    const currentIssue = s[issueKey] as number;

    if (avgOthers - currentIssue < 20) {
      const corrected = Math.round(Math.max(28, Math.min(currentIssue, avgOthers - 22)));
      console.log(`[openrouter] enforcing issue gap: ${issueKey} ${currentIssue}→${corrected} (others avg=${avgOthers.toFixed(1)})`);
      (s as unknown as Record<string, number>)[issueKey] = corrected;
    }
  }

  // Always recalculate overall from the weighted formula
  const calculated = calculateOverallScore(s);
  const aiScore = s.overallScore || 0;
  if (Math.abs(aiScore - calculated) > 10) {
    console.log(`[openrouter] correcting overallScore: AI=${aiScore} → formula=${calculated}`);
  }
  s.overallScore = calculated;

  // Ensure score reasoning has new field names
  if (result.scoreReasoning) {
    const r = result.scoreReasoning;
    if (!r.position  && r.setup)     r.position  = r.setup;
    if (!r.sequence  && r.swingPath) r.sequence  = r.swingPath;
    if (!r.stability && r.balance)   r.stability = r.balance;
  }

  if (!Array.isArray(result.fixes) || result.fixes.length < 3) {
    result.fixes = (result.fixes ?? []).concat(['Review your fundamentals.', 'Film your swing.', 'Work with a coach.']).slice(0, 3);
  }
  if (!Array.isArray(result.keyCheckpoints) || result.keyCheckpoints.length < 3) {
    result.keyCheckpoints = (result.keyCheckpoints ?? []).concat(['Check setup.', 'Review impact.', 'Hold finish.']).slice(0, 3);
  }
  if (!result.drill?.name) {
    result.drill = {
      name: 'Mirror Drill',
      whyThisDrill: 'Builds awareness of your swing positions.',
      steps: ['Stand in front of a mirror.', 'Make slow-motion swings.', 'Check your positions at key moments.'],
    };
  }
  if (!result.selectedClub) result.selectedClub = club ?? 'Unknown';

  return result;
}

function buildFallback(club?: string, message?: string): SwingResult {
  return {
    selectedClub: club ?? 'Unknown',
    detectedClubType: 'Unclear',
    clubMatch: 'unclear',
    clubMatchReason: 'Could not identify club from frames.',
    cameraAngle: 'unclear',
    scores: {
      overallScore: 45, positionScore: 45, tempoScore: 45,
      sequenceScore: 45, stabilityScore: 45, contactScore: 45, confidence: 1,
    },
    primaryIssue: 'Video quality too low for analysis',
    issueCategory: 'unclear',
    whyItHappens: message
      ? `The AI returned: "${message.slice(0, 120)}"`
      : 'The frames did not provide enough visual information. Try filming in better light from a clearer angle.',
    ballFlightPrediction: 'Unable to predict.',
    contactPrediction: 'Unable to assess.',
    clubSpecificNotes: `Selected club: ${club ?? 'Unknown'}. Ensure it is visible throughout the swing.`,
    evidence: [
      'Video quality or camera angle was insufficient for confident analysis.',
      'Frame clarity limited the ability to assess swing mechanics.',
      'Re-film with better lighting and a stable camera position.',
    ],
    scoreReasoning: {
      position: 'Unable to assess — insufficient frame quality.',
      tempo: 'Unable to assess.',
      sequence: 'Unable to assess.',
      stability: 'Unable to assess.',
      contact: 'Unable to assess.',
    },
    fixes: [
      'Film in good natural light — avoid strong backlight',
      'Stand 8–12 feet from the camera so your full body is in frame',
      'Use a stable surface and shoot from down-the-line or face-on',
    ],
    drill: {
      name: 'Setup Check Drill',
      whyThisDrill: 'Ensures correct camera angle and positioning for accurate AI analysis.',
      steps: [
        'Place your phone at hip height, 8–12 feet away',
        'Film from directly behind (down-the-line) or directly facing you (face-on)',
        'Ensure your full body and club are visible throughout the swing',
      ],
    },
    keyCheckpoints: [
      'Camera at hip height, 8–12 feet away',
      'Full body visible from head to feet',
      'Good lighting — no backlighting or deep shadows',
    ],
    summary: 'Analysis could not be completed due to video quality. Follow the filming tips and try again.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
// Phrases that indicate the AI refused instead of returning JSON
const REFUSAL_PATTERNS = [
  "i'm sorry",
  "i cannot",
  "i can't",
  "i am unable",
  "cannot analyze",
  "unable to analyze",
  "no golf swing",
  "not able to",
];

function isRefusal(content: string): boolean {
  const lower = content.toLowerCase().trim();
  return !lower.startsWith('{') && REFUSAL_PATTERNS.some((p) => lower.includes(p));
}

const FORCE_JSON_PROMPT = `These images show a golfer. Analyze the visible body position, club, and motion.
You MUST return the JSON schema — no refusals, no plain text.
If image quality limits your view, estimate from what is visible and set confidence to 3-4.
Start your response with { and end with }.`;

export async function analyzeSwingFrames(
  base64Frames: string[],
  club?: string,
  previousResult?: SwingResult,
  temporalMetrics?: TemporalMetrics,
  landmarks?: PerFrameLandmarks,
): Promise<SwingResult> {
  let content = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT, temporalMetrics, landmarks);

  if (!content) {
    console.warn('[openrouter] empty response — using fallback');
    return buildFallback(club);
  }

  // If the AI refused, retry once with a forced-JSON override prompt
  if (isRefusal(content)) {
    console.warn('[openrouter] AI refused — retrying with forced-JSON prompt. Raw:', content.slice(0, 80));
    content = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT + '\n\n' + FORCE_JSON_PROMPT, temporalMetrics, landmarks)
      .catch(() => '');
  }

  let result = parseResult(content);
  if (!result) {
    console.warn('[openrouter] parse failed. Raw:', content.slice(0, 150));
    return buildFallback(club, content.slice(0, 120));
  }

  result = validateAndFix(result, club, temporalMetrics);

  const needsSecondPass =
    isGenericAnalysis(result) ||
    (previousResult ? isTooSimilarToPrevious(result, previousResult) : false);

  if (needsSecondPass) {
    console.log('[openrouter] triggering second pass');
    const content2 = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT + SECOND_PASS_SUFFIX, temporalMetrics, landmarks);
    const result2  = parseResult(content2);
    if (result2) {
      const fixed2 = validateAndFix(result2, club, temporalMetrics);
      if (!isGenericAnalysis(fixed2)) {
        console.log('[openrouter] second pass succeeded');
        return fixed2;
      }
    }
    console.warn('[openrouter] second pass still generic — using first pass');
  }

  console.log(`[openrouter] final overallScore=${result.scores?.overallScore} tempoScore=${result.scores?.tempoScore} confidence=${result.scores?.confidence}`);
  return result;
}
