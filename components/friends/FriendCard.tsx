import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';

export interface FriendCardData {
  id: string;
  displayName: string;
  username: string;
  avatarInitials: string;
  bestScore: number;
  streak: number;
  lastClub: string;
  lastActive: string;
  status?: string;
}

interface Props {
  data: FriendCardData;
  onGames?: () => void;
  onViewSwing?: () => void;
}

function scoreColor(n: number) {
  if (n >= 70) return '#4CAF50';
  if (n >= 50) return '#FF9F0A';
  return '#FF453A';
}

export function FriendCard({ data, onGames, onViewSwing }: Props) {
  const colors = useAppColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Top row — avatar / name / time */}
      <View style={styles.topRow}>
        <ProfileAvatar size="sm" initials={data.avatarInitials} />

        <View style={styles.nameBlock}>
          <Text style={[styles.displayName, { color: colors.text }]}>{data.displayName}</Text>
          <Text style={styles.username}>@{data.username}</Text>
        </View>

        <Text style={styles.lastActive}>{data.lastActive}</Text>
      </View>

      {/* Status */}
      {data.status ? (
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText} numberOfLines={1}>{data.status}</Text>
        </View>
      ) : null}

      {/* Stats */}
      <View style={[styles.statsRow, { borderColor: colors.border }]}>
        <View style={styles.stat}>
          <Ionicons name="flame" size={13} color="#FF9F0A" />
          <Text style={[styles.statValue, { color: colors.text }]}>{data.streak}d</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <View style={[styles.scoreDot, { backgroundColor: scoreColor(data.bestScore) + '22' }]}>
            <Text style={[styles.scoreValue, { color: scoreColor(data.bestScore) }]}>{data.bestScore}</Text>
          </View>
          <Text style={styles.statLabel}>Best</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Ionicons name="golf-outline" size={13} color="#8E8E93" />
          <Text style={[styles.statValue, { color: colors.text }]}>{data.lastClub}</Text>
          <Text style={styles.statLabel}>Last club</Text>
        </View>
      </View>

      {/* Buttons */}
      <View style={styles.btnRow}>
        <TouchableOpacity
          onPress={onGames}
          activeOpacity={0.8}
          style={[styles.gamesBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="flag-outline" size={14} color="#8E8E93" />
          <Text style={styles.gamesBtnText}>Games</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onViewSwing}
          activeOpacity={0.8}
          style={styles.viewBtn}
        >
          <Text style={styles.viewBtnText}>View Swing</Text>
          <Ionicons name="arrow-forward" size={13} color="#0D0D0D" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },

  // Top row
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameBlock: { flex: 1 },
  displayName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  username: { fontSize: 12, color: '#555', marginTop: 1, fontWeight: '500' },
  lastActive: { fontSize: 11, color: '#48484A', fontWeight: '500' },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', flexShrink: 0 },
  statusText: { fontSize: 13, color: '#4CAF50', fontWeight: '500', flex: 1 },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28 },
  statValue: { fontSize: 13, fontWeight: '700' },
  statLabel: { fontSize: 10, color: '#555', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreDot: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  scoreValue: { fontSize: 13, fontWeight: '800' },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 8 },
  gamesBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#111',
  },
  gamesBtnText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  viewBtn: {
    flex: 1.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
  },
  viewBtnText: { fontSize: 13, fontWeight: '700', color: '#0D0D0D' },
});
