import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GameSetupCard } from '@/components/friends/GameSetupCard';
import { CourseSearchSheet } from '@/components/gameSetup/CourseSearchSheet';
import { TeeSelectSheet } from '@/components/gameSetup/TeeSelectSheet';
import { HoleSelectSheet } from '@/components/gameSetup/HoleSelectSheet';
import { ScorecardPreview } from '@/components/gameSetup/ScorecardPreview';
import { SETUP_ACCENT } from '@/components/gameSetup/SetupSheet';
import type { GameCourseSetup } from '@/hooks/useGameCourseSetup';
import { useAppColors } from '@/lib/theme';

export function GameCourseSetupSection({
  setup,
  themeMode,
}: {
  setup: GameCourseSetup;
  themeMode: 'light' | 'dark';
}) {
  const colors = useAppColors();

  return (
    <View style={styles.root}>
      {setup.usingFallback ? (
        <View style={[styles.banner, { backgroundColor: 'rgba(52,224,111,0.1)', borderColor: 'rgba(52,224,111,0.28)' }]}>
          <Ionicons name="information-circle-outline" size={16} color={SETUP_ACCENT} />
          <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
            {setup.isDemo
              ? 'Demo course data — add GOLF_COURSE_API_KEY on the server for live courses.'
              : 'Using fallback course data — live API unavailable.'}
          </Text>
        </View>
      ) : null}

      {setup.courseLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={SETUP_ACCENT} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading course scorecard…
          </Text>
        </View>
      ) : null}

      {setup.courseError ? (
        <View style={[styles.errorBox, { borderColor: 'rgba(255,69,58,0.35)' }]}>
          <Ionicons name="warning-outline" size={16} color="#FF6B6B" />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{setup.courseError}</Text>
        </View>
      ) : null}

      <GameSetupCard
        themeMode={themeMode}
        rows={setup.setupRows}
        onRowPress={setup.onSetupRowPress}
      />

      <ScorecardPreview scorecard={setup.activeScorecard} themeMode={themeMode} />

      <CourseSearchSheet setup={setup} />
      <TeeSelectSheet setup={setup} />
      <HoleSelectSheet setup={setup} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', gap: 14 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  loadingText: { fontSize: 13, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  errorText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
});
