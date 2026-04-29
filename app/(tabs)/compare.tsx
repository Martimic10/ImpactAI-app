import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { SwingThumbnail } from '@/components/SwingThumbnail';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { Swing, getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

const { width } = Dimensions.get('window');
const HERO_CARD_W = (width - 16 * 2 - 12 - 44) / 2;

const METRICS = ['Posture', 'Tempo', 'Shoulder Turn', 'Balance', 'Impact', 'Club Path'];
const SEEDS = [4, -8, 6, -3, 9, -12];

function deriveMetrics(swing: Swing): Record<string, number> {
  const base = getSwingScore(swing.result_json);
  const result: Record<string, number> = {};
  METRICS.forEach((m, i) => {
    result[m] = Math.min(100, Math.max(10, Math.round(base + SEEDS[i])));
  });
  return result;
}

function shortDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shortIssue(issue: string) {
  const words = issue.split(' ');
  return words.length <= 3 ? issue : words.slice(0, 3).join(' ');
}

function scoreColor(score: number) {
  if (score >= 70) return '#4CAF50';
  if (score >= 50) return '#FF9F0A';
  return '#FF453A';
}

// ── Hero card ──
function HeroCard({
  swing,
  label,
  active,
  onPress,
}: {
  swing: Swing | null;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const score = swing ? Math.round(getSwingScore(swing.result_json)) : null;
  const sc = score !== null ? scoreColor(score) : '#4CAF50';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.heroCard, active ? styles.heroCardActive : styles.heroCardInactive]}
    >
      {/* Thumbnail fills the entire card */}
      <SwingThumbnail swing={swing} fill active={active} />

      {/* Shade overlay so text is always readable */}
      <View style={styles.heroShade} pointerEvents="none" />

      {/* Label badge — top left */}
      <View style={[styles.labelBadge, active && styles.labelBadgeActive]}>
        <Text style={styles.labelBadgeText}>{label}</Text>
      </View>

      {/* Active ring dot — top right */}
      {active && (
        <View style={styles.activeDot}>
          <View style={styles.activeDotInner} />
        </View>
      )}

      {/* Bottom content — always at bottom via absolute positioning */}
      <View style={styles.heroBottom}>
        {swing && score !== null ? (
          <>
            <Text style={[styles.heroScore, { color: '#FFFFFF' }]}>{score}</Text>
            <Text style={[styles.heroIssue, { color: sc }]} numberOfLines={1}>
              {shortIssue(swing.result_json.primaryIssue)}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="add-circle-outline" size={22} color={active ? '#4CAF50' : '#555555'} />
            <Text style={[styles.heroEmpty, active && { color: '#4CAF50' }]}>Tap to select</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Strip card ──
function StripCard({
  swing,
  isA,
  isB,
  onPress,
}: {
  swing: Swing;
  isA: boolean;
  isB: boolean;
  onPress: () => void;
}) {
  const selected = isA || isB;
  const score = Math.round(getSwingScore(swing.result_json));
  const sc = scoreColor(score);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.stripCard, selected && styles.stripCardSelected]}
    >
      <View style={styles.stripThumb}>
        <SwingThumbnail swing={swing} size="sm" active={selected} />
        {selected && (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={9} color="#0D0D0D" />
          </View>
        )}
      </View>
      <Text style={[styles.stripLabel, selected && styles.stripLabelSelected]} numberOfLines={1}>
        {shortDate(swing.created_at)}
      </Text>
      <Text style={[styles.stripScore, { color: sc }]}>{score}</Text>
    </TouchableOpacity>
  );
}

