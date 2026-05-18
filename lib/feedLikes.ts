import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@feed/liked_post_ids';

let likedIds = new Set<string>();
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeFeedLikes(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadFeedLikes(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ids: unknown = JSON.parse(raw);
      if (Array.isArray(ids)) {
        likedIds = new Set(ids.filter((id): id is string => typeof id === 'string'));
      }
    }
  } catch (e) {
    console.warn('[feedLikes] load failed:', e);
  } finally {
    loaded = true;
  }
}

async function persistLikes() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...likedIds]));
  } catch (e) {
    console.warn('[feedLikes] save failed:', e);
  }
}

export function isFeedPostLiked(postId: string): boolean {
  return likedIds.has(postId);
}

export function getDisplayedLikeCount(postId: string, baseCount: number): number {
  return baseCount + (likedIds.has(postId) ? 1 : 0);
}

export async function toggleFeedPostLike(postId: string): Promise<boolean> {
  if (!loaded) await loadFeedLikes();
  const nowLiked = !likedIds.has(postId);
  if (nowLiked) likedIds.add(postId);
  else likedIds.delete(postId);
  notify();
  await persistLikes();
  return nowLiked;
}
