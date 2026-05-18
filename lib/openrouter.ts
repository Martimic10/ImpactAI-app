// ─────────────────────────────────────────────────────────────────────────────
// ImpactAI — Coaching LLM Wrapper (v4)
// ─────────────────────────────────────────────────────────────────────────────
//
// HARD RULE: the LLM does NOT produce numeric scores. It can only produce
// qualitative category grades. The app maps those grades to numbers and
// applies deterministic pose-based guardrail caps for clear faults.
//
// The LLM is asked for QUALITATIVE coaching only:
//   - cameraAngle, club identification
//   - evidence sentences (visible observations)
//   - root-cause explanation
//   - ball flight + contact prediction
//   - drill (name + why + steps)
//   - fixes
//   - key checkpoints
//   - summary
//
// The engine's category scores + detected faults are passed INTO the prompt
// so the LLM's narrative agrees with the numbers the user actually sees.

import { SwingResult, TemporalMetrics, PoseLandmark } from '@/types';
import { humanizeSwingResultText } from '@/lib/humanizeSwingText';
import {
  scoreSwing,
  toLegacyScores,
  legacyReasoning,
  CategoryKey,
  SwingScoringResult,
  PerFrameLandmarks,
  CATEGORY_LABELS,
} from '@/lib/swingScoring';

import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const OPENROUTER_API_KEY  = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 90_000;
const LLM_MAX_FRAMES = 4;

// Map the engine's CategoryKey → the legacy issueCategory vocabulary used
// throughout the rest of the app (drills, UI, leaderboards).
const ENGINE_CATEGORY_TO_ISSUE: Record<CategoryKey, SwingResult['issueCategory']> = {
  setup:          'setup',
  balance:        'balance',
  tempo:          'tempo',
  rotation:       'rotation',
  swingPath:      'path',
  impactPosition: 'contact',
  followThrough:  'balance',
};

type VisualGrade = 'excellent' | 'strong' | 'solid' | 'needs-work' | 'major-issues';

const VISUAL_GRADE_SCORE: Record<VisualGrade, number> = {
  excellent: 94,
  strong: 85,
  solid: 76,
  'needs-work': 64,
  'major-issues': 48,
};

// Pick the category with the largest score deficit (rawScore furthest below
// 90). Returns null when nothing is meaningfully weak.
function pickPrimaryCategory(scoring: SwingScoringResult): CategoryKey | null {
  let worstKey: CategoryKey | null = null;
  let worstDeficit = 0;
  (Object.keys(scoring.categories) as CategoryKey[]).forEach((k) => {
    const c = scoring.categories[k];
    if (c.confidence < 0.30) return; // ignore low-confidence categories
    const deficit = 90 - c.rawScore;
    if (deficit > worstDeficit) {
      worstDeficit = deficit;
      worstKey = k;
    }
  });
  // Only meaningful if at least 12 points below 90 (i.e. raw < 78).
  return worstDeficit >= 12 ? worstKey : null;
}

function normalizeVisualGrade(value: unknown): VisualGrade | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (
    normalized === 'excellent' ||
    normalized === 'strong' ||
    normalized === 'solid' ||
    normalized === 'needs-work' ||
    normalized === 'major-issues'
  ) {
    return normalized;
  }
  return null;
}

function bandForScore(score: number): SwingScoringResult['band'] {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'solid';
  if (score >= 60) return 'needs-work';
  if (score >= 50) return 'major-issues';
  return 'poor';
}

function bandLabelForScore(score: number): string {
  switch (bandForScore(score)) {
    case 'excellent': return 'Excellent';
    case 'strong': return 'Strong';
    case 'solid': return 'Solid';
    case 'needs-work': return 'Needs work';
    case 'major-issues': return 'Major issues';
    case 'poor':
    default: return 'Poor / unusable';
  }
}

// Pose guardrail caps. The LLM can describe what it sees, but it cannot erase
// clear measured faults. These caps keep a visibly bad swing from scoring above
// a cleaner one just because the model was generous with category grades.
function categoryFaultCap(scoring: SwingScoringResult, key: CategoryKey): number {
  const penalties = scoring.categories[key].penalties;
  const severe = penalties.filter((p) => p.severity === 'severe').length;
  const moderate = penalties.filter((p) => p.severity === 'moderate').length;
  if (severe >= 3) return 58;
  if (severe >= 2) return 68;
  if (severe >= 1 && moderate >= 2) return 74;
  if (severe >= 1) return 82;
  if (moderate >= 3) return 84;
  return 100;
}

function overallFaultCap(scoring: SwingScoringResult): number {
  const penalties = Object.values(scoring.categories).flatMap((c) => c.penalties);
  const severe = penalties.filter((p) => p.severity === 'severe').length;
  const moderate = penalties.filter((p) => p.severity === 'moderate').length;
  if (severe >= 6) return 55;
  if (severe >= 4) return 65;
  if (severe >= 3) return 74;
  if (severe >= 2 && moderate >= 3) return 78;
  if (severe >= 1 && moderate >= 5) return 82;
  return 100;
}

