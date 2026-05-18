import { HOLE_PAR } from '@/lib/liveScorecardData';
import type { LiveGameTeam } from '@/lib/liveGameSession';

export const FRONT_NINE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

export function getTeamGameRules(gameId: string): { title: string; body: string } {
  if (gameId === 'scramble') {
    return {
      title: 'TEAM GAME — SCRAMBLE',
      body: 'The team picks the best shot after each stroke and everyone plays from that spot.',
    };
  }
  if (gameId === 'wolf') {
    return {
      title: 'TEAM GAME — WOLF',
      body: 'The wolf picks a partner or goes lone wolf each hole. Highest points wins.',
    };
  }
  return {
    title: 'TEAM GAME — BEST BALL',
    body: 'Each team plays their own ball. The best score from each team on each hole counts.',
  };
}

export function getTeamScoringLabel(gameId: string): string {
  if (gameId === 'scramble') return 'Scramble';
  if (gameId === 'wolf') return 'Wolf';
  return 'Best Ball';
}

export function bestBallForHole(
  team: LiveGameTeam,
  holeIndex: number,
  strokes: Record<string, (number | null)[]>,
): number | null {
  let best: number | null = null;
  for (const p of team.players) {
    const v = strokes[p.id]?.[holeIndex];
    if (v == null) continue;
    if (best == null || v < best) best = v;
  }
  return best;
}

export function sumFrontNine(values: (number | null)[]): number | null {
  let sum = 0;
  let any = false;
  for (let i = 0; i < 9; i++) {
    const v = values[i];
    if (v == null) continue;
    sum += v;
    any = true;
  }
  return any ? sum : null;
}

/** Mock CTP-style points from completed best-ball scores (lower stroke → more pts). */
export function computeTeamPoints(
  team: LiveGameTeam,
  strokes: Record<string, (number | null)[]>,
  throughHole: number,
  parByHole?: number[],
): number {
  let pts = 0;
  for (let i = 0; i < throughHole; i++) {
    const best = bestBallForHole(team, i, strokes);
    if (best == null) continue;
    const par = parByHole?.[i] ?? HOLE_PAR[i] ?? 4;
    pts += Math.max(1, par + 2 - best);
  }
  return pts;
}
