import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { AIAnalysisCard } from '@/components/analyze/AIAnalysisCard';
import { useFriendSwings } from '@/hooks/useSwings';
import { Swing, getSwingScore } from '@/types';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SwingPreview({ swing, onSelect, selected }: { swing: Swing; onSelect: () => void; selected: boolean }) {
  const colors = useAppColors();
  return (
    <TouchableOpacity onPress={onSelect} activeOpacity={0.8}>
      <Card variant={selected ? 'green' : 'elevated'}>
        <View style={styles.swingRow}>
          <View style={styles.swingIcon}>
            <Text style={{ fontSize: 18 }}>🎥</Text>
          </View>
          <View style={styles.swingInfo}>
            <Text style={[styles.swingIssue, { color: colors.text }]} numberOfLines={1}>{swing.result_json.primaryIssue}</Text>
            <Text style={styles.swingDate}>{formatDate(swing.created_at)}</Text>
          </View>
          <Text style={styles.swingScore}>{Math.round(getSwingScore(swing.result_json))}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function FriendVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; });
  return (
    <View style={styles.videoWrap}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
    </View>
  );
}

export default function FriendSwingScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { id, username } = useLocalSearchParams<{ id: string; username: string }>();
  const { swings, loading } = useFriendSwings(id);
  const [selectedSwing, setSelectedSwing] = useState<Swing | null>(null);
  const activeSwing = selectedSwing ?? swings[0] ?? null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{username}'s Swings</Text>
          <Text style={styles.headerSubtitle}>Friends only • {swings.length} shared</Text>
        </View>
        <View style={styles.headerAvatar}>
          <Text style={{ fontSize: 20 }}>🏌️</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Text style={styles.mutedText}>Loading swings…</Text>
        </View>
      ) : swings.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>🔒</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No shared swings</Text>
          <Text style={styles.emptySubtitle}>
            {username} hasn't shared any swings with friends yet
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {activeSwing && (
            <View style={styles.section}>
              <FriendVideoPlayer uri={activeSwing.video_url} />
            </View>
          )}

          {swings.length > 1 && (
            <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Select Swing</Text>
              <View style={styles.list}>
                {swings.map((swing) => (
                  <SwingPreview
                    key={swing.id}
                    swing={swing}
                    selected={activeSwing?.id === swing.id}
                    onSelect={() => setSelectedSwing(swing)}
                  />
                ))}
              </View>
            </View>
          )}

          {activeSwing && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>AI Analysis</Text>
              <AIAnalysisCard result={activeSwing.result_json} />
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  backIcon: { fontSize: 18, color: '#FFFFFF' },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1B2E1B', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  mutedText: { color: '#8E8E93' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  emptySubtitle: { fontSize: 13, color: '#8E8E93', marginTop: 6, textAlign: 'center' },
  section: { paddingHorizontal: 16, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  list: { gap: 8 },
  videoWrap: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  video: { width: '100%', height: 260 },
  swingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swingIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#1B2E1B', alignItems: 'center', justifyContent: 'center' },
  swingInfo: { flex: 1 },
  swingIssue: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  swingDate: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  swingScore: { fontSize: 13, fontWeight: '700', color: '#4CAF50' },
});
