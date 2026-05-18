import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.14)';

type ProUpsellCardProps = {
  title: string;
  subtitle: string;
  onUpgrade: () => void;
};

export function ProUpsellCard({ title, subtitle, onUpgrade }: ProUpsellCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={20} color={ACCENT} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <TouchableOpacity style={styles.btn} onPress={onUpgrade} activeOpacity={0.9}>
          <Ionicons name="sparkles" size={16} color="#0A0A0A" />
          <Text style={styles.btnText}>Unlock Pro</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 14 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(52, 224, 111, 0.28)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    marginBottom: 4,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0A0A0A',
  },
});
