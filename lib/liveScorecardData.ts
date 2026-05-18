/** Pebble Beach–style white-tee mock for premium scorecard UI. */
export const SCORECARD_COURSE_NAME = 'Pebble Beach Golf Links';
export const SCORECARD_COURSE_META = '18 Holes • White Tees (6,374 yds)';

export const HOLE_PAR = [4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 3, 4, 4, 5, 4, 4, 3, 5] as const;
export const HOLE_SI = [9, 11, 7, 3, 13, 1, 17, 15, 5, 10, 18, 2, 8, 12, 4, 14, 16, 6] as const;
export const HOLE_YDS = [
  380, 502, 174, 331, 188, 523, 106, 418, 464, 446, 390, 202, 430, 573, 397, 402, 178, 543,
] as const;

export type LiveScorecardPlayer = {
  id: string;
  name: string;
  handicap: string;
  initials: string;
  avatarUrl?: string;
  /** Mock live points (CTP-style). */
  points: number;
  /** vs prior hole snapshot for movement chip */
  delta: number;
};

export function emptyScores(holeCount = 18): (number | null)[] {
  return Array.from({ length: holeCount }, () => null);
}

/** Mock approach distance for completed holes (CTP-style display). */
export function mockApproachDistance(playerId: string, holeIndex: number): string {
  const feet = (((playerId.charCodeAt(0) ?? 65) + holeIndex * 7) % 35) + 4;
  const inches = (holeIndex * 3 + playerId.length) % 12;
  return `${feet}' ${inches}"`;
}
