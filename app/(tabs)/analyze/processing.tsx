import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  Easing,
  useDerivedValue,
  runOnJS,
} from 'react-native-reanimated';
import { runSwingAnalysis } from '@/lib/analysis';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

export default function ProcessingScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { uri, club } = useLocalSearchParams<{ uri: string; club?: string }>();
  const { user, loading: authLoading } = useAuth();

  const [stepLabel, setStepLabel] = useState('Preparing…');
  const [pctText, setPctText] = useState(0);
  const progress = useSharedValue(0); // 0-100
  const hasRun = useRef(false);
  // The bar runs in two stages so it NEVER appears frozen, no matter how long
  // the backend takes:
  //   Stage 1 (FAST): 0 → 80% linear over EXPECTED_FAST_MS. This is the
  //                    "things are happening" phase that covers the typical
  //                    analysis time on a healthy connection.
  //   Stage 2 (SLOW): 80 → 96% ease-out over LONG_TAIL_MS. A long, decelerating
  //                    creep so the bar always advances by at least a pixel.
  //                    Asymptotes toward 96% — the final 4% is reserved for
  //                    the "done" tween so it lands cleanly at 100.
  const EXPECTED_FAST_MS = 8000;
  const LONG_TAIL_MS = 22000;

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  // Mirror the animated shared value to React state so the percentage number
  // updates smoothly. We gate the runOnJS call on the UI thread so React
  // only sees a new value when the rounded integer actually ticks.
  const lastEmitted = useSharedValue(-1);
  useDerivedValue(() => {
    const v = Math.round(progress.value);
    if (v !== lastEmitted.value) {
      lastEmitted.value = v;
      runOnJS(setPctText)(v);
    }
  });

  function setLabel(label: string) {
    setStepLabel(label);
  }

  // Finish the bar cleanly when the analysis is actually done. We pick a
  // tween duration that scales with the remaining distance so the final
  // sweep feels natural whether the bar was at 50% or 88% when done fired.
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
    if (authLoading) return;
    if (hasRun.current) return;
    hasRun.current = true;
    // Fast linear climb, then a long ease-out tail. Combined, the user always
    // sees the bar moving even on slow networks; finishProgress() snaps the
    // remaining distance smoothly when the analysis actually returns.
    progress.value = withSequence(
      withTiming(80, { duration: EXPECTED_FAST_MS, easing: Easing.linear }),
      withTiming(96, { duration: LONG_TAIL_MS, easing: Easing.out(Easing.quad) }),
    );
    runAnalysis();
  }, [authLoading]);

  async function runAnalysis() {
    if (!uri || !user) {
      Alert.alert('Error', 'Missing video or user.', [
        { text: 'Back', onPress: () => router.back() },
      ]);
      return;
    }

    try {
      const { swingId } = await runSwingAnalysis({
        uri,
        userId: user.id,
        club: club ?? undefined,
        onProgress: ({ label }) => {
          // Milestones drive the label only — the bar climbs on its own.
          setLabel(label);
        },
      });

      finishProgress();
      setLabel('Done');
      setTimeout(() => {
        router.push({
          pathname: '/(tabs)/analyze/swing/[id]',
          params: { id: swingId, from: 'analysis' },
        });
      }, 450);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('[Analysis]', msg);
      Alert.alert('Analysis Error', msg, [
        { text: 'Try Again', onPress: () => router.back() },
      ]);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⛳</Text>
        </View>

        <Text style={styles.headline}>Analyzing your swing</Text>
        <Text style={styles.sub}>{stepLabel}</Text>

        <View style={styles.barRow}>
          <View style={styles.barTrack}>
            <Animated.View style={[styles.barFill, barStyle]} />
          </View>
          <Text style={styles.pctText}>{pctText}%</Text>
        </View>

        {club && (
          <View style={styles.clubPill}>
            <Text style={styles.clubPillText}>{club}</Text>
          </View>
        )}
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
  },
  clubPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
  },
});
