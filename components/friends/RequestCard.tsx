import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';

export interface RequestCardData {
  id: string;
  senderId: string;
  displayName: string;
  username: string;
  avatarInitials: string;
}

interface Props {
  data: RequestCardData;
  onAccept: () => void;
  onDecline: () => void;
}

export function RequestCard({ data, onAccept, onDecline }: Props) {
  const colors = useAppColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.topRow}>
        <ProfileAvatar
          size="sm"
          initials={data.avatarInitials}
          backgroundColor="#1A1A28"
          initialsColor="#A0A0D0"
        />
        <View style={styles.nameBlock}>
          <Text style={[styles.displayName, { color: colors.text }]}>{data.displayName}</Text>
          <Text style={styles.username}>@{data.username}</Text>
          <Text style={styles.subtitle}>wants to be your golf buddy</Text>
        </View>
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity onPress={onDecline} activeOpacity={0.8} style={[styles.declineBtn, { borderColor: colors.border }]}>
          <Ionicons name="close" size={14} color="#8E8E93" />
          <Text style={styles.declineText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onAccept} activeOpacity={0.8} style={styles.acceptBtn}>
          <Ionicons name="checkmark" size={14} color="#0D0D0D" />
          <Text style={styles.acceptText}>Accept</Text>
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
    gap: 14,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  nameBlock: { flex: 1, gap: 2 },
  displayName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  username: { fontSize: 12, color: '#555', fontWeight: '500' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 3 },
  btnRow: { flexDirection: 'row', gap: 8 },
  declineBtn: {
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
  declineText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  acceptBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
  },
  acceptText: { fontSize: 13, fontWeight: '700', color: '#0D0D0D' },
});
