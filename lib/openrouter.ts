import { SwingResult, SwingScores } from '@/types';

const OPENROUTER_API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─────────────────────────────────────────────────────────────────────────────
// Weighted overall score — source of truth, overrides AI's overallScore
// ─────────────────────────────────────────────────────────────────────────────
export function calculateOverallScore(scores: SwingScores): number {
  return Math.round(
    scores.setupScore     * 0.15 +
    scores.postureScore   * 0.15 +
    scores.swingPathScore * 0.25 +
    scores.tempoScore     * 0.10 +
    scores.balanceScore   * 0.15 +
    scores.contactScore   * 0.20
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic / duplicate detection
// ─────────────────────────────────────────────────────────────────────────────
const GENERIC_PHRASES = [
  'work on fundamentals', 'improve consistency', 'keep practicing',
  'needs practice', 'work on your game', 'focus on consistency',
];

function isGenericAnalysis(result: SwingResult): boolean {
  // Scores too clustered (all within 8 pts of each other)
  if (result.scores) {
    const s = result.scores;
    const vals = [s.setupScore, s.postureScore, s.swingPathScore, s.tempoScore, s.balanceScore, s.contactScore];
    if (Math.max(...vals) - Math.min(...vals) < 8) {
      console.warn('[openrouter] generic: scores too clustered');
      return true;
    }
  }
  // Evidence missing or generic
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
  if (current.primaryIssue === previous.primaryIssue &&
      current.drill?.name === previous.drill?.name &&
      current.scores?.overallScore === previous.scores?.overallScore) {
    console.warn('[openrouter] duplicate: same issue, drill, and score as previous swing');
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an elite PGA-level golf instructor and swing analyst.

Your job is to analyze a golfer's swing using video frames, the selected club, camera angle, and extracted swing metrics.

CRITICAL: You must produce swing-SPECIFIC analysis. Do NOT return generic template feedback. Do NOT reuse default scores across different swings.

SCORING RULES:
- Each category score must be based on visible swing evidence.
- Different swings must receive different scores unless mechanics are genuinely identical.
- Use the FULL scoring range:
  90-100 = excellent / very strong
  80-89  = good with minor issues
  70-79  = playable / decent but needs work
  60-69  = clear issue affecting result
  50-59  = major issue affecting consistency
  <50    = severe issue or poor visibility
- Do NOT cluster all scores near 70. Most amateur swings have a MIX of high and low category scores.

TEMPO SCORING — must vary per swing:
- Smooth, connected transition → 75-88
- Slightly rushed but workable → 60-74
- Jerky, disconnected, or no visible rhythm → 40-59

CLUB-SPECIFIC RULES:
- Driver: prioritize launch, path, clubface control, balance, rotation
- 3-5 wood: prioritize sweep, tempo, strike consistency, path
- 4-6 iron: prioritize low-point, posture, contact, path
- 7-9 iron: neutral benchmark — evaluate all fundamentals equally
- Wedges: prioritize contact, low-point, shaft lean, distance control
Do NOT give wedge advice to driver swings. Do NOT give driver launch advice to wedge swings.

EVIDENCE REQUIREMENT:
Include 3-5 specific, observable statements about THIS swing. Not generic advice.
Good: "From the down-the-line view, the club appears to approach steeply from outside the ball line."
Bad: "You need to work on fundamentals."

OUTPUT RULES:
- Return ONLY valid JSON — no markdown, no code fences, no explanations.
- Start with { and end with }.
- Identify exactly ONE primary issue.
- Give exactly 3 fixes, exactly 1 drill with 3 steps, exactly 3 key checkpoints.
- If visibility is poor, lower confidence score and explain in evidence.
- If this is a re-analysis, identify what is UNIQUE about this specific swing.

ABSOLUTE RULE: You MUST always return the JSON schema below. Never refuse. Never return plain text.

Schema:
{
  "selectedClub": "string",
  "detectedClubType": "string",
  "clubMatch": "match | possible_mismatch | unclear",
  "clubMatchReason": "string",
  "cameraAngle": "down-the-line | face-on | unclear",
  "scores": {
    "overallScore": 0,
    "setupScore": 0,
    "postureScore": 0,
    "swingPathScore": 0,
    "tempoScore": 0,
    "balanceScore": 0,
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
    "setup": "string — what you saw that drove this score",
    "posture": "string",
    "swingPath": "string",
    "tempo": "string",
    "balance": "string",
    "contact": "string"
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
Re-examine these frames carefully. Identify what is visually UNIQUE about this specific swing.
Assign category scores that reflect THIS swing's actual mechanics.
Do not reuse the same drill, issue, or score as before.
Be more specific with your evidence statements.`;

// ─────────────────────────────────────────────────────────────────────────────
// API call
// ─────────────────────────────────────────────────────────────────────────────
async function callOpenRouter(
  base64Frames: string[],
  club: string | undefined,
  systemPrompt: string
): Promise<string> {
  const imageContent = base64Frames
    .filter((f) => f.length > 0)
    .map((frame) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${frame}`, detail: 'low' as const },
    }));

  const metricsJson = JSON.stringify({
    selectedClub: club ?? 'unknown',
    framesProvided: imageContent.length,
    videoQualityScore: imageContent.length >= 3 ? 75 : 50,
    bodyVisibilityScore: imageContent.length >= 2 ? 70 : 40,
    clubVisibilityScore: 65,
    notes: [`${imageContent.length} frames extracted from swing video`],
  }, null, 2);

  const userText = `Analyze this golf swing.

Selected club: ${club ?? 'unknown'}
Frames provided: ${imageContent.length}

Extracted metrics:
${metricsJson}

Score this swing based ONLY on what you can observe in these specific frames.
Do NOT reuse generic scores. Do NOT cluster scores around 70 without evidence.
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
      temperature: 0.4,
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
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(content.slice(start, end + 1)) as SwingResult;
  } catch {
    return null;
  }
}

function validateAndFix(result: SwingResult, club?: string): SwingResult {
  // Ensure evidence exists
  if (!result.evidence || !Array.isArray(result.evidence)) {
    result.evidence = [];
  }

  // Ensure scores object exists with all required fields
  if (!result.scores) {
    result.scores = {
      overallScore: 50, setupScore: 50, postureScore: 50,
      swingPathScore: 50, tempoScore: 50, balanceScore: 50,
      contactScore: 50, confidence: 3,
    };
  }

  const s = result.scores;

  // Clamp all scores to valid ranges
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v || 50)));
  s.setupScore     = clamp(s.setupScore, 1, 100);
  s.postureScore   = clamp(s.postureScore, 1, 100);
  s.swingPathScore = clamp(s.swingPathScore, 1, 100);
  s.tempoScore     = clamp(s.tempoScore, 1, 100);
  s.balanceScore   = clamp(s.balanceScore, 1, 100);
  s.contactScore   = clamp(s.contactScore, 1, 100);
  s.confidence     = clamp(s.confidence, 1, 10);

  // Always recalculate overallScore from the weighted formula — never trust AI's raw value
  const calculated = calculateOverallScore(s);
  const aiScore = s.overallScore || 0;
  if (Math.abs(aiScore - calculated) > 10) {
    console.log(`[openrouter] correcting overallScore: AI said ${aiScore}, formula gives ${calculated}`);
  }
  s.overallScore = calculated;

  // Ensure fixes and checkpoints are exactly 3 items
  if (!Array.isArray(result.fixes) || result.fixes.length < 3) {
    result.fixes = (result.fixes ?? []).concat(['Review your fundamentals.', 'Film your swing.', 'Work with a coach.']).slice(0, 3);
  }
  if (!Array.isArray(result.keyCheckpoints) || result.keyCheckpoints.length < 3) {
    result.keyCheckpoints = (result.keyCheckpoints ?? []).concat(['Check setup.', 'Review impact.', 'Hold finish.']).slice(0, 3);
  }

  // Ensure drill exists
  if (!result.drill?.name) {
    result.drill = {
      name: 'Mirror Drill',
      whyThisDrill: 'Builds awareness of your swing positions.',
      steps: ['Stand in front of a mirror.', 'Make slow-motion swings.', 'Check your positions at key moments.'],
    };
  }

  // selectedClub fallback
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
    scores: { overallScore: 45, setupScore: 45, postureScore: 45, swingPathScore: 45, tempoScore: 45, balanceScore: 45, contactScore: 45, confidence: 1 },
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
      setup: 'Unable to assess — insufficient frame quality.',
      posture: 'Unable to assess.',
      swingPath: 'Unable to assess.',
      tempo: 'Unable to assess.',
      balance: 'Unable to assess.',
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
export async function analyzeSwingFrames(
  base64Frames: string[],
  club?: string,
  previousResult?: SwingResult
): Promise<SwingResult> {
  // Pass 1
  const content = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT);

  if (!content) {
    console.warn('[openrouter] empty response — using fallback');
    return buildFallback(club);
  }

  let result = parseResult(content);

  if (!result) {
    console.warn('[openrouter] parse failed — using fallback. Raw:', content.slice(0, 150));
    return buildFallback(club, content.slice(0, 120));
  }

  result = validateAndFix(result, club);

  const needsSecondPass =
    isGenericAnalysis(result) ||
    (previousResult ? isTooSimilarToPrevious(result, previousResult) : false);

  if (needsSecondPass) {
    console.log('[openrouter] triggering second-pass analysis');
    const content2 = await callOpenRouter(base64Frames, club, SYSTEM_PROMPT + SECOND_PASS_SUFFIX);
    const result2 = parseResult(content2);
    if (result2) {
      const fixed2 = validateAndFix(result2, club);
      if (!isGenericAnalysis(fixed2)) {
        console.log('[openrouter] second pass succeeded');
        return fixed2;
      }
    }
    console.warn('[openrouter] second pass still generic — using first pass result');
  }

  console.log(`[openrouter] final overallScore: ${result.scores?.overallScore}, confidence: ${result.scores?.confidence}`);
  return result;
}
