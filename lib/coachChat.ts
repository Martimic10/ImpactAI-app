// ── ImpactAI — conversational Coach (OpenRouter text) ───────────────────────

const OPENROUTER_API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type CoachChatContext = {
  displayName: string;
  swingCount: number;
  avgScore: number | null;
  latestIssue: string | null;
  lastSwingSummary: string | null;
};

export type CoachStructuredReply = {
  reply: string;
  drill: { name: string; cue: string } | null;
  tip: string | null;
};

const SYSTEM = `You are ImpactAI Coach — the user's personal golf coach inside a mobile app.
Voice: warm, smart, encouraging, and golf-native. Never condescending, never generic-AI, never robotic.
Keep the main answer concise (about 2–5 short sentences) unless the user explicitly asks for depth.
When PLAYER CONTEXT is provided, weave in at most one short personalized clause (e.g. recent pattern or score vibe). Do not dump statistics.
Prefer actionable feel cues, practice focus, or simple drill names over jargon.

Respond with ONLY valid JSON (no markdown, no code fences) in this exact shape:
{"reply":"string","drill":null or {"name":"string","cue":"string"},"tip":null or "string"}
drill: null unless you name one specific drill or practice station. cue is one short sentence (how to do it).
tip: null or one memorable line (max 120 characters).`;

function buildContextBlock(c: CoachChatContext): string {
  const parts: string[] = [];
  parts.push(`Name: ${c.displayName}`);
  parts.push(`Swings logged (app): ${c.swingCount}`);
  if (c.avgScore != null) parts.push(`Approx. recent average swing score (0–100): ${c.avgScore}`);
  if (c.latestIssue) parts.push(`Latest swing primary theme: ${c.latestIssue}`);
  if (c.lastSwingSummary) parts.push(`Recent activity: ${c.lastSwingSummary}`);
  return parts.join('\n');
}

export function parseCoachReply(raw: string): CoachStructuredReply {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { reply: raw.trim() || 'Let’s keep working on your game — what would you like to tackle next?', drill: null, tip: null };
  }
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const reply = typeof o.reply === 'string' ? o.reply : raw.trim();
    let drill: CoachStructuredReply['drill'] = null;
    if (o.drill && typeof o.drill === 'object' && o.drill !== null) {
      const d = o.drill as Record<string, unknown>;
      if (typeof d.name === 'string') {
        drill = { name: d.name, cue: typeof d.cue === 'string' ? d.cue : '' };
      }
    }
    const tip = typeof o.tip === 'string' && o.tip.length > 0 ? o.tip : null;
    return { reply, drill, tip };
  } catch {
    return { reply: raw.trim(), drill: null, tip: null };
  }
}

function mockCoachReply(userText: string, c: CoachChatContext): CoachStructuredReply {
  const t = userText.toLowerCase();
  const name = c.displayName;

  if (t.includes('slice') || (t.includes('fade') && t.includes('ball'))) {
    return {
      reply: `${name}, a slice usually traces back to an open face relative to path through impact — often paired with an out-to-in path or a stall in body rotation. Start with a softer grip pressure and feel “logo to sky” on the way back, then let the lead hip open a touch earlier so the club can square without flipping.`,
      drill: { name: 'Towel under trail arm', cue: 'Make slow 50% swings keeping the towel tucked — trains connection so the face can release on time.' },
      tip: 'One quality rehearsal beats twenty rushed full swings.',
    };
  }
  if (t.includes('practice') || t.includes('today')) {
    return {
      reply: `Today, ${name}, keep the session stupidly simple: pick one ball flight (start line + curve) and one club. Ten deliberate reps, full routine each swing, then five with your eyes closed for tempo. If you have a recent miss pattern from your uploads, mirror that shape in rehearsal.`,
      drill: { name: '9-ball ladder', cue: 'Pick three distances × three balls each — score only process, not outcomes.' },
      tip: 'End on a crisp win: three great contact sounds in a row.',
    };
  }
  if (t.includes('consisten')) {
    return {
      reply: `Consistency loves repeatable setup and tempo more than swing “positions.” ${c.swingCount > 0 ? 'From what you’ve been logging, treat each swing like a mini-routine: waggle, breath, same walk-in trigger.' : 'Once you start logging swings, we’ll anchor feedback to your real patterns — for now, groove one trigger and one tempo count.'}`,
      drill: { name: 'Metronome 3:1', cue: 'Backswing for three beats, transition and through for one — stay smooth, not fast.' },
      tip: 'Same pre-shot, same breath — boring is beautiful.',
    };
  }
  if (t.includes('driver') || t.includes('tee')) {
    return {
      reply: 'Off the tee, prioritize centered contact and a launch window you can predict. Tee height so half the ball sits above the crown, ball just inside lead heel, and feel “wide takeaway, patient transition.” If you fight a leak, aim your body lines slightly more neutral and let path be a result, not a forced steer.',
      drill: { name: 'Tee gate', cue: 'Two tees bracketing the ball — brush the inner edges without hitting the gates.' },
      tip: 'Smooth is long; loud is short.',
    };
  }
  if (t.includes('chunk') || t.includes('fat ') || t.includes('heavy')) {
    return {
      reply: 'Chunked irons usually mean the low point is behind the ball — early release, excess forward sway, or ball too far back can all do it. Feel “chest over the ball at impact” with hands leading slightly, and favor a divot that starts target-side of the ball.',
      drill: { name: 'Line drill', cue: 'Draw a line in turf; strike it with the divot starting just past the line toward the target.' },
      tip: 'Weight finishes on the lead side — trail heel can come up, trail knee should not hang back.',
    };
  }

  return {
    reply:
      c.swingCount > 0 && c.latestIssue
        ? `${name}, I’ve got you. With your recent work, a useful thread is “${c.latestIssue}” — tell me whether you want feels, drills, or how that shows up on the course, and we’ll go one layer deeper.`
        : `${name}, I’m right here. Ask me anything — ball flight, practice structure, mental game, or how to warm up before a round. The more specific you are, the sharper we can get.`,
    drill: null,
    tip: c.avgScore != null && c.avgScore >= 75 ? 'Keep stacking clean reps — you’re building real signal.' : 'Small wins compound — one focus per range session.',
  };
}

export async function sendCoachChatMessage(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  context: CoachChatContext;
}): Promise<CoachStructuredReply> {
  const { messages, context } = params;
  const ctx = buildContextBlock(context);

  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'your_openrouter_api_key') {
    const last = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
    return mockCoachReply(last, context);
  }

  try {
    const response = await fetch(OPENROUTER_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://impactai.app',
        'X-Title': 'ImpactAI Coach Chat',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'system', content: `PLAYER CONTEXT:\n${ctx}` },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.4,
        max_tokens: 550,
      }),
    });

    if (!response.ok) {
      const last = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
      return mockCoachReply(last, context);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return parseCoachReply(raw);
  } catch {
    const last = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
    return mockCoachReply(last, context);
  }
}
