import type { ActiveCourseScorecard } from '@/lib/golfCourse/types';
import { getDefaultActiveScorecard } from '@/lib/golfCourse/runtimeScorecard';
import type { LiveScorecardPlayer } from '@/lib/liveScorecardData';
import type { TeamRoster } from '@/lib/teamGameRoster';

/** Roster entry from game setup (Play tab) — transferred into the live scorecard. */
export type LiveGameRosterPlayer = {
  id: string;
  name: string;
  handicap: string;
  initials: string;
  avatarUrl?: string;
};

export type LiveGameTeam = TeamRoster;

export const DEFAULT_LIVE_GAME_ROSTER: LiveGameRosterPlayer[] = [
  { id: 'p1', name: 'You', handicap: '8.4', initials: 'YO' },
  { id: 'p2', name: 'Mike Chen', handicap: '12.1', initials: 'MC' },
  { id: 'p3', name: 'Alex Rivera', handicap: '15.0', initials: 'AR' },
];

type LiveGameSession = {
  gameId: string;
  players: LiveGameRosterPlayer[];
  teams?: LiveGameTeam[];
  courseScorecard: ActiveCourseScorecard;
};

let activeSession: LiveGameSession | null = null;

/** Call when the user taps Start Game — carries the Play-tab roster into the scorecard route. */
export function setLiveGameRoster(
  gameId: string,
  players: LiveGameRosterPlayer[],
  teams?: LiveGameTeam[],
  courseScorecard?: ActiveCourseScorecard,
) {
  activeSession = {
    gameId,
    players: players.length > 0 ? players : [...DEFAULT_LIVE_GAME_ROSTER],
    teams: teams && teams.length > 0 ? teams : undefined,
    courseScorecard: courseScorecard ?? getDefaultActiveScorecard(),
  };
}

export function getLiveGameCourseSetup(gameId: string): ActiveCourseScorecard | null {
  if (!activeSession || activeSession.gameId !== gameId) return null;
  return activeSession.courseScorecard;
}

export function getLiveGameRoster(gameId: string): LiveGameRosterPlayer[] | null {
  if (!activeSession || activeSession.gameId !== gameId) return null;
  return activeSession.players;
}

export function getLiveGameTeams(gameId: string): LiveGameTeam[] | null {
  if (!activeSession || activeSession.gameId !== gameId) return null;
  return activeSession.teams ?? null;
}

export function isLiveTeamGame(gameId: string): boolean {
  const teams = getLiveGameTeams(gameId);
  return teams != null && teams.length > 0;
}

export function rosterToScorecardPlayers(roster: LiveGameRosterPlayer[]): LiveScorecardPlayer[] {
  return roster.map((p) => ({
    ...p,
    points: 0,
    delta: 0,
  }));
}
