import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { UserProfile } from '@/types';
import { useAppColors } from '@/lib/theme';

interface FriendCardProps {
  friend: UserProfile;
  onViewSwing?: () => void;
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return 'a while ago';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FriendCard({ friend, onViewSwing }: FriendCardProps) {
  const colors = useAppColors();

  return (
    <Card variant="elevated">
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: colors.surfaceSuccess }]}>
          <Text style={{ fontSize: 20 }}>🏌️</Text>
        </View>

        <View style={styles.info}>
          <Text style={[styles.username, { color: colors.text }]}>{friend.username}</Text>
          <View style={styles.meta}>
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>🔥 {friend.streak ?? 0} day streak</Text>
            <Text style={[styles.dot, { color: colors.textMuted }]}>•</Text>
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{timeAgo(friend.last_active)}</Text>
          </View>
        </View>

        {onViewSwing && (
          <TouchableOpacity onPress={onViewSwing} style={[styles.viewBtn, { backgroundColor: colors.surfaceSuccess, borderColor: colors.success }]}> 
            <Text style={[styles.viewBtnText, { color: colors.success }]}>View Swing</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  username: { fontSize: 15, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  metaText: { fontSize: 12 },
  dot: { fontSize: 12 },
  viewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  viewBtnText: { fontSize: 12, fontWeight: '600' },
});
