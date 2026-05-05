import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SwingThumbnail } from '@/components/SwingThumbnail';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { useFocusEffect } from 'expo-router';
import { hasProAccess, PLAN_LIMITS } from '@/lib/plans';
import { getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { PaywallModal } from '@/components/PaywallModal';

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ScoreRing({ score }: { score: number }) {
  const pct = score / 100;
  const size = 88;
  const stroke = 7;
  const color = score >= 70 ? '#4CAF50' : score >= 50 ? '#FF9F0A' : '#FF453A';

  return (
    <View style={[styles.ringOuter, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.ringTrack, { width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: '#2A2A2A' }]} />
      <View style={[styles.ringFill, { width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color, opacity: 0.15 }]} />
      <View style={[styles.ringCenter, { width: size - stroke * 2 - 4, height: size - stroke * 2 - 4, borderRadius: (size - stroke * 2 - 4) / 2 }]}>
        <Text style={[styles.ringScore, { color }]}>{score}</Text>
        <Text style={styles.ringLabel}>SCORE</Text>
      </View>
      <View style={[styles.ringArc, { width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderTopColor: color, borderRightColor: pct > 0.25 ? color : 'transparent', borderBottomColor: pct > 0.5 ? color : 'transparent', borderLeftColor: pct > 0.75 ? color : 'transparent' }]} />
    </View>
  );
}

export default function AnalyzeIndexScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { swings, deleteSwing, refetch } = useSwings(user?.id);

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const isPro = hasProAccess(user);
  const latestSwing = swings[0] ?? null;
  const latestScore = latestSwing ? getSwingScore(latestSwing.result_json) : null;
  const avgScore =
    swings.length > 0
      ? Math.round(swings.reduce((s, sw) => s + getSwingScore(sw.result_json ?? null), 0) / swings.length)
      : null;
  const trend =
    swings.length >= 2
      ? Math.round(getSwingScore(swings[0].result_json ?? null) - getSwingScore(swings[1].result_json ?? null))
      : null;

  const dailyLimit = PLAN_LIMITS[user?.plan ?? 'free'].swingsPerDay;
  const todaySwings = swings.filter((s) => {
    const d = new Date(s.created_at);
    return d.toDateString() === new Date().toDateString();
  }).length;
  const analysesLeft = Math.max(0, (dailyLimit === Infinity ? 99 : dailyLimit) - todaySwings);
  const recentSwings = swings.slice(0, 4);

  function handleDelete(swingId: string) {
    Alert.alert('Delete swing?', 'This analysis will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteSwing(swingId),
      },
    ]);
  }

  function openCaptureModal() {
    setShowCaptureModal(true);
  }

  function handleRecordFromModal() {
    setShowCaptureModal(false);
    router.push('/(tabs)/analyze/record');
  }

  async function handleUploadFromModal() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      allowsEditing: false,
    });

    setShowCaptureModal(false);

    if (result.canceled || !result.assets?.[0]) return;

    router.push({ pathname: '/(tabs)/analyze/preview', params: { uri: result.assets[0].uri } });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.welcomeText}>Welcome back</Text>
            <Text style={[styles.headline, { color: colors.text }]}>Ready to improve?</Text>
          </View>
          <View style={[styles.planBadge, isPro && styles.planBadgePro]}>
            <Ionicons name="flash" size={11} color={isPro ? '#4CAF50' : '#8E8E93'} />
            <Text style={[styles.planBadgeText, isPro && styles.planBadgeTextPro]}>
              {isPro ? 'PRO' : 'FREE'}
            </Text>
          </View>
        </View>

        {/* ── Latest Swing Card ── */}
        {latestSwing && latestScore !== null ? (
          <View style={styles.latestCard}>
            <View style={styles.latestCardContent}>
              <View style={styles.latestLeft}>
                <View style={styles.latestLabelRow}>
                  <Ionicons name="flash" size={11} color="#4CAF50" />
                  <Text style={styles.latestLabel}>LATEST SWING</Text>
                </View>
                <Text style={styles.latestScore}>
                  {latestScore}<Text style={styles.latestScoreMax}>/100</Text>
                </Text>
                {avgScore !== null && (
                  <Text style={styles.latestMeta}>
                    Avg {avgScore}
                    {trend !== null && (
                      <Text style={{ color: trend >= 0 ? '#4CAF50' : '#FF453A' }}>
                        {' '}· {trend >= 0 ? '+' : ''}{trend} trend
                      </Text>
                    )}
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.analyzeBtn}
                  onPress={openCaptureModal}
                  activeOpacity={0.85}
                >
                  <Text style={styles.analyzeBtnText}>Analyze new swing</Text>
                  <Ionicons name="arrow-forward" size={13} color="#fff" />
                </TouchableOpacity>
              </View>
              <ScoreRing score={latestScore} />
            </View>
          </View>
        ) : (
          <View style={styles.latestCard}>
            <View style={styles.emptyLatest}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="golf-outline" size={36} color="#4CAF50" />
              </View>
              <Text style={styles.emptyLatestTitle}>No swings yet</Text>
              <Text style={styles.emptyLatestSub}>Record your first swing to see your score</Text>
            </View>
          </View>
        )}

        {/* ── Record / Upload Cards ── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={openCaptureModal}
            activeOpacity={0.82}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="camera" size={26} color="#FFFFFF" />
            </View>
            <Text style={styles.actionTitle}>Record</Text>
            <Text style={styles.actionSub}>Capture live</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={openCaptureModal}
            activeOpacity={0.82}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="cloud-upload" size={26} color="#FFFFFF" />
            </View>
            <Text style={styles.actionTitle}>Upload</Text>
            <Text style={styles.actionSub}>From gallery</Text>
          </TouchableOpacity>
        </View>

        {/* ── Plan Usage Card ── */}
        {!isPro && (
          <TouchableOpacity style={styles.planCard} onPress={() => setShowPaywall(true)} activeOpacity={0.85}>
            <View style={styles.planCardHeader}>
              <Ionicons name="flame" size={13} color="#4CAF50" />
              <Text style={styles.planCardLabel}>FREE PLAN</Text>
            </View>
            <Text style={styles.planCardCount}>
              {analysesLeft} of {dailyLimit === Infinity ? '∞' : dailyLimit} analyses left
            </Text>
            <View style={styles.planBar}>
              <View style={[styles.planBarFill, {
                width: dailyLimit === Infinity
                  ? '100%'
                  : `${(analysesLeft / (dailyLimit as number)) * 100}%`,
              }]} />
            </View>
            <View style={styles.planCardCtaRow}>
              <Text style={styles.planCardCta}>Tap to unlock unlimited swing analysis</Text>
              <Ionicons name="arrow-forward" size={12} color="#666666" />
            </View>
          </TouchableOpacity>
        )}

        {/* ── Recent Swings ── */}
        {recentSwings.length > 0 && (
          <View style={styles.recentSection}>
            <View style={styles.recentHeader}>
              <Text style={[styles.recentTitle, { color: colors.text }]}>Recent Swings</Text>
              <TouchableOpacity
                style={styles.seeAllBtn}
                onPress={() => router.push('/(tabs)/progress')}
              >
                <Text style={styles.seeAllText}>See all</Text>
                <Ionicons name="chevron-forward" size={13} color="#4CAF50" />
              </TouchableOpacity>
            </View>

            <View style={styles.recentList}>
              {recentSwings.map((swing) => {
                const score = getSwingScore(swing.result_json);
                const scoreColor = score >= 70 ? '#4CAF50' : score >= 50 ? '#FF9F0A' : '#FF453A';
                return (
                  <TouchableOpacity
                    key={swing.id}
                    style={styles.swingRow}
                    onPress={() =>
                      router.push({
                        pathname: '/(tabs)/analyze/swing/[id]',
                        params: { id: swing.id },
                      })
                    }
                    onLongPress={() => handleDelete(swing.id)}
                    delayLongPress={400}
                    activeOpacity={0.82}
                  >
                    <SwingThumbnail swing={swing} size="sm" />
                    <View style={styles.swingInfo}>
                      <Text style={styles.swingIssue} numberOfLines={1}>
                        {swing.result_json.primaryIssue}
                      </Text>
                      <Text style={styles.swingMeta}>
                        {formatDate(swing.created_at)}
                        {swing.result_json.ballFlightPrediction
                          ? ` · ${swing.result_json.ballFlightPrediction.split(' ').slice(0, 3).join(' ')}`
                          : ''}
                      </Text>
                    </View>
                    <View style={[styles.scoreBadge, { backgroundColor: scoreColor + '22' }]}>
                      <Text style={[styles.scoreBadgeText, { color: scoreColor }]}>{score}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDelete(swing.id)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color="#666666" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={showCaptureModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCaptureModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowCaptureModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View style={{ gap: 10 }}>
                    {/* Drag handle */}
                    <View style={styles.dragHandle} />

                    {/* Header */}
                    <View style={styles.modalHeader}>
                      <TouchableOpacity
                        onPress={() => setShowCaptureModal(false)}
                        style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="close" size={18} color={colors.text} />
                      </TouchableOpacity>
                      <Text style={[styles.modalTitle, { color: colors.text }]}>New Swing</Text>
                      <View style={{ width: 40 }} />
                    </View>

                    {/* Hero */}
                    <View style={[styles.modalHero, {
                      backgroundColor: theme === 'dark' ? '#152615' : '#E9F8EC',
                      borderColor: theme === 'dark' ? '#2D4630' : '#CFE8D6',
                    }]}>
                      <Ionicons name="sparkles" size={16} color="#B6FF2F" />
                      <Text style={styles.modalKicker}>AI SWING ANALYSIS</Text>
                      <Text style={[styles.modalHeroTitle, { color: colors.text }]}>
                        Choose how to capture your swing
                      </Text>
                      <Text style={[styles.modalHeroSub, { color: colors.textSecondary }]}>
                        Film down-the-line or face-on for the best analysis.
                      </Text>
                    </View>

                    {/* Actions */}
                    <View style={styles.modalActions}>
                      <TouchableOpacity
                        style={[styles.modalActionRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                        onPress={handleRecordFromModal}
                        activeOpacity={0.85}
                      >
                        <View style={styles.modalActionIcon}>
                          <Ionicons name="camera" size={20} color="#B6FF2F" />
                        </View>
                        <View style={styles.modalActionTextWrap}>
                          <Text style={[styles.modalActionTitle, { color: colors.text }]}>Record swing</Text>
                          <Text style={[styles.modalActionSub, { color: colors.textSecondary }]}>Use your camera in real time</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.modalActionRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                        onPress={handleUploadFromModal}
                        activeOpacity={0.85}
                      >
                        <View style={styles.modalActionIcon}>
                          <Ionicons name="cloud-upload-outline" size={20} color="#B6FF2F" />
                        </View>
                        <View style={styles.modalActionTextWrap}>
                          <Text style={[styles.modalActionTitle, { color: colors.text }]}>Upload from gallery</Text>
                          <Text style={[styles.modalActionSub, { color: colors.textSecondary }]}>Pick a clip from your phone</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    {/* Tips */}
                    <View style={[styles.tipsCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                      <Text style={[styles.tipsTitle, { color: colors.text }]}>Filming tips</Text>
                      {[
                        'Frame your whole body in portrait',
                        'Stand 8–12 feet from the camera',
                        'Good lighting — avoid direct sun behind you',
                        'One clean swing per clip',
                      ].map((tip) => (
                        <View key={tip} style={styles.tipRow}>
                          <Ionicons name="checkmark-circle-outline" size={18} color="#B6FF2F" />
                          <Text style={[styles.tipText, { color: colors.textSecondary }]}>{tip}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </TouchableWithoutFeedback>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

const CARD_RADIUS = 20;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  welcomeText: { fontSize: 13, color: '#8E8E93', fontWeight: '500', marginBottom: 2 },
  headline: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  planBadgePro: { backgroundColor: '#1B2E1B', borderColor: '#2E7D32' },
  planBadgeText: { fontSize: 12, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.5 },
  planBadgeTextPro: { color: '#4CAF50' },

  latestCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: '#161C16',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: '#2A3A2A',
    overflow: 'hidden',
  },
  latestCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 22,
  },
  latestLeft: { flex: 1, marginRight: 16 },
  latestLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  latestLabel: { fontSize: 11, fontWeight: '700', color: '#4CAF50', letterSpacing: 1 },
  latestScore: { fontSize: 46, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, lineHeight: 52 },
  latestScoreMax: { fontSize: 22, fontWeight: '500', color: '#8E8E93' },
  latestMeta: { fontSize: 13, color: '#8E8E93', marginTop: 2, marginBottom: 16 },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  analyzeBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  emptyLatest: { padding: 28, alignItems: 'center', gap: 8 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1B2E1B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyLatestTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  emptyLatestSub: { fontSize: 13, color: '#8E8E93', textAlign: 'center' },

  ringOuter: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  ringTrack: { position: 'absolute' },
  ringFill: { position: 'absolute' },
  ringArc: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: '#161C16' },
  ringScore: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  ringLabel: { fontSize: 9, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.5, marginTop: -2 },

  actionRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 14 },
  actionCard: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: CARD_RADIUS,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 8,
  },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  actionTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  actionSub: { fontSize: 12, color: '#8E8E93' },

  planCard: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#161616',
    borderRadius: CARD_RADIUS,
    padding: 20,
    borderWidth: 1,
    borderColor: '#282828',
    gap: 8,
  },
  planCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planCardLabel: { fontSize: 11, fontWeight: '800', color: '#4CAF50', letterSpacing: 1.2 },
  planCardCount: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  planBar: {
    height: 3,
    backgroundColor: '#2A2A2A',
    borderRadius: 2,
    marginTop: 4,
    marginBottom: 2,
    overflow: 'hidden',
  },
  planBarFill: { height: '100%', backgroundColor: '#FF9F0A', borderRadius: 2 },
  planCardCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  planCardCta: { fontSize: 12, color: '#666666' },

  recentSection: { paddingHorizontal: 16 },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  recentTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 13, color: '#4CAF50', fontWeight: '600' },
  recentList: {
    gap: 10,
  },
  swingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1A1A1A',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  swingThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#242424',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  swingInfo: { flex: 1 },
  swingIssue: { fontSize: 14, fontWeight: '600', color: '#FFFFFF', marginBottom: 3 },
  swingMeta: { fontSize: 12, color: '#8E8E93' },
  scoreBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scoreBadgeText: { fontSize: 16, fontWeight: '800' },
  deleteBtn: {
    padding: 4,
    marginLeft: -4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A3A3A',
    alignSelf: 'center',
    marginBottom: 2,
  },
  modalActions: {
    gap: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  modalHero: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 5,
  },
  modalKicker: {
    color: '#B6FF2F',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  modalHeroTitle: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
    letterSpacing: -0.3,
  },
  modalHeroSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  modalActionRow: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1E3A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionTextWrap: { flex: 1 },
  modalActionTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  modalActionSub: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  tipsCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
});
