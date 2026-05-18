import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShareMode } from '@/lib/shareVisibility';
import { shareModeToPrivacy } from '@/lib/shareVisibility';

export type GoalFocus = 'Consistency' | 'Distance' | 'Accuracy';

export interface Preferences {
  goalFocus: GoalFocus;
  profilePrivate: boolean;
  friendsOnly: boolean;
  /** Shown on home greeting; empty uses account-derived name. */
  displayName: string;
  /** Profile bio; empty uses a default line from goal focus. */
  bio: string;
  /** USGA-style index, e.g. "12.4" or "+2.1". Empty = not set. */
  handicap: string;
}

export const PREFERENCE_DEFAULTS: Preferences = {
  goalFocus: 'Consistency',
  profilePrivate: false,
  friendsOnly: true,
  displayName: '',
  bio: '',
  handicap: '',
};

const K = {
  goalFocus: '@prefs/goal_focus',
  profilePrivate: '@prefs/profile_private',
  friendsOnly: '@prefs/friends_only',
  shareMode: '@prefs/share_mode',
  displayName: '@prefs/display_name',
  bio: '@prefs/bio',
  handicap: '@prefs/handicap',
};

/** Display on profile; "—" when unset. */
export function formatHandicapDisplay(handicap: string): string {
  const t = handicap.trim();
  return t.length > 0 ? t : '—';
}

/** Validates optional handicap entry (empty clears). */
export function isValidHandicapInput(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (!/^\+?\d{1,2}(\.\d)?$/.test(t)) return false;
  const n = parseFloat(t.replace('+', ''));
  return !Number.isNaN(n) && n <= 54;
}

export async function loadPreferences(): Promise<Preferences> {
  const [goal, priv, friends, displayName, bio, handicap] = await Promise.all([
    AsyncStorage.getItem(K.goalFocus),
    AsyncStorage.getItem(K.profilePrivate),
    AsyncStorage.getItem(K.friendsOnly),
    AsyncStorage.getItem(K.displayName),
    AsyncStorage.getItem(K.bio),
    AsyncStorage.getItem(K.handicap),
  ]);
  return {
    goalFocus: (goal as GoalFocus) ?? PREFERENCE_DEFAULTS.goalFocus,
    profilePrivate: priv !== null ? priv === 'true' : PREFERENCE_DEFAULTS.profilePrivate,
    friendsOnly: friends !== null ? friends === 'true' : PREFERENCE_DEFAULTS.friendsOnly,
    displayName: displayName ?? PREFERENCE_DEFAULTS.displayName,
    bio: bio ?? PREFERENCE_DEFAULTS.bio,
    handicap: handicap ?? PREFERENCE_DEFAULTS.handicap,
  };
}

export async function saveGoalFocus(value: GoalFocus) {
  await AsyncStorage.setItem(K.goalFocus, value);
}

export async function saveProfilePrivate(value: boolean) {
  await AsyncStorage.setItem(K.profilePrivate, String(value));
}

export async function saveFriendsOnly(value: boolean) {
  await AsyncStorage.setItem(K.friendsOnly, String(value));
}

export async function saveShareMode(mode: ShareMode) {
  await AsyncStorage.setItem(K.shareMode, mode);
  await saveFriendsOnly(mode !== 'private');
}

export async function getShareMode(): Promise<ShareMode> {
  const stored = await AsyncStorage.getItem(K.shareMode);
  if (stored === 'private' || stored === 'friends' || stored === 'feed') return stored;
  const friends = await AsyncStorage.getItem(K.friendsOnly);
  return friends === 'true' ? 'friends' : 'private';
}

export async function saveDisplayName(value: string) {
  await AsyncStorage.setItem(K.displayName, value);
}

export async function saveBio(value: string) {
  await AsyncStorage.setItem(K.bio, value);
}

export async function saveHandicap(value: string) {
  await AsyncStorage.setItem(K.handicap, value.trim());
}

// Callable from non-React code (e.g. lib/analysis.ts)
export async function getSwingPrivacy(): Promise<'private' | 'friends'> {
  const mode = await getShareMode();
  return shareModeToPrivacy(mode);
}
