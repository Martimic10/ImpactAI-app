import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useFriendSwings } from '@/hooks/useSwings';
import { Swing, getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';

function formatDate(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function scoreColor(n: number) {
  if (n >= 70) return '#4CAF50';
  if (n >= 50) return '#FF9F0A';
  return '#FF453A';
}

function FriendVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri || null, (p) => { p.loop = true; });
  if (!uri) return null;
  return (
    <VideoView player={player} style={styles.video} contentFit="cover" nativeControls />
  );
}

function SwingSummary({ swing }: { swing: Swing }) {
  const score = Math.round(getSwingScore(swing.result_json));
  const sc = scoreColor(score);
  const fixes = swing.result_json.fixes?.slice(0, 3) ?? [];

  return (
    <View style={styles.summary}>
      {/* Score + issue */}
      <View style={styles.summaryTop}>
        <View style={[styles.scorePill, { borderColor: sc + '66' }]}>
          <Text style={[styles.scoreNum, { color: sc }]}>{score}</Text>
          <Text style={styles.scoreLabel}>pts</Text>
        </View>
        <View style={styles.issueTitleWrap}>
          <Text style={styles.issueTitle} numberOfLines={2}>
            {swing.result_json.primaryIssue}
          </Text>
          {swing.result_json.ballFlightPrediction ? (
            <Text style={styles.ballFlight} numberOfLines={1}>
              {swing.result_json.ballFlightPrediction}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Fix bullets */}
      {fixes.length > 0 && (
        <View style={styles.fixes}>
          {fixes.map((fix, i) => (
            <View key={i} style={styles.fixRow}>
              <View style={styles.fixDot} />
              <Text style={styles.fixText}>{fix}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function FriendSwingScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { id, username, avatarInitials } = useLocalSearchParams<{
    id: string;
    username: string;
    avatarInitials?: string;
  }>();
  const { swings, loading } = useFriendSwings(id);
  const [selectedSwing, setSelectedSwing] = useState<Swing | null>(null);
  const activeSwing = selectedSwing ?? swings[0] ?? null;
  const initials = avatarInitials ?? (username ? username.slice(0, 2).toUpperCase() : '??');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <ProfileAvatar size="sm" initials={initials} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{username}</Text>
          {activeSwing && (
            <Text style={styles.headerSub}>{formatDate(activeSwing.created_at)}</Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textMuted }}>Loading…</Text>
        </View>
      ) : swings.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={28} color="#333" style={{ marginBottom: 8 }} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No shared swings</Text>
          <Text style={[styles.emptySub, { color: colors.textMuted }]}>
            {username} hasn't shared any swings yet
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

          {/* Video */}
          {activeSwing?.video_url ? (
            <View style={styles.videoWrap}>
              <FriendVideoPlayer uri={activeSwing.video_url} />
            </View>
          ) : (
            <View style={[styles.videoWrap, styles.videoEmpty]}>
              <Ionicons name="videocam-outline" size={28} color="#333" />
            </View>
          )}

          {/* Analysis summary */}
          {activeSwing && <SwingSummary swing={activeSwing} />}

          {/* Swing selector — only when multiple */}
          {swings.length > 1 && (
            <View style={styles.selectorWrap}>
              <Text style={[styles.selectorLabel, { color: colors.textMuted }]}>Swings</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorRow}>
                {swings.map((swing) => {
                  const active = activeSwing?.id === swing.id;
                  const sc = scoreColor(Math.round(getSwingScore(swing.result_json)));
                  return (
                    <TouchableOpacity
                      key={swing.id}
                      onPress={() => setSelectedSwing(swing)}
                      activeOpacity={0.8}
                      style={[styles.selectorPill, active && styles.selectorPillActive, { borderColor: active ? '#4CAF50' : colors.border }]}
                    >
                      <Text style={[styles.selectorPillScore, { color: active ? sc : colors.textMuted }]}>
                        {Math.round(getSwingScore(swing.result_json))}
                      </Text>
                      <Text style={[styles.selectorPillDate, { color: active ? colors.text : colors.textMuted }]}>
                        {formatDate(swing.created_at)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, flexShrink: 0,
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: '#555', marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  videoWrap: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111',
    height: 320,
  },
  videoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: { width: '100%', height: '100%' },

  // Summary card
  summary: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: '#161616',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#242424',
    padding: 16,
    gap: 14,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  scorePill: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: '#111',
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  scoreNum: { fontSize: 22, fontWeight: '800', lineHeight: 24 },
  scoreLabel: { fontSize: 10, color: '#555', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  issueTitleWrap: { flex: 1, paddingTop: 4 },
  issueTitle: { fontSize: 16, fontWeight: '700', color: '#FFF', lineHeight: 22, letterSpacing: -0.2 },
  ballFlight: { fontSize: 12, color: '#555', marginTop: 4, lineHeight: 17 },

  fixes: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#242424', paddingTop: 12 },
  fixRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  fixDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#4CAF50', marginTop: 7, flexShrink: 0 },
  fixText: { flex: 1, fontSize: 13, color: '#8E8E93', lineHeight: 19 },

  // Swing selector
  selectorWrap: { marginTop: 20, paddingHorizontal: 20 },
  selectorLabel: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 10,
  },
  selectorRow: { gap: 8 },
  selectorPill: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1.5,
    backgroundColor: '#161616',
    alignItems: 'center', gap: 2,
  },
  selectorPillActive: { backgroundColor: '#0F1F0F' },
  selectorPillScore: { fontSize: 16, fontWeight: '800' },
  selectorPillDate: { fontSize: 11, fontWeight: '500' },
});
