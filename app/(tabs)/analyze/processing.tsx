import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  useDerivedValue,
  runOnJS,
} from 'react-native-reanimated';
import { runSwingAnalysis } from '@/lib/analysis';
import { decodeVideoUriFromRoute } from '@/lib/analysisUri';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

export default function ProcessingScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const params = useLocalSearchParams<{ uri?: string | string[]; club?: string | string[] }>();
  const videoUri = useMemo(() => decodeVideoUriFromRoute(params.uri), [params.uri]);
  const club = useMemo(() => {
    const c = params.club;
    return (Array.isArray(c) ? c[0] : c) ?? undefined;
  }, [params.club]);
  const { user, loading: authLoading } = useAuth();

  const [stepLabel, setStepLabel] = useState('Preparing…');
  const [pctText, setPctText] = useState(0);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const progress = useSharedValue(0);
  const progressFloor = useRef(0);
  const analysisDone = useRef(false);
  const analysisStarted = useRef(false);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  const lastEmitted = useSharedValue(-1);
  useDerivedValue(() => {
    const v = Math.round(progress.value);
    if (v !== lastEmitted.value) {
      lastEmitted.value = v;
      runOnJS(setPctText)(v);
    }
  });

  const setLabel = useCallback((label: string) => {
    setStepLabel(label);
  }, []);

  function finishProgress() {
    const current = progress.value;
    const remaining = Math.max(0, 100 - current);
    const duration = Math.max(280, Math.min(800, remaining * 9));
    progress.value = withTiming(100, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }

  useEffect(() => {
    progress.value = withTiming(4, { duration: 500, easing: Easing.out(Easing.cubic) });
    progressFloor.current = 4;

    const tickId = setInterval(() => {
      if (analysisDone.current) return;
      const cur = progress.value;
      const floor = progressFloor.current;
      const cap = 97;
      const step = cur < 20 ? 0.35 : cur < 60 ? 0.28 : 0.22;
      const target = Math.min(cap, Math.max(floor, cur + step));
      if (target > cur + 0.04) {
        progress.value = withTiming(target, { duration: 130, easing: Easing.linear });
      }
    }, 110);

    return () => clearInterval(tickId);
  }, [progress]);

  const runAnalysis = useCallback(async () => {
    if (!videoUri || !user) {
      const msg = !videoUri
        ? 'No video file was passed to analysis. Go back and try again.'
        : 'You must be signed in to analyze a swing.';
      console.error('[processing] cannot start:', msg);
      setFatalError(msg);
      Alert.alert('Cannot analyze', msg, [{ text: 'Go back', onPress: () => router.back() }]);
      return;
    }

    console.log('[processing] starting analysis', {
      userId: user.id,
      club: club ?? '(none)',
      uri: `${videoUri.slice(0, 48)}…`,
    });

    setFatalError(null);
    setLabel('Preparing…');

    try {
      const { swingId } = await runSwingAnalysis({
        uri: videoUri,
        userId: user.id,
        club,
        onProgress: ({ pct, label }) => {
          setLabel(label);
          progressFloor.current = Math.max(progressFloor.current, Math.min(99, pct));
        },
      });

      console.log('[processing] analysis complete, swingId=', swingId);
      analysisDone.current = true;
      progressFloor.current = 100;
      finishProgress();
      setLabel('Done');
      setTimeout(() => {
        router.replace({
          pathname: '/(tabs)/analyze/swing/[id]',
          params: { id: swingId, from: 'analysis' },
        });
      }, 450);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('[processing] analysis failed:', err);
      setFatalError(msg);
      analysisStarted.current = false;
      Alert.alert('Analysis Error', msg, [
        { text: 'Go back', onPress: () => router.back() },
        {
          text: 'Retry',
          onPress: () => {
            analysisStarted.current = false;
            void runAnalysis();
          },
        },
      ]);
    }
  }, [videoUri, user, club, router, setLabel]);

  // Start only when auth + video URI + user are all ready (uri can arrive after first paint).
  useEffect(() => {
    if (authLoading) {
      setLabel('Checking account…');
      return;
    }
    if (!videoUri) {
      console.warn('[processing] waiting for video URI param');
      setLabel('Waiting for video…');
      return;
    }
    if (!user) {
      console.warn('[processing] no signed-in user');
      setLabel('Sign in required…');
      return;
    }
    if (analysisStarted.current) return;

    analysisStarted.current = true;
    void runAnalysis();
  }, [authLoading, videoUri, user, runAnalysis]);

  // If params never resolve, surface an error instead of spinning forever.
  useEffect(() => {
    if (authLoading || videoUri) return;
    const t = setTimeout(() => {
      if (!videoUri && !analysisStarted.current) {
        const msg = 'The video could not be loaded. Please go back and select your clip again.';
        setFatalError(msg);
        setLabel('Missing video');
        Alert.alert('Missing video', msg, [{ text: 'Go back', onPress: () => router.back() }]);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [authLoading, videoUri, router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⛳</Text>
        </View>

        <Text style={styles.headline}>Analyzing your swing</Text>
        <Text style={[styles.sub, fatalError && { color: '#FF6B6B' }]}>{fatalError ?? stepLabel}</Text>

        <View style={styles.barRow}>
          <View style={styles.barTrack}>
            <Animated.View style={[styles.barFill, barStyle]} />
          </View>
          <Text style={styles.pctText}>{pctText}%</Text>
        </View>

        {club ? (
          <View style={styles.clubPill}>
            <Text style={styles.clubPillText}>{club}</Text>
          </View>
        ) : null}

        {fatalError ? (
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()} activeOpacity={0.88}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  inner: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },

  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1B2E1B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2E7D32',
    marginBottom: 28,
  },
  icon: { fontSize: 36 },

  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 32,
    minHeight: 18,
    paddingHorizontal: 8,
  },

  barRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#2A2A2A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 3,
  },
  pctText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    minWidth: 42,
    textAlign: 'right',
  },

  clubPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1B2E1B',
    borderWidth: 1,
    borderColor: '#2E7D32',
    marginBottom: 16,
  },
  clubPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#2A2A2A',
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
