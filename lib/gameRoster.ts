import type { LiveGameRosterPlayer } from '@/lib/liveGameSession';
import type { UserProfile } from '@/types';

export function profileToRosterPlayer(
  profile: UserProfile,
  overrides?: Partial<LiveGameRosterPlayer>,
): LiveGameRosterPlayer {
  return {
    id: profile.id,
    name: profile.username,
    handicap: '—',
    initials: profile.username.slice(0, 2).toUpperCase(),
    avatarUrl: profile.avatar_url,
    ...overrides,
  };
}

/** Solo games: you + friends (up to maxPlayers). */
export function buildSoloGameRoster(
  user: UserProfile,
  friends: UserProfile[],
  userHandicap: string,
  maxPlayers = 4,
): LiveGameRosterPlayer[] {
  const you: LiveGameRosterPlayer = {
    id: 'p1',
    name: 'You',
    handicap: userHandicap,
    initials: user.username.slice(0, 2).toUpperCase(),
    avatarUrl: user.avatar_url,
  };
  const slots = Math.max(0, maxPlayers - 1);
  const others = friends.slice(0, slots).map((f, i) =>
    profileToRosterPlayer(f, { id: `p${i + 2}`, handicap: '—' }),
  );
  return [you, ...others];
}
