import type { LiveGameRosterPlayer } from '@/lib/liveGameSession';
import { profileToRosterPlayer } from '@/lib/gameRoster';
import type { UserProfile } from '@/types';

export type TeamRoster = {
  id: string;
  name: string;
  color: string;
  players: LiveGameRosterPlayer[];
};

export const TEAM_PALETTE = ['#34E06F', '#4A9EFF', '#A78BFA', '#FF9F43'] as const;

const MOCK_POOL: Omit<LiveGameRosterPlayer, 'id'>[] = [
  { name: 'You', handicap: '8.4', initials: 'YO' },
  { name: 'Mike Chen', handicap: '12.1', initials: 'MC' },
  { name: 'Alex Rivera', handicap: '15.0', initials: 'AR' },
  { name: 'Sarah Miller', handicap: '10.2', initials: 'SM' },
  { name: 'Jordan Blake', handicap: '9.8', initials: 'JB' },
  { name: 'Emily Foster', handicap: '14.5', initials: 'EF' },
  { name: 'Chris Wang', handicap: '11.3', initials: 'CW' },
  { name: 'Taylor Brooks', handicap: '13.7', initials: 'TB' },
  { name: 'Riley Adams', handicap: '7.9', initials: 'RA' },
  { name: 'Casey Morgan', handicap: '16.2', initials: 'CM' },
  { name: 'Drew Patel', handicap: '6.5', initials: 'DP' },
  { name: 'Jamie Lee', handicap: '18.0', initials: 'JL' },
  { name: 'Sam Ortiz', handicap: '5.2', initials: 'SO' },
  { name: 'Morgan Ellis', handicap: '19.4', initials: 'ME' },
  { name: 'Quinn Hayes', handicap: '4.8', initials: 'QH' },
  { name: 'Avery Kim', handicap: '20.1', initials: 'AK' },
];

export function getTeamLayout(gameId: string): { teamCount: number; playersPerTeam: number } {
  if (gameId === 'best_ball') return { teamCount: 4, playersPerTeam: 4 };
  if (gameId === 'scramble') return { teamCount: 2, playersPerTeam: 4 };
  return { teamCount: 4, playersPerTeam: 1 };
}

/** Fewest teams allowed before starting a round. */
export function getMinTeams(gameId: string): number {
  if (gameId === 'wolf') return 4;
  if (gameId === 'scramble') return 2;
  return 2;
}

export function formatTeamFormatValue(gameId: string, teamCount: number, playersPerTeam: number): string {
  if (gameId === 'wolf') return '4 Players · rotating wolf';
  if (playersPerTeam === 1) return `${teamCount} Teams (1 Player Each)`;
  return `${teamCount} Teams (${playersPerTeam} Players Each)`;
}

function playerFromPool(index: number, id: string): LiveGameRosterPlayer {
  const src = MOCK_POOL[index % MOCK_POOL.length];
  return { id, ...src };
}

function rosterPlayerAt(
  poolIndex: number,
  id: string,
  friends: UserProfile[],
): LiveGameRosterPlayer {
  if (friends.length > 0) {
    return profileToRosterPlayer(friends[poolIndex % friends.length], { id, handicap: '—' });
  }
  return playerFromPool(poolIndex, id);
}

export type CreateTeamsContext = {
  user: UserProfile;
  friends?: UserProfile[];
};

export function createDefaultTeams(
  gameId: string,
  userHandicap = '8.4',
  ctx?: CreateTeamsContext,
): TeamRoster[] {
  const { teamCount, playersPerTeam } = getTeamLayout(gameId);
  const teams: TeamRoster[] = [];
  let poolIdx = 0;
  const friends = ctx?.friends ?? [];
  const user = ctx?.user;

  for (let t = 0; t < teamCount; t++) {
    const players: LiveGameRosterPlayer[] = [];
    for (let p = 0; p < playersPerTeam; p++) {
      const id = `t${t}-p${p}`;
      if (t === 0 && p === 0) {
        players.push({
          id: 'p1',
          name: 'You',
          handicap: userHandicap,
          initials: (user?.username ?? 'YO').slice(0, 2).toUpperCase(),
          avatarUrl: user?.avatar_url,
        });
      } else {
        players.push(rosterPlayerAt(poolIdx++, id, friends));
      }
    }
    teams.push({
      id: `team-${t + 1}`,
      name: `Team ${t + 1}`,
      color: TEAM_PALETTE[t % TEAM_PALETTE.length],
      players,
    });
  }
  return teams;
}

export function flattenTeams(teams: TeamRoster[]): LiveGameRosterPlayer[] {
  return teams.flatMap((t) => t.players);
}

export function isTeamCategoryGame(category: string): boolean {
  return category === 'team';
}
