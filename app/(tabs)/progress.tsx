import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { reanalyzeSwing } from '@/lib/analysis';
import { SwingHistoryCard } from '@/components/SwingHistoryCard';
import { Button } from '@/components/ui/Button';
import { Swing, getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

const BAR_H = 140;
const CHART_MAX = 8;

function formatDateLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function scoreColor(score: number) {
  if (score >= 70) return '#4CAF50';
  if (score >= 50) return '#FF9F0A';
  return '#FF453A';
}

function LineChart({ swings }: { swings: Swing[] }) {
  const pts = [...swings].reverse().slice(0, CHART_MAX);
  if (pts.length < 2) return null;

  const scores = pts.map((s) => Math.round(getSwingScore(s.result_json)));
  const maxScore = Math.min(100, Math.max(...scores) + 6);

  // Grid reference lines at 25 / 50 / 75
  const gridLines = [25, 50, 75].filter(v => v <= maxScore);

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeaderRow}>
        <Text style={styles.chartTitle}>Score trend</Text>
        <View style={styles.chartBadge}>
          <Text style={styles.chartBadgeText}>{pts.length} swings</Text>
        </View>
      </View>

      {/* Chart plot area */}
      <View style={[styles.barArea, { height: BAR_H }]}>

        {/* Horizontal grid lines */}
        {gridLines.map(v => (
          <View
            key={v}
            style={[styles.gridLine, { bottom: (v / maxScore) * BAR_H }]}
          >
            <Text style={styles.gridLabel}>{v}</Text>
          </View>
        ))}

        {/* Bars */}
        <View style={styles.barsRow}>
          {scores.map((score, i) => {
            const barH = Math.max(8, (score / maxScore) * BAR_H);
            const color = scoreColor(score);
            const prev = i > 0 ? scores[i - 1] : null;
            const up = prev !== null && score > prev;
            const down = prev !== null && score < prev;

            return (
              <View key={i} style={styles.barCol}>
                {/* Score chip above bar */}
                <View style={[styles.scoreChip, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                  <Text style={[styles.scoreChipText, { color }]}>{score}</Text>
                </View>

                {/* Trend arrow */}
                <Text style={[styles.trendArrow, { color: up ? '#4CAF50' : down ? '#FF453A' : 'transparent' }]}>
                  {up ? '↑' : '↓'}
                </Text>

                {/* Bar with rounded top */}
                <View style={styles.barTrack}>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.bar, { height: barH, backgroundColor: color }]}>
                    {/* Shine effect on bar */}
                    <View style={styles.barShine} />
                  </View>
                </View>

                {/* Date */}
                <Text style={styles.barDate}>{formatDateLabel(pts[i].created_at)}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Baseline */}
      <View style={styles.baseline} />
    </View>
  );
}

export default function ProgressScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { swings, loading, refetch } = useSwings(user?.id);
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  const scores = swings.map((s) => Math.round(getSwingScore(s.result_json)));
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const best = scores.length > 0 ? Math.max(...scores) : 0;
  const trend = scores.length >= 2 ? scores[0] - scores[scores.length - 1] : 0;
  const trendPositive = trend >= 0;

  async function handleReAnalyze(swing: Swing) {
    if (!user) return;
    if (reanalyzingId) return;

    Alert.alert(
      'Re-Analyze Swing',
      `Re-run AI analysis on this swing? This will update your result for "${swing.result_json.primaryIssue}".`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Re-Analyze',
          onPress: async () => {
            setReanalyzingId(swing.id);
            try {
              await reanalyzeSwing(swing.id, user.id);
              await refetch();
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Re-analysis failed.';
              Alert.alert('Error', msg);
            } finally {
              setReanalyzingId(null);
            }
          },
        },
      ]
    );
  }

  if (loading && swings.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.loadingCenter}>
          <ActivityIndicator color="#4CAF50" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }}
            tintColor="#4CAF50"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Progress</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {swings.length} swing{swings.length !== 1 ? 's' : ''} analyzed
          </Text>
        </View>

        {swings.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="bar-chart-outline" size={38} color="#4CAF50" />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No swings yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Analyze your first swing to start tracking progress
            </Text>
            <Button title="Analyze a Swing" onPress={() => router.push('/(tabs)/analyze')} size="lg" />
          </View>
        ) : (
          <>
            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>AVG</Text>
                <Text style={[styles.statValue, { color: colors.text }]}>{avgScore}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>BEST</Text>
                <Text style={[styles.statValue, { color: '#4CAF50' }]}>{best}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>TREND</Text>
                <View style={styles.trendRow}>
                  <Ionicons
                    name={trendPositive ? 'trending-up' : 'trending-down'}
                    size={18}
                    color={trendPositive ? '#4CAF50' : '#FF453A'}
                  />
                  <Text style={[styles.trendValue, { color: trendPositive ? '#4CAF50' : '#FF453A' }]}>
                    {trendPositive ? `+${trend}` : trend}
                  </Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>SWINGS</Text>
                <Text style={[styles.statValue, { color: colors.text }]}>{swings.length}</Text>
              </View>
            </View>

            {/* Chart */}
            {swings.length >= 2 && <LineChart swings={swings} />}

            {/* History */}
            <View style={styles.historySection}>
              <Text style={[styles.historyTitle, { color: colors.text }]}>History</Text>
              <View style={styles.historyList}>
                {swings.map((swing) => (
                  <View key={swing.id}>
                    {reanalyzingId === swing.id ? (
                      <View style={styles.reanalyzingCard}>
                        <ActivityIndicator color="#4CAF50" />
                        <Text style={styles.reanalyzingText}>Re-analyzing…</Text>
                      </View>
                    ) : (
                      <SwingHistoryCard
                        swing={swing}
                        onView={() => router.push({ pathname: '/(tabs)/analyze/swing/[id]', params: { id: swing.id } })}
                        onReAnalyze={() => handleReAnalyze(swing)}
                        onCompare={() => router.push({ pathname: '/(tabs)/compare', params: { swingId: swing.id } })}
                      />
                    )}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 3 },

  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 8,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#282828',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 4,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#555555',
    letterSpacing: 0.8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trendValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  chartCard: {
    marginHorizontal: 16,
    backgroundColor: '#161616',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#282828',
    padding: 18,
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chartHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  chartBadge: {
    backgroundColor: '#1E2E1E',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2E7D32',
  },
  chartBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4CAF50',
  },

  // Bar chart
  barArea: {
    position: 'relative',
    marginBottom: 0,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#222222',
    flexDirection: 'row',
    alignItems: 'center',
  },
  gridLabel: {
    fontSize: 9,
    color: '#444444',
    fontWeight: '700',
    position: 'absolute',
    left: 0,
    top: -11,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: '100%',
    paddingHorizontal: 4,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  scoreChip: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 3,
  },
  scoreChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  trendArrow: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  barTrack: {
    width: '40%',
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    overflow: 'hidden',
  },
  barShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: '50%',
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  barDate: {
    fontSize: 9,
    color: '#555555',
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  baseline: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginTop: 0,
    marginBottom: 6,
  },

  historySection: { paddingHorizontal: 16 },
  historyTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  historyList: { gap: 10 },

  reanalyzingCard: {
    backgroundColor: '#161616',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reanalyzingText: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
  },

  emptyState: {
    marginHorizontal: 20,
    marginTop: 60,
    alignItems: 'center',
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1B2E1B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
});
