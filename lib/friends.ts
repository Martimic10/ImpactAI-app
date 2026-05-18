import { supabase } from '@/lib/supabase';
import type { FriendCardData } from '@/components/friends/FriendCard';
import type { RequestCardData } from '@/components/friends/RequestCard';
import type { LeaderboardRowData } from '@/components/friends/LeaderboardItem';
import type { FriendRequest, LeaderboardEntry, UserProfile } from '@/types';
import { getSwingScore, type Swing } from '@/types';

function timeAgoFromISO(iso?: string): string {
  if (!iso) return 'Recently';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export function profileToFriendCard(
  p: UserProfile,
  extras?: { lastClub?: string; status?: string; bestScore?: number },
): FriendCardData {
  return {
    id: p.id,
    displayName: p.username,
    username: p.username,
    avatarInitials: p.username.slice(0, 2).toUpperCase(),
    bestScore: extras?.bestScore ?? 0,
    streak: p.streak ?? 0,
    lastClub: extras?.lastClub ?? '—',
    lastActive: timeAgoFromISO(p.last_active),
    status: extras?.status,
  };
}

export function requestToCardData(r: FriendRequest): RequestCardData {
  const username = r.sender?.username ?? 'Unknown';
  return {
    id: r.id,
    senderId: r.sender_id,
    displayName: username,
    username,
    avatarInitials: username.slice(0, 2).toUpperCase(),
  };
}

export function entryToLeaderboardRow(e: LeaderboardEntry): LeaderboardRowData {
  return {
    id: e.user.id,
    username: e.user.username,
    displayName: e.user.username,
    avatarInitials: e.user.username.slice(0, 2).toUpperCase(),
    avatarUrl: e.user.avatar_url,
    score: e.score,
    trend: undefined,
    streak: e.streak,
    totalSwings: e.total_swings,
  };
}

export async function fetchFriendProfiles(userId: string): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('friends')
    .select(
      'friend_id, users!friends_friend_id_fkey(id, username, plan, avatar_url, last_active, streak, total_swings)',
    )
    .eq('user_id', userId);

  if (error) {
    console.warn('[friends] fetch friend profiles failed:', error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const users = (row as unknown as { users?: UserProfile | UserProfile[] }).users;
      return Array.isArray(users) ? users[0] : users;
    })
    .filter((p): p is UserProfile => Boolean(p));
}

export async function fetchFriends(userId: string): Promise<FriendCardData[]> {
  const profiles = await fetchFriendProfiles(userId);

  if (profiles.length === 0) return [];

  const friendIds = profiles.map((p) => p.id);
  const { data: swings } = await supabase
    .from('swings')
    .select('user_id, club, created_at, result_json')
    .in('user_id', friendIds)
    .eq('privacy', 'friends')
    .order('created_at', { ascending: false })
    .limit(50);

  const latestByUser = new Map<string, Swing>();
  for (const s of (swings ?? []) as Swing[]) {
    if (!latestByUser.has(s.user_id)) latestByUser.set(s.user_id, s);
  }

  return profiles.map((p) => {
    const latest = latestByUser.get(p.id);
    const bestScore = latest?.result_json ? getSwingScore(latest.result_json) : 0;
    return profileToFriendCard(p, {
      lastClub: latest?.club ?? '—',
      bestScore: Math.round(bestScore),
      status: latest
        ? `Shared a ${latest.club?.toLowerCase() ?? 'swing'} · ${timeAgoFromISO(latest.created_at)}`
        : undefined,
    });
  });
}

export async function fetchIncomingRequests(userId: string): Promise<RequestCardData[]> {
  const { data, error } = await supabase
    .from('requests')
    .select('id, sender_id, receiver_id, users!requests_sender_id_fkey(id, username, plan)')
    .eq('receiver_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[friends] fetch requests failed:', error.message);
    return [];
  }

  const reqs = (data ?? []).map((row) => {
    const r = row as unknown as FriendRequest & { users?: UserProfile | UserProfile[] };
    const users = r.users;
    const sender = Array.isArray(users) ? users[0] : users;
    return { ...r, sender };
  }) as FriendRequest[];

  return reqs.map(requestToCardData);
}

