import { useEffect, useState, useCallback } from 'react';
import {
  getDisplayedLikeCount,
  isFeedPostLiked,
  loadFeedLikes,
  subscribeFeedLikes,
  toggleFeedPostLike,
} from '@/lib/feedLikes';

export function useFeedLikes() {
  const [ready, setReady] = useState(false);
  const [, bump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadFeedLikes().then(() => {
      if (!cancelled) setReady(true);
    });
    return subscribeFeedLikes(() => bump((n) => n + 1));
  }, []);

  const isLiked = useCallback((postId: string) => isFeedPostLiked(postId), [ready]);

  const likeCount = useCallback(
    (postId: string, baseCount: number) => getDisplayedLikeCount(postId, baseCount),
    [ready],
  );

  const toggleLike = useCallback((postId: string) => toggleFeedPostLike(postId), []);

  return { ready, isLiked, likeCount, toggleLike };
}