function visualAdjustmentLimit(scoring: SwingScoringResult, key: CategoryKey, direction: 'up' | 'down'): number {
  const category = scoring.categories[key];
  const penalties = category.penalties;
  const severe = penalties.filter((p) => p.severity === 'severe').length;
  const moderate = penalties.filter((p) => p.severity === 'moderate').length;

  if (direction === 'down') {
    if (category.confidence >= 0.55) return 14;
    if (category.confidence >= 0.30) return 10;
    return 6;
  }

  if (severe > 0) return 0;
  if (moderate >= 2) return 2;
  if (moderate === 1) return category.confidence >= 0.55 ? 5 : 3;
  if (category.confidence >= 0.70) return 8;
  if (category.confidence >= 0.45) return 6;
  return 3;
}

function applyVisualGradeScoring(scoring: SwingScoringResult, llm: LlmTextResult): void {
  const grades = llm.categoryGrades ?? {};
  const validGrades: Partial<Record<CategoryKey, VisualGrade>> = {};
  (Object.keys(scoring.categories) as CategoryKey[]).forEach((k) => {
    const g = normalizeVisualGrade(grades[k]);
    if (g) validGrades[k] = g;
  });
  const gradeCount = Object.keys(validGrades).length;

  console.log(
    `[hybrid] LLM returned ${gradeCount}/7 valid category grades: ` +
      (Object.keys(validGrades) as CategoryKey[])
        .map((k) => `${k}=${validGrades[k]}`)
        .join(', '),
  );

  if (gradeCount < 4) {
    console.warn('[hybrid] LLM returned insufficient grades — keeping deterministic engine scores');
    scoring.debug.log += '\n[hybrid] Insufficient LLM visual grades; engine scores unchanged.';
    return;
  }

  const debug: string[] = ['[hybrid] Applied bounded visual category adjustments:'];
  let weighted = 0;
  let totalWeight = 0;

  (Object.keys(scoring.categories) as CategoryKey[]).forEach((key) => {
    const category = scoring.categories[key];
    const grade = validGrades[key];
    if (!grade) {
      weighted += category.score * category.weight;
      totalWeight += category.weight;
      debug.push(`  ${CATEGORY_LABELS[key].padEnd(16)} no grade → engine=${category.score}`);
      return;
    }

    const engineScore = category.score;
    const visualScore = VISUAL_GRADE_SCORE[grade];
    const cap = categoryFaultCap(scoring, key);
    const direction = visualScore >= engineScore ? 'up' : 'down';
    const limit = visualAdjustmentLimit(scoring, key, direction);
    const boundedVisual = direction === 'up'
      ? Math.min(visualScore, engineScore + limit)
      : Math.max(visualScore, engineScore - limit);
    const finalScore = Math.round(Math.min(boundedVisual, cap));

    category.score = finalScore;
    category.reason = `${CATEGORY_LABELS[key]} engine score ${engineScore}/100; visual grade ${grade.replace('-', ' ')} adjusted it to ${finalScore}/100.`;

    weighted += finalScore * category.weight;
    totalWeight += category.weight;
    debug.push(
      `  ${CATEGORY_LABELS[key].padEnd(16)} engine=${String(engineScore).padStart(3)} ` +
        `grade=${grade.padEnd(13)} visual=${visualScore} limit=${limit} cap=${cap} final=${finalScore}`,
    );
  });

  const visualOverall = totalWeight > 0 ? Math.round(weighted / totalWeight) : scoring.overallScore;
  const overallCap = overallFaultCap(scoring);
  const finalOverall = Math.max(0, Math.min(100, Math.min(visualOverall, overallCap)));

  scoring.overallScore = finalOverall;
  scoring.band = bandForScore(scoring.overallScore);
  scoring.bandLabel = bandLabelForScore(scoring.overallScore);

  console.log(
    `[hybrid] visual overall=${visualOverall}, pose overall-cap=${overallCap}, FINAL=${finalOverall} ` +
      `(${scoring.bandLabel})`,
  );
  scoring.debug.log += `\n${debug.join('\n')}\n[hybrid] Overall visual=${visualOverall}, overall-cap=${overallCap}, final=${finalOverall}`;
}

function gradeScore(grade: VisualGrade | null | undefined): number | null {
  return grade ? VISUAL_GRADE_SCORE[grade] : null;
}