export async function buildLeaderboard(
  userId: string,
  profiles: UserProfile[],
): Promise<LeaderboardRowData[]> {
  const allIds = Array.from(new Set([userId, ...profiles.map((p) => p.id)]));
  const { data: swings } = await supabase
    .from('swings')
    .select('user_id, result_json, created_at')
    .in('user_id', allIds)
    .order('created_at', { ascending: false })
    .limit(80);

  const bestScoreByUser = new Map<string, number>();
  for (const s of (swings ?? []) as Swing[]) {
    if (!s.result_json || bestScoreByUser.has(s.user_id)) continue;
    bestScoreByUser.set(s.user_id, Math.round(getSwingScore(s.result_json)));
  }

  const { data: selfRow } = await supabase
    .from('users')
    .select('id, username, plan, avatar_url, streak, total_swings, last_active')
    .eq('id', userId)
    .maybeSingle();

  const everyone: UserProfile[] = selfRow
    ? [selfRow as UserProfile, ...profiles.filter((p) => p.id !== userId)]
    : profiles;

  const entries: LeaderboardEntry[] = everyone.map((p) => ({
    user: p,
    score: bestScoreByUser.get(p.id) ?? 0,
    streak: p.streak ?? 0,
    total_swings: p.total_swings ?? 0,
  }));

  entries.sort((a, b) => b.score - a.score);
  return entries.map(entryToLeaderboardRow);
}

export async function searchGolfers(
  query: string,
  currentUserId: string,
  excludeUserIds: Set<string>,
): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, plan')
    .ilike('username', `%${query}%`)
    .neq('id', currentUserId)
    .limit(12);

  if (error) return [];
  return ((data as UserProfile[]) ?? []).filter((u) => !excludeUserIds.has(u.id));
}

export async function getSocialExcludeIds(userId: string): Promise<Set<string>> {
  const exclude = new Set<string>([userId]);

  const [friendsRes, sentRes, receivedRes] = await Promise.all([
    supabase.from('friends').select('friend_id').eq('user_id', userId),
    supabase.from('requests').select('receiver_id').eq('sender_id', userId),
    supabase.from('requests').select('sender_id').eq('receiver_id', userId),
  ]);

  for (const row of friendsRes.data ?? []) {
    exclude.add((row as { friend_id: string }).friend_id);
  }
  for (const row of sentRes.data ?? []) {
    exclude.add((row as { receiver_id: string }).receiver_id);
  }
  for (const row of receivedRes.data ?? []) {
    exclude.add((row as { sender_id: string }).sender_id);
  }

  return exclude;
}

export async function sendFriendRequest(
  senderId: string,
  receiverId: string,
): Promise<{ ok: boolean; message?: string }> {
  if (senderId === receiverId) {
    return { ok: false, message: 'You cannot invite yourself.' };
  }

  const exclude = await getSocialExcludeIds(senderId);
  if (exclude.has(receiverId)) {
    return { ok: false, message: 'You are already connected or have a pending invite.' };
  }

  const { error } = await supabase.from('requests').insert({
    sender_id: senderId,
    receiver_id: receiverId,
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Request already sent.' };
    }
    return { ok: false, message: 'Could not send request.' };
  }
  return { ok: true };
}

export async function acceptFriendRequest(
  requestId: string,
  senderId: string,
  receiverId: string,
): Promise<{ ok: boolean; message?: string }> {
  const { error: friendError } = await supabase.from('friends').insert([
    { user_id: receiverId, friend_id: senderId },
    { user_id: senderId, friend_id: receiverId },
  ]);

  if (friendError && friendError.code !== '23505') {
    return { ok: false, message: 'Could not add friend.' };
  }

  const { error: deleteError } = await supabase.from('requests').delete().eq('id', requestId);
  if (deleteError) {
    return { ok: false, message: 'Friend added, but could not clear the request.' };
  }

  return { ok: true };
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await supabase.from('requests').delete().eq('id', requestId);
}
