import '../global.css';
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';
import { DEV_MODE } from '@/lib/devMode';
import { useAppColors } from '@/lib/theme';
import { stackScreenOptions } from '@/lib/navigation';

// Keep the native splash visible until index.tsx decides where to route
SplashScreen.preventAutoHideAsync().catch(() => {});

// Guards against session expiry while the user is inside the app
function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading || DEV_MODE) return;
    const inTabs = segments[0] === '(tabs)';
    if (!session && inTabs) {
      router.replace('/(auth)/login');
    }
  }, [loading, session, segments]);

  return <>{children}</>;
}

function RootNavigator() {
  const colors = useAppColors();

  return (
    <Stack screenOptions={stackScreenOptions(colors)}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthGate>
          <RootNavigator />
          <StatusBar style="auto" />
        </AuthGate>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