function narrativeText(llm: LlmTextResult): string {
  return [
    llm.primaryIssue,
    llm.whyItHappens,
    llm.summary,
    llm.contactPrediction,
    llm.ballFlightPrediction,
    ...(llm.evidence ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function applyNarrativeCalibration(scoring: SwingScoringResult, llm: LlmTextResult): void {
  const text = narrativeText(llm);
  const penalties = Object.values(scoring.categories).flatMap((c) => c.penalties);
  const severeCount = penalties.filter((p) => p.severity === 'severe').length;
  const moderateCount = penalties.filter((p) => p.severity === 'moderate').length;

  const majorTerms = [
    'too narrow', 'severe', 'major', 'fundamental breakdown', 'off balance',
    'unstable', 'affecting stability', 'affects stability', 'loss of balance',
    'early extension', 'over the top', 'no shoulder turn', 'poor contact',
    'thin', 'topped', 'slice', 'weak contact', 'chicken wing',
  ];
  const hasMajorNarrativeFault = majorTerms.some((term) => text.includes(term));

  function clampCategory(key: CategoryKey, maxScore: number, reason: string) {
    const category = scoring.categories[key];
    if (category.score <= maxScore) return;
    category.score = maxScore;
    category.reason = `${category.reason} Score capped: ${reason}.`;
  }

  let cap = 100;
  const capReasons: string[] = [];
  if (hasMajorNarrativeFault) {
    cap = Math.min(cap, 58);
    capReasons.push('narrative describes a major swing fault');
  }
  if (text.includes('too narrow') && scoring.club.group === 'driver') {
    cap = Math.min(cap, 55);
    capReasons.push('driver stance is described as too narrow');
    clampCategory('setup', 52, 'driver stance is too narrow');
    clampCategory('balance', 62, 'narrow driver stance affects stability');
  }
  if (text.includes('off balance') || text.includes('unstable') || text.includes('loss of balance')) {
    cap = Math.min(cap, 52);
    capReasons.push('narrative describes balance failure');
    clampCategory('balance', 52, 'balance failure described in analysis');
    clampCategory('followThrough', 58, 'finish stability is compromised');
  }
  if (text.includes('severe') || text.includes('fundamental breakdown')) {
    cap = Math.min(cap, 48);
    capReasons.push('narrative describes severe mechanics');
    (Object.keys(scoring.categories) as CategoryKey[]).forEach((key) => {
      clampCategory(key, 62, 'analysis describes a severe mechanical breakdown');
    });
  }
  if (severeCount >= 2 || moderateCount >= 5) {
    cap = Math.min(cap, 58);
    capReasons.push(`measured faults are substantial (severe=${severeCount}, moderate=${moderateCount})`);
  }

  const tempoScore = scoring.categories.tempo.score;
  const severeLanguage = text.includes('severe') || text.includes('fundamental breakdown');
  const balanceFailure = text.includes('off balance') || text.includes('unstable') || text.includes('loss of balance');
  const tempoFloor = tempoScore >= 85 ? 75 : tempoScore >= 75 ? 68 : tempoScore >= 70 ? 64 : null;

  if (cap < 100 && scoring.overallScore > cap) {
    scoring.overallScore = cap;
    scoring.band = bandForScore(scoring.overallScore);
    scoring.bandLabel = bandLabelForScore(scoring.overallScore);
    scoring.debug.log += `\n[calibration] Score capped at ${cap}: ${capReasons.join('; ')}.`;
    console.log(`[calibration] score capped at ${cap}: ${capReasons.join('; ')}`);
  }

  if (
    tempoFloor != null &&
    scoring.overallScore < tempoFloor &&
    !severeLanguage &&
    !balanceFailure &&
    severeCount < 2
  ) {
    scoring.overallScore = tempoFloor;
    scoring.band = bandForScore(scoring.overallScore);
    scoring.bandLabel = bandLabelForScore(scoring.overallScore);
    scoring.debug.log += `\n[calibration] Tempo floor applied: tempo=${tempoScore}/100 → overall floor ${tempoFloor}.`;
    console.log(`[calibration] tempo floor applied: tempo=${tempoScore}/100 overall=${tempoFloor}`);
  }

  if (cap < 100) {
    return;
  }

  const grades = Object.values(llm.categoryGrades ?? {})
    .map((g) => gradeScore(normalizeVisualGrade(g)))
    .filter((n): n is number => typeof n === 'number');
  if (grades.length >= 5) {
    const avgGrade = grades.reduce((sum, n) => sum + n, 0) / grades.length;
    const cleanNarrative = !hasMajorNarrativeFault && severeCount === 0 && moderateCount <= 2;
    if (cleanNarrative && avgGrade >= 88 && scoring.overallScore < 82) {
      scoring.overallScore = 82;
      scoring.band = bandForScore(scoring.overallScore);
      scoring.bandLabel = bandLabelForScore(scoring.overallScore);
      scoring.debug.log += `\n[calibration] Strong clean visual narrative lifted noisy score floor to 82 (avg visual grade=${avgGrade.toFixed(1)}).`;
      console.log(`[calibration] strong clean swing floor applied: 82 (avg visual grade=${avgGrade.toFixed(1)})`);
    } else if (cleanNarrative && avgGrade >= 82 && scoring.overallScore < 75) {
      scoring.overallScore = 75;
      scoring.band = bandForScore(scoring.overallScore);
      scoring.bandLabel = bandLabelForScore(scoring.overallScore);
      scoring.debug.log += `\n[calibration] Clean visual narrative lifted noisy score floor to 75 (avg visual grade=${avgGrade.toFixed(1)}).`;
      console.log(`[calibration] clean swing floor applied: 75 (avg visual grade=${avgGrade.toFixed(1)})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM prompt — text-only output
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an elite PGA instructor (Sean Foley / Butch Harmon level). Write coaching for a normal recreational golfer. Be specific, anatomy-aware, root-cause first.

ROLE: You write QUALITATIVE coaching text AND you visually grade each category using a WORD scale only. The app maps your word grades to numbers deterministically — you are NOT picking the number.

CATEGORY GRADING (required — every category must appear in your JSON "categoryGrades"):
- "excellent"     — tour/elite-amateur level. Use this when the position looks technically near-perfect (e.g. full shoulder turn at the top, hands stacked at impact, balanced full finish, lead arm straight, no head movement). DO NOT withhold "excellent" — if the swing genuinely looks excellent at that phase, grade it excellent.
- "strong"        — clearly above average. Slight refinement possible but the position looks athletic and well-controlled.
- "solid"         — typical good amateur (mid-handicap). Functional, nothing dragging it down.
- "needs-work"    — clear visible flaw that you can describe in plain English (e.g. "lead arm folds at impact", "head rises noticeably").
- "major-issues"  — obvious fundamental breakdown (e.g. severe over-the-top, no shoulder turn, completely off balance at finish).

GRADE WITH YOUR EYES. The 4 still pose readings are noisy — a clean-looking swing can have pose noise. If the swing visually looks smooth, balanced, and on-plan, grade it accordingly even if some pose metric was flagged. A truly clean amateur swing should usually average around "strong"; a tour-quality swing should mostly grade "excellent".

FRAMES: The first 4 images are phase-aligned checkpoints in order — setup → top of backswing → impact → follow-through/finish. If more images are provided after those first 4, they are swing-sequence context frames sampled across the whole video. Use the sequence frames to judge motion, balance, club path, finish stability, and whether the phase frames look plausible. Do not treat sequence frames as replacement checkpoints.

LANGUAGE: never write "P1", "P4", "P6", "P7", or "P9". Use normal phrases like "at setup", "at the top of the backswing", "approaching impact", "at impact", "in the follow-through", "at the finish".

CAMERA ANGLE — call it first.
- Down-the-line (behind golfer): shaft plane, club path, trail elbow, right-side bend, head dive.
- Face-on (facing chest): weight shift, hip slide vs. rotation, head sway, shaft lean.
- If unclear, say so.

EVIDENCE — 4 specific sentences. Each names a body part, joint, or angle at a specific swing moment, using normal language.
GOOD: "At the top of the backswing the lead arm has folded to roughly 80° — across the line, an arm-pickup pattern."
GOOD: "Through impact the right hip has thrust toward the ball — head has risen visibly compared with setup."
BAD: "Work on your posture." "Needs practice."
At least one evidence string should describe something the swing does WELL — not just faults.

DRILLS — established, root-cause-matched, with mechanical reasoning:
- Over the top → Pump Drill, Headcover Under Trail Arm, Anti-Casting Pump
- Early extension / hip thrust → Wall Drill (glutes on wall), Chair Drill, Pelvic Tilt Hold
- Casting / early release → Punch shots lead-hand-only, Towel Under Both Armpits
- Sway → Headcover Outside Trail Foot, Wall-Behind-Lead-Hip
- Steep / chicken wing → Pump-to-Slot, Tucked-Elbow Throw
- Stuck on trail side → Step-Change (Sam Snead step-through)
- Reverse pivot → Lead-Heel-Up at Top, Cross-Foot Hit
- Across the line → L-to-L Drill, Mirror Top-Check
- Scoop / flip → Punch-Out Drill, Impact Bag
- Restricted rotation → Lead Shoulder Under Chin, Trail Heel Lift

CLUB-SPECIFIC IMPACT TARGETS:
- Driver: attack +3 to +5°, neutral-to-back shaft, ball forward, secondary tilt, trail-side bend.
- 3W/hybrid: slight up, ball inside lead heel, sweeping bottom.
- Long irons (2-5): shaft lean 4-6°, attack -2 to -4°, divot after ball.
- Mid irons (6-8): shaft lean 5-8°, attack -3 to -5°, ball-then-turf.
- Short irons (9-PW): shaft lean 6-10°, attack -4 to -6°, clear divot.
- Wedges: shaft lean 5-12°, attack -3 to -7°, hands lead.
Don't give driver advice for a wedge or vice versa.

VARYING YOUR PICKS: the primary issue is provided to you by the scoring engine (it's the lowest-scoring category). Phrase it precisely, but DO NOT just say "early extension at impact" by default — describe what's actually happening in THIS swing's frames.

OUTPUT — JSON ONLY. Start with { end with }. No prose, no markdown. NO numeric scores. Category grades must be words only.

{
  "detectedClubType": "string",
  "clubMatch": "match | possible_mismatch | unclear",
  "clubMatchReason": "string",
  "cameraAngle": "down-the-line | face-on | unclear",
  "categoryGrades": {
    "setup": "excellent | strong | solid | needs-work | major-issues",
    "balance": "excellent | strong | solid | needs-work | major-issues",
    "tempo": "excellent | strong | solid | needs-work | major-issues",
    "rotation": "excellent | strong | solid | needs-work | major-issues",
    "swingPath": "excellent | strong | solid | needs-work | major-issues",
    "impactPosition": "excellent | strong | solid | needs-work | major-issues",
    "followThrough": "excellent | strong | solid | needs-work | major-issues"
  },
  "primaryIssue": "string — phrase the engine's primaryCategory naturally, citing what you actually see in the frames (e.g. 'Across the line at the top with a flat shoulder turn', 'Hips thrust toward the ball at impact, head rises 3+ inches', 'Lead arm collapses at the top — backswing too short'). Keep it concrete.",
  "whyItHappens": "string — biomechanical root cause in 1-2 sentences",
  "ballFlightPrediction": "string — start direction, curve, height, distance vs. expected for this club",
  "contactPrediction": "string — face location, divot, sound/feel",
  "evidence": ["string", "string", "string", "string"],
  "scoreReasoning": {
    "position":  "string — 1 sentence on setup + impact geometry",
    "tempo":     "string — 1 sentence on rhythm",
    "sequence":  "string — 1 sentence on rotation / kinematic chain",
    "stability": "string — 1 sentence on balance / posture retention",
    "contact":   "string — 1 sentence on impact delivery"
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

// ─────────────────────────────────────────────────────────────────────────────
// Build the context block for the LLM — engine scores + measurements
// ─────────────────────────────────────────────────────────────────────────────
function buildEngineContext(scoring: SwingScoringResult, primaryCat: CategoryKey | null): string {
  // We deliberately do NOT show the pose engine's numeric scores here. Showing
  // them biases the LLM to "agree" with the noisy pose numbers, which is the
  // very thing that has been making good swings grade low. Instead we show only
  // CONCRETE detected faults (severity = severe), and only when several
  // independent metrics agree (i.e. the fault is unambiguous).
  const lines: string[] = [];
  lines.push(`Club selected by user: ${scoring.club.selected} (${scoring.club.group}).`);
  lines.push('');

  // Collect ONLY severe penalties — these are pose readings extreme enough
  // that they almost certainly indicate a real fault, not just noise.
  const severeFaults: { cat: CategoryKey; fault: string; metric: string; value: number }[] = [];
  (Object.keys(scoring.categories) as CategoryKey[]).forEach((k) => {
    for (const p of scoring.categories[k].penalties) {
      if (p.severity === 'severe') {
        severeFaults.push({ cat: k, fault: p.fault, metric: p.metric, value: p.value });
      }
    }
  });

  if (severeFaults.length > 0) {
    lines.push('OBJECTIVELY MEASURED FAULTS (pose tracking flagged these as severe — corroborate visually before grading):');
    for (const f of severeFaults.slice(0, 6)) {
      lines.push(`  • ${CATEGORY_LABELS[f.cat]}: ${f.fault}  (measured ${f.metric}=${f.value})`);
    }
  } else {
    lines.push('NO SEVERE POSE-MEASURED FAULTS — this swing has no objectively-broken positions. Grade based on what you VISUALLY see.');
  }

  if (scoring.phaseValidation.warnings.length > 0) {
    lines.push('');
    lines.push('Phase-detection warnings (the frames may not be perfectly aligned to setup/top/impact/finish — interpret visually):');
    for (const w of scoring.phaseValidation.warnings) lines.push(`  • ${w}`);
  }

  if (primaryCat) {
    lines.push('');
    lines.push(`Pose engine's best guess at the weakest category: ${CATEGORY_LABELS[primaryCat]} — but TRUST YOUR EYES over this guess.`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM API call
// ─────────────────────────────────────────────────────────────────────────────
async function callOpenRouter(
  base64Frames: string[],
  club: string | undefined,
  systemPrompt: string,
  scoring: SwingScoringResult,
  primaryCat: CategoryKey | null,
): Promise<string> {
  const imageContent = base64Frames
    .filter((f) => f.length > 0)
    .slice(0, LLM_MAX_FRAMES)
    .map((frame) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${frame}`, detail: 'low' as const },
    }));

  const engineBlock = buildEngineContext(scoring, primaryCat);

  const userText = `Coach this golf swing. Selected club: ${club ?? 'unknown'}.

Frames: 4 images in swing order (early → mid-backswing → downswing/impact zone → finish).

${engineBlock}

YOUR JOB:
1. Determine cameraAngle (down-the-line | face-on | unclear).
2. Grade EVERY category in "categoryGrades" using ONLY one of: excellent, strong, solid, needs-work, major-issues. Grade based on what you SEE across the 4 checkpoint frames AND the extra sequence frames. If the swing visually looks fluid, balanced, and on-plan for an amateur, default to "strong" or "solid" — do NOT grade something "needs-work" unless you can describe in your evidence what is specifically wrong.
3. Describe what the swing actually does — 4 evidence sentences. At least one positive.
4. Phrase the primaryIssue naturally — describe what's actually happening in THIS swing. If the swing visually looks clean (you graded most categories "strong" or better), say it's generally on-plan and pick a small refinement.
5. Explain why the issue happens (root cause, 1-2 sentences). If there is no real issue, skip the root cause and praise the strength.
6. Predict ball flight + contact for THIS club.
7. Pick a SINGLE established drill that targets the root cause OR reinforces the swing's strength.
8. Give 3 concise fixes and 3 key checkpoints.
9. Write a 2-3 sentence summary.

Return ONLY the JSON object — start with { end with }. NO numeric scores anywhere.`;

  const response = await fetchWithTimeout(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://impactai.app',
      'X-Title': 'ImpactAI Golf Coach',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'text', text: userText }, ...imageContent] },
      ],
      max_tokens: 750,
      temperature: 0.0,
    }),
    timeoutMs: OPENROUTER_TIMEOUT_MS,
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
// Parse + minimal text validation (no score logic — engine owns scores)
// ─────────────────────────────────────────────────────────────────────────────
interface LlmTextResult {
  detectedClubType?: string;
  clubMatch?: SwingResult['clubMatch'];
  clubMatchReason?: string;
  cameraAngle?: SwingResult['cameraAngle'];
  categoryGrades?: Partial<Record<CategoryKey, VisualGrade>>;
  primaryIssue?: string;
  whyItHappens?: string;
  ballFlightPrediction?: string;
  contactPrediction?: string;
  evidence?: string[];
  scoreReasoning?: {
    position?: string;
    tempo?: string;
    sequence?: string;
    stability?: string;
    contact?: string;
  };
  clubSpecificNotes?: string;
  fixes?: string[];
  drill?: { name?: string; whyThisDrill?: string; steps?: string[] };
  keyCheckpoints?: string[];
  summary?: string;
}

function parseLlm(content: string): LlmTextResult | null {
  try {
    const start = content.indexOf('{');
    const end   = content.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(content.slice(start, end + 1)) as LlmTextResult;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallbacks for when the LLM returns garbage or refuses
// ─────────────────────────────────────────────────────────────────────────────
const REFUSAL_PATTERNS = [
  "i'm sorry", "i cannot", "i can't", "i am unable",
  "cannot analyze", "unable to analyze", "no golf swing", "not able to",
];
function isRefusal(content: string): boolean {
  const lower = content.toLowerCase().trim();
  return !lower.startsWith('{') && REFUSAL_PATTERNS.some((p) => lower.includes(p));
}

function fallbackText(scoring: SwingScoringResult, primaryCat: CategoryKey | null): LlmTextResult {
  const primary = primaryCat ? scoring.categories[primaryCat] : null;
  const primaryIssue = primary?.topIssue ?? 'Swing fundamentals — consistency';
  const fix = primary?.suggestedFix ?? 'Focus on rhythm and balance, hold a complete finish for every swing.';
  return {
    detectedClubType: scoring.club.selected,
    clubMatch: 'unclear',
    clubMatchReason: 'AI analysis fell back — using engine measurements only.',
    cameraAngle: 'unclear',
    categoryGrades: {
      setup: scoring.categories.setup.score >= 85 ? 'strong' : scoring.categories.setup.score >= 70 ? 'solid' : 'needs-work',
      balance: scoring.categories.balance.score >= 85 ? 'strong' : scoring.categories.balance.score >= 70 ? 'solid' : 'needs-work',
      tempo: scoring.categories.tempo.score >= 85 ? 'strong' : scoring.categories.tempo.score >= 70 ? 'solid' : 'needs-work',
      rotation: scoring.categories.rotation.score >= 85 ? 'strong' : scoring.categories.rotation.score >= 70 ? 'solid' : 'needs-work',
      swingPath: scoring.categories.swingPath.score >= 85 ? 'strong' : scoring.categories.swingPath.score >= 70 ? 'solid' : 'needs-work',
      impactPosition: scoring.categories.impactPosition.score >= 85 ? 'strong' : scoring.categories.impactPosition.score >= 70 ? 'solid' : 'needs-work',
      followThrough: scoring.categories.followThrough.score >= 85 ? 'strong' : scoring.categories.followThrough.score >= 70 ? 'solid' : 'needs-work',
    },
    primaryIssue,
    whyItHappens: 'Measured from pose data — see category breakdown for the specific deviations.',
    ballFlightPrediction: 'Predicted based on measured impact position — see scores.',
    contactPrediction: 'See impact-position category for measurement-based assessment.',
    evidence: scoring.topFaults.slice(0, 4).length > 0
      ? scoring.topFaults.slice(0, 4)
      : ['Pose tracking confirmed each phase position.',
         'Engine measurements logged — see category breakdown.',
         'Camera and lighting quality affected detail.',
         'Re-film with consistent angle for richer narrative.'],
    scoreReasoning: legacyReasoning(scoring),
    clubSpecificNotes: `Selected club: ${scoring.club.selected}.`,
    fixes: [fix, 'Hold a balanced finish after every swing.', 'Film from a consistent angle to compare swings.'],
    drill: {
      name: 'Mirror Slow-Motion Drill',
      whyThisDrill: 'Builds awareness of body positions at setup, top, impact and finish — the four moments measured by ImpactAI.',
      steps: [
        'Set up in front of a mirror with your normal stance.',
        'Make slow swings, pausing at the top and at impact.',
        'Match the four key positions to a target image of a good swing.',
      ],
    },
    keyCheckpoints: ['Setup posture from the hips.', 'Full shoulder turn to the top.', 'Hold finish balanced on lead leg.'],
    summary: `Scoring engine measured ${scoring.bandLabel.toLowerCase()} swing fundamentals (${scoring.overallScore}/100). Focus area: ${primary ? CATEGORY_LABELS[primaryCat!] : 'general consistency'}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge LLM text + engine scores into the canonical SwingResult shape
// ─────────────────────────────────────────────────────────────────────────────
function buildResult(
  llm: LlmTextResult,
  scoring: SwingScoringResult,
  club: string | undefined,
  primaryCat: CategoryKey | null,
): SwingResult {
  const legacyScores = toLegacyScores(scoring);
  const issueCategory: SwingResult['issueCategory'] = primaryCat
    ? ENGINE_CATEGORY_TO_ISSUE[primaryCat]
    : 'unclear';

  // Default reasoning from engine, then overlay LLM text where present.
  const engineReason = legacyReasoning(scoring);
  const r = llm.scoreReasoning ?? {};
  const scoreReasoning = {
    position:  r.position  || engineReason.position,
    tempo:     r.tempo     || engineReason.tempo,
    sequence:  r.sequence  || engineReason.sequence,
    stability: r.stability || engineReason.stability,
    contact:   r.contact   || engineReason.contact,
  };

  const result: SwingResult = {
    selectedClub: club ?? 'Unknown',
    detectedClubType: llm.detectedClubType ?? club ?? 'Unknown',
    clubMatch: llm.clubMatch ?? 'unclear',
    clubMatchReason: llm.clubMatchReason ?? 'Club detection limited by frame quality.',
    cameraAngle: llm.cameraAngle ?? 'unclear',
    scores: {
      overallScore:   legacyScores.overallScore,
      positionScore:  legacyScores.positionScore,
      tempoScore:     legacyScores.tempoScore,
      sequenceScore:  legacyScores.sequenceScore,
      stabilityScore: legacyScores.stabilityScore,
      contactScore:   legacyScores.contactScore,
      confidence:     legacyScores.confidence,
    },
    scoreReasoning,
    scoringV4: {
      overallScore: scoring.overallScore,
      band: scoring.band,
      bandLabel: scoring.bandLabel,
      confidence: scoring.confidence,
      confidenceScore: scoring.confidenceScore,
      isLeaderboardEligible: scoring.isLeaderboardEligible,
      warnings: scoring.warnings,
      topFaults: scoring.topFaults,
      club: scoring.club,
      categories: scoring.categories,
      phaseValidation: scoring.phaseValidation,
    },
    primaryIssue: llm.primaryIssue ?? (primaryCat
      ? (scoring.categories[primaryCat].topIssue ?? `${CATEGORY_LABELS[primaryCat]} needs work`)
      : 'Overall swing fundamentals'),
    issueCategory,
    whyItHappens: llm.whyItHappens ?? 'See category breakdown for specific deviations from ideal positions.',
    ballFlightPrediction: llm.ballFlightPrediction ?? 'Predicted from impact-position measurements.',
    contactPrediction: llm.contactPrediction ?? 'See impact-position category for delivery measurements.',
    clubSpecificNotes: llm.clubSpecificNotes ?? `Selected club: ${club ?? 'Unknown'}.`,
    evidence: (llm.evidence ?? []).filter((s) => typeof s === 'string' && s.length > 4).slice(0, 6),
    fixes: (llm.fixes ?? []).filter((s) => typeof s === 'string' && s.length > 4).slice(0, 4),
    drill: {
      name: llm.drill?.name ?? 'Mirror Slow-Motion Drill',
      whyThisDrill: llm.drill?.whyThisDrill ?? 'Builds awareness of the four key swing positions.',
      steps: (llm.drill?.steps ?? ['Set up in front of a mirror.', 'Make slow swings.', 'Check each position.'])
        .filter((s) => typeof s === 'string' && s.length > 3)
        .slice(0, 6),
    },
    keyCheckpoints: (llm.keyCheckpoints ?? ['Setup posture.', 'Top of backswing.', 'Impact balance.'])
      .filter((s) => typeof s === 'string' && s.length > 3)
      .slice(0, 6),
    summary: llm.summary ?? `Scoring engine: ${scoring.bandLabel} swing (${scoring.overallScore}/100).`,
  };

  // Ensure minimum array lengths so the UI never renders empty sections.
  if (result.evidence.length < 3) {
    const fallback = fallbackText(scoring, primaryCat);
    while (result.evidence.length < 3 && fallback.evidence!.length > result.evidence.length) {
      result.evidence.push(fallback.evidence![result.evidence.length]);
    }
  }
  if (result.fixes.length < 3) {
    const fallback = fallbackText(scoring, primaryCat);
    while (result.fixes.length < 3 && fallback.fixes!.length > result.fixes.length) {
      result.fixes.push(fallback.fixes![result.fixes.length]);
    }
  }
  if (result.keyCheckpoints.length < 3) {
    result.keyCheckpoints.push('Hold finish for 3 seconds.', 'Check setup posture in a mirror.', 'Film from the same angle each time.');
    result.keyCheckpoints = result.keyCheckpoints.slice(0, 3);
  }

  return humanizeSwingResultText(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeSwingFrames(
  base64Frames: string[],
  club?: string,
  _previousResult?: SwingResult,
  temporalMetrics?: TemporalMetrics,
  landmarks?: PerFrameLandmarks,
): Promise<SwingResult> {
  // ── 1. Deterministic scoring ─────────────────────────────────────────────
  console.log(
    '═════════════════════════════════════════════════════════════════════\n' +
      '[openrouter] ANALYSIS START — ' +
      `frames=${base64Frames.length} ` +
      `landmarks={setup:${!!landmarks?.setup}, top:${!!landmarks?.top}, ` +
      `impact:${!!landmarks?.impact}, finish:${!!landmarks?.finish}} ` +
      `tempoMetrics=${temporalMetrics?.computedTempoScore != null ? 'yes' : 'no'} ` +
      `club=${club ?? 'unknown'}\n` +
      '═════════════════════════════════════════════════════════════════════',
  );

  const scoring = scoreSwing({
    landmarks,
    temporal: temporalMetrics,
    club,
  });

  // Full debug log — engine prints exactly which metric drove each score
  console.log(scoring.debug.log);

  const primaryCat = pickPrimaryCategory(scoring);
  console.log(
    `[openrouter] primary category: ${primaryCat ?? '(none — clean swing)'} ` +
      `→ issueCategory="${primaryCat ? ENGINE_CATEGORY_TO_ISSUE[primaryCat] : 'unclear'}" ` +
      `leaderboard=${scoring.isLeaderboardEligible}`,
  );

  // ── 2. LLM for coaching text only ───────────────────────────────────────
  let content = '';
  try {
    content = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT, scoring, primaryCat);
  } catch (e) {
    console.warn('[openrouter] LLM call failed:', (e as Error).message);
  }

  let llm: LlmTextResult | null = null;
  if (content && !isRefusal(content)) {
    llm = parseLlm(content);
    if (!llm) console.warn('[openrouter] LLM JSON parse failed:', content.slice(0, 120));
  } else if (content) {
    console.warn('[openrouter] LLM refusal:', content.slice(0, 100));
  }

  if (!llm) {
    console.warn('[openrouter] using engine-derived fallback text');
    llm = fallbackText(scoring, primaryCat);
  }

  // ── 3. Hybrid scoring ───────────────────────────────────────────────────
  // The deterministic engine owns the ranking. The LLM's qualitative visual
  // grades can make only small bounded adjustments, and measured faults cap
  // the upside so a bad swing cannot be graded above a cleaner one.
  applyVisualGradeScoring(scoring, llm);
  applyNarrativeCalibration(scoring, llm);
  const finalPrimaryCat = pickPrimaryCategory(scoring);

  // ── 4. Merge hybrid numbers + LLM text ──────────────────────────────────
  const result = buildResult(llm, scoring, club, finalPrimaryCat);

  console.log(
    `[openrouter] FINAL overall=${result.scores?.overallScore} ` +
      `(${scoring.bandLabel}, conf=${scoring.confidence}) ` +
      `issueCategory=${result.issueCategory} ` +
      `leaderboard=${scoring.isLeaderboardEligible} ` +
      `primaryIssue="${result.primaryIssue?.slice(0, 80) ?? ''}"`,
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export PerFrameLandmarks so existing callers (lib/analysis.ts) still
// compile against `Parameters<typeof analyzeSwingFrames>[4]`. They were
// importing the type through the function signature, which is exported via
// the parameter shape below. We also re-export the underlying type for
// callers that want to type the value directly.
// ─────────────────────────────────────────────────────────────────────────────
export type { PerFrameLandmarks };

// Backwards-compat shim — some callers (e.g. PoseLandmark consumers) may
// have imported these from this module before the refactor. Keep them
// alive so we don't break unrelated imports.
export type { PoseLandmark };
