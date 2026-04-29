import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LeaderboardEntry } from '@/types';
import { useAppColors } from '@/lib/theme';

interface LeaderboardItemProps {
  entry: LeaderboardEntry;
  rank: number;
  onViewSwing?: () => void;
}

const RANK_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
};

export function LeaderboardItem({ entry, rank, onViewSwing }: LeaderboardItemProps) {
  const colors = useAppColors();
  const rankColor = RANK_COLORS[rank] ?? colors.textMuted;
  const isTop3 = rank <= 3;

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: isTop3 ? rankColor + '50' : colors.border,
          backgroundColor: isTop3 ? colors.surfaceAlt : colors.surface,
        },
      ]}
    >
      <View style={[styles.rankBadge, { backgroundColor: isTop3 ? rankColor + '20' : colors.surfaceAlt }]}> 
        <Text style={[styles.rankText, { color: isTop3 ? rankColor : colors.textSecondary }]}>{rank}</Text>
      </View>

      <View style={[styles.avatar, { backgroundColor: colors.surfaceSuccess }]}>
        <Ionicons name="person" size={16} color={colors.success} />
      </View>

      <View style={styles.info}>
        <Text style={[styles.username, { color: colors.text }]}>{entry.user.username}</Text>
        <View style={styles.meta}>
          <Text style={[styles.points, { color: colors.success }]}>+{entry.score} pts</Text>
          <Text style={[styles.dot, { color: colors.textMuted }]}>•</Text>
          <Ionicons name="flame" size={12} color={colors.warning} />
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>{entry.streak}d</Text>
        </View>
      </View>

      {onViewSwing && (
        <TouchableOpacity onPress={onViewSwing} style={[styles.viewBtn, { backgroundColor: colors.surfaceSuccess, borderColor: colors.success }]}> 
          <Text style={[styles.viewBtnText, { color: colors.success }]}>View</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: 13, fontWeight: '700' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  username: { fontSize: 14, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  points: { fontSize: 12, fontWeight: '600' },
  dot: { fontSize: 12 },
  metaText: { fontSize: 12 },
  viewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  viewBtnText: { fontSize: 11, fontWeight: '600' },
});
