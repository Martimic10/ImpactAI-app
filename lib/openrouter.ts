import { SwingResult, SwingScores, TemporalMetrics } from '@/types';

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
const SYSTEM_PROMPT = `You are an elite PGA Tour-level instructor and biomechanics coach. Your job is to identify the single most damaging fault in this golfer's swing and quantify every mechanical category honestly.

━━━ TEMPO RULE (read first) ━━━
Tempo is a TIMING measurement — it CANNOT be assessed from still frames alone.
• If computedTempoScore is provided in the metrics: use that exact value for tempoScore. Tempo is already measured.
• If computedTempoScore ≥ 75: tempo is NOT the primary issue. Pick a different issueCategory.
• If NO metrics are provided: set tempoScore to 68 and NEVER use "tempo" as issueCategory. Static frames cannot show rhythm.

━━━ SCORING CATEGORIES (1-100 each) ━━━
positionScore  — Setup stance/grip/ball position + top-of-backswing plane + impact alignment + finish
sequenceScore  — Kinematic order: hips rotate first, torso second, arms third, club last. Body-arm coordination.
stabilityScore — Head stability (minimal lateral or vertical drift), spine angle held from address through impact, balanced finish
contactScore   — Shaft lean at impact, low-point location (in front of ball), face delivery, divot direction

━━━ SCORING SCALE ━━━
90–100 : Tour-quality — only if genuinely excellent
80–89  : Solid, above-average amateur
70–79  : Functional but one visible flaw
60–69  : Clear fault affecting consistency
50–59  : Major fault — repeated poor contact
< 50   : Severe breakdown

━━━ PRIMARY ISSUE RULE ━━━
The issueCategory you name MUST have a score at least 20 points below the average of the other four categories.
- If it doesn't, lower the issue score further until that gap exists.
- Do NOT drag all five scores down together. One category is the problem; the other four reflect the actual quality of those specific mechanics.

━━━ SCORE DIFFERENTIATION (critical) ━━━
- Each of the four non-issue categories must be scored INDEPENDENTLY based on visible evidence.
- They must NOT be identical or within 4 points of each other.
- A golfer with great posture but poor sequencing scores stabilityScore=84, sequenceScore=58. Not both at 70.
- Two different swings with the same primary issue MUST receive different non-issue scores.
- Ask yourself: what does THIS swing do well? Score that high. What does it do poorly outside the main issue? Score that low.

━━━ MULTI-ISSUE LOGIC ━━━
- One clear issue: overall ~72-84. Other four categories span from ~68 to ~88.
- Two issues: overall ~60-72. Two categories below 63.
- Three+ issues: overall ~45-62. Score the worst mechanics honestly below 55.

━━━ CLUB-SPECIFIC ━━━
Driver: launch, face control, rotation speed, trail-side balance
Long irons (2-5): spine angle, smooth transition, divot direction
Mid irons (6-8): ball-first contact, shaft lean, hip rotation
Short irons + wedges: shaft lean, descending blow, face control at impact
Do not give driver advice for wedge swings or vice versa.

━━━ EVIDENCE ━━━
3-5 specific, visual observations about THIS swing. Reference actual body parts, positions, or angles you can see. No generic phrases like "work on fundamentals."

━━━ OUTPUT ━━━
Return ONLY valid JSON. No markdown. Start with { end with }.

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
  "primaryIssue": "string — name the single most damaging fault",
  "issueCategory": "setup | posture | path | clubface | tempo | contact | balance | rotation | unclear",
  "whyItHappens": "string — root cause, not just description",
  "ballFlightPrediction": "string",
  "contactPrediction": "string",
  "evidence": ["string", "string", "string"],
  "scoreReasoning": {
    "position": "string — one specific observation that drove positionScore up or down",
    "tempo": "string — one specific observation about rhythm or the metric value",
    "sequence": "string — one specific observation about body-arm order",
    "stability": "string — one specific observation about head/spine movement",
    "contact": "string — one specific observation about impact position"
  },
  "clubSpecificNotes": "string",
  "fixes": ["string", "string", "string"],
  "drill": {
    "name": "string",
    "whyThisDrill": "string",
    "steps": ["string", "string", "string"]
  },
  "keyCheckpoints": ["string", "string", "string"],
  "summary": "string"
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
async function callOpenRouter(
  base64Frames: string[],
  club: string | undefined,
  systemPrompt: string,
  temporalMetrics?: TemporalMetrics,
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

  const tempoInstruction = hasMetrics
    ? `Tempo metrics provided above — use computedTempoScore (${temporalMetrics!.computedTempoScore}) for tempoScore. ${
        (temporalMetrics!.computedTempoScore ?? 0) >= 75
          ? 'Tempo is acceptable — do NOT use "tempo" as issueCategory.'
          : 'Tempo ratio is poor — "tempo" is a valid issueCategory.'
      }`
    : 'NO timing data available — set tempoScore=68 and do NOT use "tempo" as issueCategory. Tempo cannot be assessed from still frames.';

  const userText = `Analyze this golf swing.

Selected club: ${club ?? 'unknown'}
Frames: ${imageContent.length} phase-aligned frames (address → top → impact → follow-through)

${metricsBlock ? `Timing metrics:\n${JSON.stringify(metricsBlock, null, 2)}` : 'No timing metrics available.'}

TEMPO INSTRUCTION: ${tempoInstruction}

Score each category based strictly on what is visible in these frames.
Non-issue categories MUST vary — not all at the same value.
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
      model: 'openai/gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'text', text: userText }, ...imageContent] },
      ],
      max_tokens: 2500,
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
): Promise<SwingResult> {
  let content = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT, temporalMetrics);

  if (!content) {
    console.warn('[openrouter] empty response — using fallback');
    return buildFallback(club);
  }

  // If the AI refused, retry once with a forced-JSON override prompt
  if (isRefusal(content)) {
    console.warn('[openrouter] AI refused — retrying with forced-JSON prompt. Raw:', content.slice(0, 80));
    content = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT + '\n\n' + FORCE_JSON_PROMPT, temporalMetrics)
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
    const content2 = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT + SECOND_PASS_SUFFIX, temporalMetrics);
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