export default function CompareScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { swings } = useSwings(user?.id);

  const { swingId } = useLocalSearchParams<{ swingId?: string }>();
  const [swingA, setSwingA] = useState<Swing | null>(null);
  const [swingB, setSwingB] = useState<Swing | null>(null);
  const [activeSlot, setActiveSlot] = useState<'A' | 'B' | null>(null);

  // Pre-fill slot A when navigating from detail screen
  useEffect(() => {
    if (!swingId || swings.length === 0) return;
    const preload = swings.find((s) => s.id === swingId) ?? null;
    if (preload) {
      setSwingA(preload);
      setActiveSlot('B'); // open slot B for comparison
    }
  }, [swingId, swings.length]);

  function handleHeroPress(slot: 'A' | 'B') {
    setActiveSlot((prev) => (prev === slot ? null : slot));
  }

  function handleSelectSwing(swing: Swing) {
    if (activeSlot === 'A') setSwingA(swing);
    else if (activeSlot === 'B') setSwingB(swing);
    setActiveSlot(null); // close the strip after selection
  }

  function handleSwap() {
    const tmp = swingA;
    setSwingA(swingB);
    setSwingB(tmp);
  }

  const metricsA = swingA ? deriveMetrics(swingA) : null;
  const metricsB = swingB ? deriveMetrics(swingB) : null;
  const selectorOpen = activeSlot !== null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Compare</Text>
          <Text style={styles.subtitle}>Tap a card to select a swing</Text>
        </View>

        {/* Hero cards */}
        <View style={styles.heroRow}>
          <HeroCard
            swing={swingA}
            label="Swing A"
            active={activeSlot === 'A'}
            onPress={() => handleHeroPress('A')}
          />
          <TouchableOpacity onPress={handleSwap} style={styles.swapBtn} activeOpacity={0.8}>
            <Ionicons name="swap-horizontal" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <HeroCard
            swing={swingB}
            label="Swing B"
            active={activeSlot === 'B'}
            onPress={() => handleHeroPress('B')}
          />
        </View>

        {/* Swing selector — only visible when a slot is active */}
        {selectorOpen && (
          <View style={[styles.stripContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.stripHeader}>
              <Text style={[styles.stripTitle, { color: colors.text }]}>
                Select for <Text style={{ color: '#4CAF50' }}>Swing {activeSlot}</Text>
              </Text>
              <TouchableOpacity onPress={() => setActiveSlot(null)}>
                <Ionicons name="close" size={18} color="#666666" />
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stripScroll}
            >
              {swings.map((s) => (
                <StripCard
                  key={s.id}
                  swing={s}
                  isA={swingA?.id === s.id}
                  isB={swingB?.id === s.id}
                  onPress={() => handleSelectSwing(s)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Metrics comparison */}
        {metricsA && metricsB ? (
          <View style={[styles.metricsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.metricsTitle, { color: colors.text }]}>Metrics</Text>
            {METRICS.map((metric, i) => {
              const a = metricsA[metric];
              const b = metricsB[metric];
              const diff = a - b;
              const dc = diff > 0 ? '#4CAF50' : diff < 0 ? '#FF453A' : '#8E8E93';
              const dbg = diff > 0 ? '#1B2E1B' : diff < 0 ? '#2A0A0A' : '#222222';

              return (
                <View
                  key={metric}
                  style={[styles.metricRow, i < METRICS.length - 1 && styles.metricRowBorder]}
                >
                  <Text style={styles.metricName}>{metric}</Text>
                  <View style={styles.metricBars}>
                    <View style={styles.barWrap}>
                      <View style={[styles.barFill, { width: `${a}%`, backgroundColor: scoreColor(a) }]} />
                    </View>
                    <View style={styles.metricNums}>
                      <Text style={[styles.metricNumA, { color: colors.text }]}>{a}</Text>
                      <Text style={styles.metricVs}>vs</Text>
                      <Text style={styles.metricNumB}>{b}</Text>
                    </View>
                    <View style={styles.barWrap}>
                      <View style={[styles.barFill, { width: `${b}%`, backgroundColor: scoreColor(b) }]} />
                    </View>
                  </View>
                  <View style={[styles.diffBadge, { backgroundColor: dbg }]}>
                    <Text style={[styles.diffText, { color: dc }]}>
                      {diff > 0 ? `+${diff}` : diff}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyMetrics}>
            <Ionicons name="git-compare-outline" size={40} color="#2A2A2A" />
            <Text style={styles.emptyMetricsText}>
              {swingA || swingB
                ? 'Tap the other card to pick a second swing'
                : 'Tap either card above to start comparing'}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#666666', marginTop: 3 },

  // Hero cards
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  heroCard: {
    width: HERO_CARD_W,
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
  },
  heroCardActive: {
    borderColor: '#4CAF50',
    shadowColor: '#4CAF50',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  heroCardInactive: {
    borderColor: '#222222',
    backgroundColor: '#111111',
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  labelBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  labelBadgeActive: {
    backgroundColor: 'rgba(76,175,80,0.25)',
  },
  labelBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
  activeDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(76,175,80,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  heroBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    gap: 2,
  },
  heroScore: { fontSize: 36, fontWeight: '800', letterSpacing: -1, lineHeight: 40 },
  heroIssue: { fontSize: 11, fontWeight: '600' },
  heroEmpty: { fontSize: 12, color: '#555555', fontWeight: '500', marginTop: 4 },

  swapBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E2E1E',
    borderWidth: 1,
    borderColor: '#2E7D32',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    zIndex: 1,
  },

  // Selector strip
  stripContainer: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },
  stripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  stripTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  stripScroll: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  stripCard: {
    width: 90,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
    overflow: 'hidden',
    alignItems: 'center',
  },
  stripCardSelected: {
    borderColor: '#4CAF50',
    backgroundColor: '#111E11',
  },
  stripThumb: {
    width: '100%',
    height: 70,
    backgroundColor: '#0E0E0E',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  checkBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666666',
    marginTop: 7,
    paddingHorizontal: 4,
    textAlign: 'center',
  },
  stripLabelSelected: { color: '#FFFFFF' },
  stripScore: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
    marginBottom: 8,
  },

  // Metrics
  metricsCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  metricsTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  metricRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#242424',
  },
  metricName: { width: 86, fontSize: 12, color: '#AAAAAA', fontWeight: '500' },
  metricBars: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  barWrap: { flex: 1, height: 4, backgroundColor: '#242424', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  metricNums: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricNumA: { fontSize: 13, fontWeight: '700', width: 24, textAlign: 'center' },
  metricVs: { fontSize: 10, color: '#444444' },
  metricNumB: { fontSize: 13, fontWeight: '700', color: '#777777', width: 24, textAlign: 'center' },
  diffBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, minWidth: 36, alignItems: 'center' },
  diffText: { fontSize: 12, fontWeight: '700' },

  emptyMetrics: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    gap: 12,
    marginHorizontal: 16,
  },
  emptyMetricsText: { fontSize: 13, color: '#555555', textAlign: 'center', maxWidth: 220 },
});
