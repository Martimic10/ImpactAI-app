import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';

export type LeaderboardMode = 'score' | 'streak' | 'swings';

export interface LeaderboardRowData {
  id: string;
  username: string;
  displayName: string;
  avatarInitials: string;
  avatarUrl?: string;
  score: number;
  trend?: string;
  streak: number;
  totalSwings: number;
}

interface Props {
  data: LeaderboardRowData;
  rank: number;
  mode: LeaderboardMode;
}

const MEDAL_COLOR: Record<number, string> = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
const MEDAL_BG:    Record<number, string> = { 1: '#332500', 2: '#222222', 3: '#271A0A' };
const MEDAL_ICON:  Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function primaryValue(data: LeaderboardRowData, mode: LeaderboardMode): { value: string; label: string } {
  if (mode === 'streak')  return { value: `${data.streak}d`,       label: 'streak' };
  if (mode === 'swings')  return { value: `${data.totalSwings}`,    label: 'swings' };
  return                         { value: `${data.score}`,          label: 'pts'    };
}

function trendColor(trend?: string) {
  if (!trend) return '#555';
  return trend.startsWith('+') ? '#4CAF50' : '#FF453A';
}

export function LeaderboardItem({ data, rank, mode }: Props) {
  const colors  = useAppColors();
  const isTop3  = rank <= 3;
  const medal   = MEDAL_COLOR[rank];
  const bg      = MEDAL_BG[rank];
  const primary = primaryValue(data, mode);
  const tColor  = trendColor(data.trend);

  return (
    <View style={[
      styles.row,
      {
        backgroundColor: isTop3 ? bg : colors.surface,
        borderColor:     isTop3 ? (medal + '55') : colors.border,
      },
    ]}>
      {/* Rank */}
      <View style={[styles.rankWrap, isTop3 && { backgroundColor: medal + '18' }]}>
        {isTop3
          ? <Text style={styles.medal}>{MEDAL_ICON[rank]}</Text>
          : <Text style={[styles.rankNum, { color: colors.textMuted }]}>{rank}</Text>
        }
      </View>

      <ProfileAvatar
        size="xs"
        imageUri={data.avatarUrl}
        initials={data.avatarInitials}
        backgroundColor={isTop3 ? bg : '#1B2E1B'}
        initialsColor={isTop3 ? medal : '#4CAF50'}
      />

      {/* Name + meta */}
      <View style={styles.info}>
        <Text style={[styles.displayName, { color: colors.text }]}>{data.displayName}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="flame" size={11} color="#FF9F0A" />
          <Text style={styles.metaText}>{data.streak}d</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.metaText}>{data.totalSwings} swings</Text>
        </View>
      </View>

      {/* Primary value + trend */}
      <View style={styles.valueWrap}>
        <Text style={[styles.primaryValue, isTop3 && { color: medal }]}>
          {primary.value}
        </Text>
        <Text style={styles.primaryLabel}>{primary.label}</Text>
        {data.trend ? (
          <View style={[styles.trendBadge, { backgroundColor: tColor + '18' }]}>
            <Text style={[styles.trendText, { color: tColor }]}>{data.trend}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 18,
    borderWidth: 1,
  },

  // Rank
  rankWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medal: { fontSize: 18 },
  rankNum: { fontSize: 14, fontWeight: '800' },

  // Name
  info: { flex: 1 },
  displayName: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontSize: 11, color: '#666', fontWeight: '500' },
  dot: { fontSize: 11, color: '#444' },

  // Value
  valueWrap: { alignItems: 'flex-end', gap: 2 },
  primaryValue: { fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 },
  primaryLabel: { fontSize: 10, color: '#555', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  trendBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, marginTop: 2 },
  trendText: { fontSize: 11, fontWeight: '700' },
});
