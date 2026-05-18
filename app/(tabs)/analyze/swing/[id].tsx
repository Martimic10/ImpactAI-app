import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { getSwingById } from '@/lib/swings';
import { Swing, getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { humanizeSwingText } from '@/lib/humanizeSwingText';


// ─────────────────────────────────────────────────────────────────────────────
// Inline video — tap to play/pause, no overlay / fullscreen analysis
// ─────────────────────────────────────────────────────────────────────────────
function VideoPlayerInline({ url, onBack }: { url: string; onBack: () => void }) {
  const [playing, setPlaying] = useState(true);
  const player = useVideoPlayer(url || null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  function toggle() {
    if (!player) return;
    if (playing) {
      player.pause();
    } else {
      player.play();
    }
    setPlaying((p) => !p);
  }

  return (
    <TouchableOpacity style={styles.videoWrap} onPress={toggle} activeOpacity={1}>
      <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />

      <TouchableOpacity onPress={onBack} style={styles.circleBtn} activeOpacity={0.85}>
        <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
      </TouchableOpacity>

      {!playing && (
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playCircle}>
            <Ionicons name="play" size={26} color="#FFFFFF" />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
type FixItem = { title: string; detail: string; severity: 'low' | 'medium' | 'high' };

function formatDateFull(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function clampScore(n: number) { return Math.max(0, Math.min(100, n)); }

function scoreColor(score: number) {
  if (score >= 80) return '#B6FF2F';
  if (score >= 65) return '#FFD23A';
  return '#FF7B6D';
}

function metricFromScore(score: number, offset: number) { return clampScore(score + offset); }

type ScoreRow = { label: string; value: number; reason?: string };

function buildScoreRows(swing: Swing): ScoreRow[] {
  const v4 = swing.result_json.scoringV4?.categories;
  if (v4) {
    return [
      { label: 'Setup',      value: clampScore(v4.setup?.score ?? 50),          reason: humanizeSwingText(v4.setup?.reason) },
      { label: 'Balance',    value: clampScore(v4.balance?.score ?? 50),        reason: humanizeSwingText(v4.balance?.reason) },
      { label: 'Tempo',      value: clampScore(v4.tempo?.score ?? 50),          reason: humanizeSwingText(v4.tempo?.reason) },
      { label: 'Rotation',   value: clampScore(v4.rotation?.score ?? 50),       reason: humanizeSwingText(v4.rotation?.reason) },
      { label: 'Swing Path', value: clampScore(v4.swingPath?.score ?? 50),      reason: humanizeSwingText(v4.swingPath?.reason) },
      { label: 'Impact',     value: clampScore(v4.impactPosition?.score ?? 50), reason: humanizeSwingText(v4.impactPosition?.reason) },
      { label: 'Finish',     value: clampScore(v4.followThrough?.score ?? 50),  reason: humanizeSwingText(v4.followThrough?.reason) },
    ];
  }

  const s = swing.result_json.scores;
  const r = swing.result_json.scoreReasoning;
  if (s) {
    // v3 schema — new category names
    if (s.positionScore != null) {
      return [
        { label: 'Position',  value: clampScore(s.positionScore),  reason: humanizeSwingText(r?.position) },
        { label: 'Tempo',     value: clampScore(s.tempoScore),     reason: humanizeSwingText(r?.tempo) },
        { label: 'Sequence',  value: clampScore(s.sequenceScore),  reason: humanizeSwingText(r?.sequence) },
        { label: 'Stability', value: clampScore(s.stabilityScore), reason: humanizeSwingText(r?.stability) },
        { label: 'Contact',   value: clampScore(s.contactScore),   reason: humanizeSwingText(r?.contact) },
      ];
    }
    // Legacy v2 schema — old field names
    return [
      { label: 'Setup',      value: clampScore(s.setupScore ?? 50),     reason: humanizeSwingText(r?.setup) },
      { label: 'Posture',    value: clampScore(s.postureScore ?? 50),   reason: humanizeSwingText(r?.posture) },
      { label: 'Swing Path', value: clampScore(s.swingPathScore ?? 50), reason: humanizeSwingText(r?.swingPath) },
      { label: 'Tempo',      value: clampScore(s.tempoScore),           reason: humanizeSwingText(r?.tempo) },
      { label: 'Balance',    value: clampScore(s.balanceScore ?? 50),   reason: humanizeSwingText(r?.balance) },
      { label: 'Contact',    value: clampScore(s.contactScore),         reason: humanizeSwingText(r?.contact) },
    ];
  }
  const base = clampScore(getSwingScore(swing.result_json));
  return [
    { label: 'Position',  value: metricFromScore(base, 4) },
    { label: 'Tempo',     value: metricFromScore(base, -2) },
    { label: 'Sequence',  value: metricFromScore(base, -10) },
    { label: 'Stability', value: metricFromScore(base, -5) },
    { label: 'Contact',   value: metricFromScore(base, 1) },
    { label: 'Club Path',  value: metricFromScore(base, -8) },
  ];
}

function buildFixes(swing: Swing): FixItem[] {
  const fixes = swing.result_json.fixes ?? [];
  return fixes.slice(0, 3).map((item, i) => ({
    title: i === 0 ? swing.result_json.primaryIssue : `Fix ${i + 1}`,
    detail: item,
    severity: (i === 0 ? 'high' : i === 1 ? 'medium' : 'low') as FixItem['severity'],
  }));
}

function buildDrills(swing: Swing) {
  const d = swing.result_json.drill;
  if (!d) return [];
  return [{
    title: d.name,
    detail: `${d.whyThisDrill}\n\n${d.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    minutes: 10,
  }];
}

function SeverityPill({ severity }: { severity: FixItem['severity'] }) {
  const label = severity.toUpperCase();
  const color = severity === 'high' ? '#FF453A' : severity === 'medium' ? '#FF9F0A' : '#FFD60A';
  return (
    <View style={[styles.severityPill, { borderColor: color + 'AA' }]}>
      <Text style={[styles.severityText, { color }]}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function SwingDetailScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const goBack = () => {
    if (from === 'analysis') {
      // Fresh analysis starts from full-screen modal screens
      // (preview/processing). If we simply replace with the analyze home from
      // inside that modal stack, the home screen can appear as a dismissible
      // modal without the tab bar. Dismiss the modal stack back to the real tab
      // first; fall back to replace when there's nothing to dismiss.
      if (router.canDismiss()) {
        router.dismissAll();
      } else {
        router.replace('/(tabs)/analyze');
      }
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/analyze');
    }
  };
  const { user } = useAuth();
  const { swings } = useSwings(user?.id);
  const [directSwing, setDirectSwing] = useState<Swing | null>(null);
  const [fetching, setFetching] = useState(false);

  const cached = swings.find((s) => s.id === id);
  const swing = cached ?? directSwing;

  useEffect(() => {
    if (!cached && id && !fetching) {
      setFetching(true);
      getSwingById(id).then((s) => {
        setDirectSwing(s);
        setFetching(false);
      });
    }
  }, [cached, id]);

  if (!swing) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorState}>
          {fetching
            ? <ActivityIndicator color="#4CAF50" />
            : <>
                <Text style={styles.errorTitle}>Swing not found</Text>
                <TouchableOpacity onPress={() => router.back()} style={styles.errorBtn}>
                  <Text style={styles.errorBtnText}>Go back</Text>
                </TouchableOpacity>
              </>
          }
        </View>
      </SafeAreaView>
    );
  }

  const score = clampScore(getSwingScore(swing.result_json));
  const scoreRows = buildScoreRows(swing);
  const fixes = buildFixes(swing);
  const drills = buildDrills(swing);
  const ringColor = scoreColor(score);
  const videoUrl = swing.video_url ?? '';
  const hasVideo = !!videoUrl;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Video */}
        <View style={styles.hero}>
          {hasVideo ? (
            <VideoPlayerInline url={videoUrl} onBack={goBack} />
          ) : (
            <>
              <View style={styles.heroShade} />
              <TouchableOpacity onPress={goBack} style={styles.circleBtn} activeOpacity={0.85}>
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Meta */}
        <View style={styles.heroMeta}>
          <Text style={styles.kicker}>SWING ANALYSIS</Text>
          <Text style={styles.heroTitle}>{swing.result_json.primaryIssue}</Text>
          <Text style={styles.heroDate}>{formatDateFull(swing.created_at)}</Text>
        </View>

        {/* Score summary */}
        <View style={styles.summaryCard}>
          <View style={[styles.scoreRing, { borderColor: ringColor }]}>
            <Text style={styles.scoreNumber}>{score}</Text>
            <Text style={styles.scoreLabel}>SCORE</Text>
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryKicker}>AI SUMMARY</Text>
            <Text style={styles.summaryBody} numberOfLines={4}>{humanizeSwingText(swing.result_json.summary)}</Text>
            {swing.result_json.scores?.tempoScore != null && (
              <Text style={styles.tempoLine}>◷ Tempo · {swing.result_json.scores.tempoScore}/100</Text>
            )}
          </View>
        </View>

        {/* Scores */}
        <Text style={styles.sectionTitle}>Scores</Text>
        <View style={styles.panel}>
          {scoreRows.map((row: ScoreRow, i: number) => {
            const barColor = row.value >= 80 ? '#4CAF50' : row.value >= 60 ? '#FFD23A' : '#FF453A';
            return (
              <View key={row.label} style={[styles.scoreRowItem, i < scoreRows.length - 1 && styles.rowDivider]}>
                <View style={styles.scoreRowTop}>
                  <Text style={styles.scoreRowLabel}>{row.label}</Text>
                  <Text style={[styles.scoreRowValue, { color: barColor }]}>{row.value}</Text>
                </View>
                <View style={styles.scoreBarTrack}>
                  <View style={[styles.scoreBarFill, { width: `${row.value}%`, backgroundColor: barColor }]} />
                </View>
                {row.reason && <Text style={styles.scoreRowReason}>{row.reason}</Text>}
              </View>
            );
          })}
        </View>

        {/* Key checkpoints */}
        {swing.result_json.keyCheckpoints && swing.result_json.keyCheckpoints.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Key Checkpoints</Text>
            <View style={styles.panel}>
              {swing.result_json.keyCheckpoints.map((s: string, i: number) => (
                <View key={i} style={[styles.rowItem, i < swing.result_json.keyCheckpoints!.length - 1 && styles.rowDivider]}>
                  <View style={styles.leadingIconGood}>
                    <Ionicons name="checkmark" size={12} color="#B6FF2F" />
                  </View>
                  <Text style={styles.rowTextStrong}>{humanizeSwingText(s)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Evidence */}
        {swing.result_json.evidence && swing.result_json.evidence.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>What the AI Observed</Text>
            <View style={styles.panel}>
              {swing.result_json.evidence.map((e: string, i: number) => (
                <View key={i} style={[styles.rowItem, i < swing.result_json.evidence!.length - 1 && styles.rowDivider]}>
                  <View style={styles.leadingIconEvidence}>
                    <Ionicons name="eye-outline" size={12} color="#8E8E93" />
                  </View>
                  <Text style={[styles.rowTextStrong, { color: '#C0CDD6', fontWeight: '500' }]}>{humanizeSwingText(e)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Fixes */}
        <Text style={styles.sectionTitle}>What to fix</Text>
        <View style={styles.stack}>
          {fixes.map((f) => (
            <View key={f.title} style={styles.panel}>
              <View style={styles.fixHeader}>
                <View style={styles.fixTitleWrap}>
                  <View style={styles.leadingIconWarn}>
                    <Ionicons name="alert-circle-outline" size={13} color="#FF9F0A" />
                  </View>
                  <Text style={styles.fixTitle}>{f.title}</Text>
                </View>
                <SeverityPill severity={f.severity} />
              </View>
              <Text style={styles.fixDetail}>{f.detail}</Text>
            </View>
          ))}
        </View>

        {/* Drills */}
        <Text style={styles.sectionTitle}>Recommended drills</Text>
        <View style={styles.stack}>
          {drills.map((d) => (
            <View key={d.title} style={styles.panel}>
              <View style={styles.fixHeader}>
                <View style={styles.fixTitleWrap}>
                  <View style={styles.leadingIconGood}>
                    <Ionicons name="golf-outline" size={12} color="#B6FF2F" />
                  </View>
                  <Text style={styles.fixTitle}>{d.title}</Text>
                </View>
                <View style={styles.timePill}>
                  <Ionicons name="time-outline" size={11} color="#9AA0A6" />
                  <Text style={styles.timeText}>{d.minutes} min</Text>
                </View>
              </View>
              <Text style={styles.fixDetail}>{d.detail}</Text>
            </View>
          ))}
        </View>

        {/* Games (Social) */}
        <View style={[styles.panel, styles.gamesCard]}>
          <View style={styles.gamesCardLeft}>
            <View style={styles.leadingIconGood}>
              <Ionicons name="flag-outline" size={12} color="#B6FF2F" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gamesTitle}>Join the action</Text>
              <Text style={styles.gamesSub}>Live games, challenges, and friendly competition on Social.</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.gamesCta}
            onPress={() => router.push({ pathname: '/(tabs)/friends', params: { segment: 'games' } })}
            activeOpacity={0.85}
          >
            <Ionicons name="trophy-outline" size={12} color="#0D0D0D" />
            <Text style={styles.gamesCtaText}>Games</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#06090B' },
  scrollContent: { paddingBottom: 110 },
  hero: {
    height: 440,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 28,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: '#111111', opacity: 0.7 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', zIndex: 2 },
  circleBtn: {
    position: 'absolute', top: 12, left: 12, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(8,12,14,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  kicker: { color: '#B6FF2F', fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  heroDate: { color: '#A8B2BA', fontSize: 13, marginTop: 4 },
  summaryCard: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 22,
    borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
    padding: 14, flexDirection: 'row', gap: 14, alignItems: 'center',
  },
  scoreRing: {
    width: 108, height: 108, borderRadius: 54, borderWidth: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#141414',
  },
  scoreNumber: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', lineHeight: 34 },
  scoreLabel: { color: '#8A98A3', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  summaryCopy: { flex: 1, gap: 6 },
  summaryKicker: { color: '#B6FF2F', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  summaryBody: { color: '#EEF4FA', fontSize: 13, lineHeight: 19, fontWeight: '500' },
  tempoLine: { color: '#A8B2BA', fontSize: 14, marginTop: 2 },
  sectionTitle: {
    color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: -0.3,
    marginHorizontal: 16, marginTop: 20, marginBottom: 10,
  },
  scoreRowItem: { paddingVertical: 12, gap: 6 },
  scoreRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreRowLabel: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  scoreRowValue: { fontSize: 16, fontWeight: '800' },
  scoreBarTrack: { height: 5, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  scoreRowReason: { fontSize: 12, color: '#8A98A3', lineHeight: 17, marginTop: 2 },
  panel: {
    marginHorizontal: 16, borderRadius: 20, borderWidth: 1,
    borderColor: '#2A2A2A', backgroundColor: '#1A1A1A', padding: 14,
  },
  rowItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A2A2A',
    marginBottom: 6, paddingBottom: 12,
  },
  leadingIconGood: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#253718',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  leadingIconEvidence: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  leadingIconWarn: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#3C2A17',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTextStrong: { flex: 1, color: '#EAF2F6', fontSize: 14, fontWeight: '600', lineHeight: 21 },
  stack: { gap: 10 },
  fixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  fixTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  fixTitle: { color: '#F4F7FA', fontSize: 15, fontWeight: '700', lineHeight: 20, flexShrink: 1 },
  fixDetail: { color: '#9DA8B0', fontSize: 13, lineHeight: 19, fontWeight: '400' },
  severityPill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#1A1A1A' },
  severityText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  timePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4,
  },
  timeText: { color: '#9AA0A6', fontSize: 12, fontWeight: '700' },
  gamesCard: { marginTop: 14, flexDirection: 'column', gap: 12 },
  gamesCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  gamesTitle: { color: '#F4F7FA', fontSize: 15, fontWeight: '700' },
  gamesSub: { color: '#98A4AD', fontSize: 12, marginTop: 2, maxWidth: 200 },
  gamesCta: {
    backgroundColor: '#4CAF50', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
  },
  gamesCtaText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  errorBtn: { backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', paddingHorizontal: 14, paddingVertical: 10 },
  errorBtnText: { color: '#B6FF2F', fontWeight: '700' },
  videoWrap: { width: '100%', height: '100%' },
  video: { width: '100%', height: '100%' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  heroMeta: { marginHorizontal: 16, marginTop: 14, marginBottom: 4 },

  // Unused legacy styles kept so existing layout isn't broken
  heroTextWrap: { zIndex: 2 },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#B6FF2F', alignItems: 'center', justifyContent: 'center' },
  metricsGrid: { marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48.6%', backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 18, padding: 14, gap: 8 },
  metricLabel: { color: '#A8B2BA', fontSize: 13, letterSpacing: 1.2 },
  metricValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  metricBarTrack: { height: 5, borderRadius: 3, backgroundColor: '#2A2A2A', overflow: 'hidden' },
  metricBarFill: { height: '100%', borderRadius: 3 },
  metricTarget: { color: '#647381', fontSize: 13, marginTop: 2 },
});

