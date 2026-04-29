import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { runSwingAnalysis, AnalysisStage } from '@/lib/analysis';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

const STEPS = [
  { label: 'Uploading video…', stage: 'uploading' },
  { label: 'Extracting frames…', stage: 'extracting' },
  { label: 'Analyzing swing with AI…', stage: 'analyzing' },
  { label: 'Saving results…', stage: 'saving' },
];

const STAGE_PROGRESS: Record<string, number> = {
  uploading: 20,
  extracting: 45,
  analyzing: 75,
  saving: 92,
  done: 100,
};

export default function ProcessingScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { uri, club } = useLocalSearchParams<{ uri: string; club?: string }>();
  const { user, loading: authLoading } = useAuth();

  const [stepLabel, setStepLabel] = useState('Preparing…');
  const progress = useSharedValue(0);
  const hasRun = useRef(false);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  function advanceTo(pct: number, duration = 600) {
    progress.value = withTiming(pct, { duration, easing: Easing.out(Easing.quad) });
  }

  useEffect(() => {
    if (authLoading) return;
    if (hasRun.current) return;
    hasRun.current = true;

    advanceTo(8, 400);
    runAnalysis();
  }, [authLoading]);

  async function runAnalysis() {
    if (!uri || !user) {
      Alert.alert('Error', 'Missing video or user.', [{ text: 'Back', onPress: () => router.back() }]);
      return;
    }

    try {
      const { swingId } = await runSwingAnalysis({
        uri,
        userId: user.id,
        club: club ?? undefined,
        onStage: (stage: AnalysisStage) => {
          const pct = STAGE_PROGRESS[stage] ?? 0;
          const match = STEPS.find((s) => s.stage === stage);
          if (match) setStepLabel(match.label);
          advanceTo(pct, 700);
        },
      });

      advanceTo(100, 400);
      setTimeout(() => {
        router.replace({
          pathname: '/(tabs)/analyze/swing/[id]',
          params: { id: swingId, from: 'analysis' },
        });
      }, 350);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('[Analysis]', msg);
      Alert.alert('Analysis Error', msg, [{ text: 'Try Again', onPress: () => router.back() }]);
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

        <View style={styles.barTrack}>
          <Animated.View style={[styles.barFill, barStyle]} />
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
    gap: 0,
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
  },

  barTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#2A2A2A',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 20,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 3,
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
