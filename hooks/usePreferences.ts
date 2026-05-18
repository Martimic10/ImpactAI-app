import { useState, useEffect, useCallback } from 'react';
import {
  GoalFocus,
  Preferences,
  PREFERENCE_DEFAULTS,
  loadPreferences,
  saveGoalFocus,
  saveProfilePrivate,
  saveFriendsOnly,
  saveDisplayName,
  saveBio,
  saveHandicap,
} from '@/lib/preferences';

export type { GoalFocus, Preferences };

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(PREFERENCE_DEFAULTS);

  const reloadPrefs = useCallback(() => loadPreferences().then(setPrefs), []);

  useEffect(() => {
    reloadPrefs();
  }, [reloadPrefs]);

  const setGoalFocus = useCallback(async (value: GoalFocus) => {
    setPrefs((p) => ({ ...p, goalFocus: value }));
    await saveGoalFocus(value);
  }, []);

  const setProfilePrivate = useCallback(async (value: boolean) => {
    setPrefs((p) => ({ ...p, profilePrivate: value }));
    await saveProfilePrivate(value);
  }, []);

  const setFriendsOnly = useCallback(async (value: boolean) => {
    setPrefs((p) => ({ ...p, friendsOnly: value }));
    await saveFriendsOnly(value);
  }, []);

  const setDisplayName = useCallback(async (value: string) => {
    setPrefs((p) => ({ ...p, displayName: value }));
    await saveDisplayName(value);
  }, []);

  const setBio = useCallback(async (value: string) => {
    setPrefs((p) => ({ ...p, bio: value }));
    await saveBio(value);
  }, []);

  const setHandicap = useCallback(async (value: string) => {
    setPrefs((p) => ({ ...p, handicap: value }));
    await saveHandicap(value);
  }, []);

  return {
    prefs,
    reloadPrefs,
    setGoalFocus,
    setProfilePrivate,
    setFriendsOnly,
    setDisplayName,
    setBio,
    setHandicap,
  };
}
