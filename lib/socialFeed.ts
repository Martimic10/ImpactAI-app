import { supabase } from '@/lib/supabase';
import { getSwingScore, type Swing, type UserProfile } from '@/types';

export type FeedActivityKind = 'upload' | 'streak' | 'improve' | 'challenge';

export type FeedActivityItem = {
  id: string;
  swingId: string;
  userId: string;
  initials: string;
  name: string;
  text: string;
  time: string;
  kind: FeedActivityKind;
  avatarUrl?: string;
  thumbnailUrl?: string;
  videoUrl: string;
};

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

function buildUploadText(username: string, club: string | undefined, score: number | null): string {
  const clubLabel = club?.trim() || 'swing';
  const scoreBit = score != null ? ` · AI score ${Math.round(score)}` : '';
  return `${username} shared a ${clubLabel}${scoreBit}.`;
}

type SwingRow = Pick<
  Swing,
  'id' | 'user_id' | 'club' | 'created_at' | 'result_json' | 'thumbnail_url' | 'video_url'
> & {
  users?: Pick<UserProfile, 'id' | 'username' | 'avatar_url'> | null;
};

/** Shared swings from you and your friends, newest first. */
export async function fetchFeedActivities(
  userId: string,
  friendIds: string[],
): Promise<FeedActivityItem[]> {
  const userIds = Array.from(new Set([userId, ...friendIds]));
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from('swings')
    .select(
      'id, user_id, club, created_at, result_json, thumbnail_url, video_url, users!swings_user_id_fkey(id, username, avatar_url)',
    )
    .in('user_id', userIds)
    .eq('privacy', 'friends')
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) {
    console.warn('[socialFeed] fetch failed:', error.message);
    return [];
  }

  return ((data ?? []) as unknown as SwingRow[])
    .filter((row) => row.result_json != null)
    .map((row) => {
      const userRow = row.users;
      const profile = Array.isArray(userRow) ? userRow[0] : userRow;
      const username = profile?.username ?? 'Golfer';
      const isYou = row.user_id === userId;
      const displayName = isYou ? 'You' : username;
      const score = getSwingScore(row.result_json);
      return {
        id: `swing-${row.id}`,
        swingId: row.id,
        userId: row.user_id,
        initials: username.slice(0, 2).toUpperCase(),
        name: displayName,
        text: isYou
          ? `You shared a ${row.club?.trim() || 'swing'}${score ? ` · AI score ${Math.round(score)}` : ''}.`
          : buildUploadText(username, row.club, score),
        time: timeAgoFromISO(row.created_at),
        kind: 'upload' as const,
        avatarUrl: profile?.avatar_url ?? undefined,
        thumbnailUrl: row.thumbnail_url ?? undefined,
        videoUrl: row.video_url,
      };
    });
}
