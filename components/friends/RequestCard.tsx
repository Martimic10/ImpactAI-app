import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { FriendRequest } from '@/types';
import { useAppColors } from '@/lib/theme';

interface RequestCardProps {
  request: FriendRequest;
  onAccept: () => void;
  onDecline: () => void;
}

export function RequestCard({ request, onAccept, onDecline }: RequestCardProps) {
  const colors = useAppColors();
  const username = request.sender?.username ?? 'Unknown';

  return (
    <Card variant="elevated">
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: colors.surfaceSuccess }]}>
          <Text style={{ fontSize: 18 }}>🏌️</Text>
        </View>
        <View style={styles.info}>
          <Text style={[styles.username, { color: colors.text }]}>{username}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>wants to be your golf buddy</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={onDecline} style={[styles.declineBtn, { backgroundColor: colors.surfaceAlt }]}> 
            <Text style={[styles.declineIcon, { color: colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onAccept} style={[styles.acceptBtn, { backgroundColor: colors.success }]}> 
            <Text style={styles.acceptIcon}>✓</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  username: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  declineBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineIcon: { fontSize: 14 },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptIcon: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
});
