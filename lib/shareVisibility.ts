export type ShareMode = 'private' | 'friends' | 'feed';

export type VisibilityPreview = {
  title: string;
  summary: string;
  bullets: string[];
  socialHint?: string;
};

export const VISIBILITY_PREVIEW: Record<ShareMode, VisibilityPreview> = {
  private: {
    title: 'Only you',
    summary: 'This swing stays in your library. Nothing is posted to Social.',
    bullets: ['Visible on Upload & Analyze', 'Hidden from friends', 'Not on the feed'],
  },
  friends: {
    title: 'Friends only',
    summary: 'Connected friends can view this swing and see it in their feed.',
    bullets: ['Friends can open the swing', 'Shows on Social → Feed', 'Not visible to non-friends'],
    socialHint: 'After you save, check Social → Feed for your post.',
  },
  feed: {
    title: 'Share to feed',
    summary: 'Posted to the Social feed for you and your friends.',
    bullets: ['Appears on Social → Feed', 'Friends can view and react', 'Stays off your private library-only list'],
    socialHint: 'After you save, open Social → Feed to see your upload.',
  },
};

let pendingShareMode: ShareMode = 'private';

export function setPendingShareMode(mode: ShareMode) {
  pendingShareMode = mode;
}

export function getPendingShareMode(): ShareMode {
  return pendingShareMode;
}

/** Maps UI share mode to swings.privacy (feed uses friends visibility in DB). */
export function shareModeToPrivacy(mode: ShareMode): 'private' | 'friends' {
  return mode === 'private' ? 'private' : 'friends';
}

export function isSharedToFeed(mode: ShareMode): boolean {
  return mode === 'friends' || mode === 'feed';
}

export function getVisibilityAudience(mode: ShareMode, friendNames: string[] = []): string[] {
  if (mode === 'private') return ['You'];
  const names = friendNames.length > 0 ? friendNames.slice(0, 4) : ['Your friends'];
  if (mode === 'friends') return ['You', ...names];
  return ['You', ...names, 'Social feed'];
}
