import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/hooks/useAuth';
import { DEV_MODE } from '@/lib/devMode';

export default function Index() {
  const { session, loading } = useAuth();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  useEffect(() => {
    // DEV: clear flag so onboarding always shows during testing
    AsyncStorage.removeItem('hasSeenOnboarding').then(() => {
      setHasSeenOnboarding(false);
      setOnboardingChecked(true);
    });
  }, []);

  // Hide splash only after both checks are done
  useEffect(() => {
    if (!loading && onboardingChecked) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading, onboardingChecked]);

  // Hold on dark screen while checks are in flight
  if (loading || !onboardingChecked) {
    return <View style={{ flex: 1, backgroundColor: '#0D0D0D' }} />;
  }

  // Fresh install — show onboarding first
  if (!hasSeenOnboarding) {
    return <Redirect href="/(auth)/onboarding" />;
  }

  // Dev mode or active session — go straight to app
  if (DEV_MODE || session) {
    return <Redirect href="/(tabs)/analyze" />;
  }

  // No session — go to login
  return <Redirect href="/(auth)/login" />;
}
