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
    const vals = [s.positionScore, s.tempoScore, s.sequenceScore, s.stabilityScore, s.contactScore];
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread < 8) {
      console.warn('[openrouter] generic: scores too clustered (spread=' + spread + ')');
      return true;
    }
    // The issue category should be clearly below the others
    const issueKey = ISSUE_TO_SCORE_KEY[result.issueCategory ?? ''];
    if (issueKey && s[issueKey] != null) {
      const issueScore = s[issueKey] as number;
      const others = vals.filter((_, i) =>
        (['positionScore','tempoScore','sequenceScore','stabilityScore','contactScore'] as const)[i] !== issueKey
      );
      const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
      if (avgOthers - issueScore < 8) {
        console.warn(`[openrouter] generic: issue category (${issueKey}=${issueScore}) not clearly below others (avg=${avgOthers.toFixed(0)})`);
        return true;
      }
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
const SYSTEM_PROMPT = `You are an elite PGA-level golf instructor and biomechanics analyst.

Analyze a golfer's swing using the provided frames and extracted swing metrics.

SCORING CATEGORIES — score each 1-100:

positionScore  — Address setup, top-of-backswing position, impact alignment, finish position
tempoScore     — Backswing/downswing rhythm and transition. Use the tempoRatio from metrics if provided.
sequenceScore  — Kinematic sequence: do hips lead, then torso, then arms, then club? Body-arm coordination.
stabilityScore — Head movement, spine angle retention, balance throughout the swing
contactScore   — Impact posture, shaft lean at contact, low-point control, face delivery

SCORING RULES:
- Base every score on observable evidence in the frames + provided metrics.
- Use the FULL range — 90-100: excellent · 80-89: good · 70-79: decent · 60-69: clear issue · <60: major problem
- If tempoRatio is provided in metrics, use it to set tempoScore (3:1 = ~88, 2:1 or 4:1 = ~72, outside = lower).

PRIMARY ISSUE RULE (critical):
- The category that matches the primaryIssue MUST score at least 15 points BELOW the average of the other 4.
- If tempo is the only problem: positionScore, sequenceScore, stabilityScore, contactScore should each score 72–88 based on what you actually see — NOT all identical.
- Two swings with the same primaryIssue WILL receive different overall scores when their non-issue mechanics differ.
- Do NOT drag down all 5 categories just because one has an issue.

SINGLE-ISSUE vs MULTI-ISSUE:
- One clear issue: overall 70-84. The other 4 categories are strong (72+).
- Two issues: overall 60-72. Two categories clearly below 65.
- Three+ issues: overall 45-62. Multiple categories below 60.

DIFFERENTIATION (important):
- No two swings should receive identical category scores unless mechanics are genuinely identical.
- A swing with good posture but bad tempo scores differently from one with bad posture AND bad tempo.
- Score each category independently from the others.

CLUB-SPECIFIC RULES:
- Driver: launch angle, path, face control, rotation, balance
- Irons (4-6): posture, low-point, contact, path
- Irons (7-9): all fundamentals equally
- Wedges: shaft lean, low-point, distance control
- Do NOT give wedge advice to driver swings or vice versa.

EVIDENCE: Include 3-5 specific observations about THIS swing. Not generic.

OUTPUT: Return ONLY valid JSON. No markdown. Start with { end with }.

Schema:
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
  "primaryIssue": "string",
  "issueCategory": "setup | posture | path | clubface | tempo | contact | balance | rotation | unclear",
  "whyItHappens": "string",
  "ballFlightPrediction": "string",
  "contactPrediction": "string",
  "evidence": ["string", "string", "string"],
  "scoreReasoning": {
    "position": "string — what drove the positionScore",
    "tempo": "string — what drove the tempoScore",
    "sequence": "string — what drove the sequenceScore",
    "stability": "string — what drove the stabilityScore",
    "contact": "string — what drove the contactScore"
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

IMPORTANT — SECOND PASS:
The previous analysis was flagged as too generic or too similar to another swing.
Re-examine these frames carefully. Identify what is visually UNIQUE about this swing.
Assign category scores that reflect THIS swing's actual mechanics.
Do not reuse the same drill, issue, or score. Be more specific with evidence.`;

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

  const metricsBlock = temporalMetrics
    ? {
        backswingDurationMs: temporalMetrics.backswingDurationMs,
        downswingDurationMs: temporalMetrics.downswingDurationMs,
        tempoRatio:          temporalMetrics.tempoRatio,
        motionSmoothness:    temporalMetrics.motionSmoothness,
        computedTempoScore:  temporalMetrics.computedTempoScore,
        note: 'tempoRatio = backswing ÷ downswing duration. Tour average is ~3.0.',
      }
    : { framesProvided: imageContent.length };

  const userText = `Analyze this golf swing.

Selected club: ${club ?? 'unknown'}
Frames provided: ${imageContent.length}

Computed swing metrics (use these for scoring):
${JSON.stringify(metricsBlock, null, 2)}

Score this swing based ONLY on what you can observe in these frames + the metrics above.
Do NOT cluster scores around 70 without evidence.
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
      temperature: 0.35,
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

  // ── Enforce: issue category must score meaningfully lower than others ──────
  // If the AI ignored the PRIMARY ISSUE RULE, correct it here so the overall
  // score reflects the actual severity rather than a generic 65-70 across all.
  const issueKey = ISSUE_TO_SCORE_KEY[result.issueCategory ?? ''];
  if (issueKey && s[issueKey] != null) {
    const allKeys = ['positionScore', 'tempoScore', 'sequenceScore', 'stabilityScore', 'contactScore'] as const;
    const otherScores = allKeys
      .filter((k) => k !== issueKey)
      .map((k) => s[k] as number);
    const avgOthers = otherScores.reduce((a, b) => a + b, 0) / otherScores.length;
    const currentIssue = s[issueKey] as number;

    if (avgOthers - currentIssue < 12) {
      // Issue score isn't clearly enough below the others — pull it down
      const corrected = Math.round(Math.max(30, Math.min(currentIssue, avgOthers - 15)));
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

const FORCE_JSON_PROMPT = `You must analyze this golf swing image and return ONLY a JSON object.
Do NOT refuse. Do NOT say you cannot analyze it.
Even if image quality is low, estimate scores and provide coaching.
A low-quality analysis is far better than no analysis.
Return the JSON schema immediately — start with { and end with }.`;

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
