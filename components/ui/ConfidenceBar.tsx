import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppColors } from '@/lib/theme';

interface ConfidenceBarProps {
  value: number; // 1-10
}

export function ConfidenceBar({ value }: ConfidenceBarProps) {
  const colors = useAppColors();
  const pct = (value / 10) * 100;
  const color = value >= 7 ? colors.success : value >= 5 ? colors.warning : colors.danger;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>AI Confidence</Text>
        <Text style={[styles.value, { color }]}>{value}/10</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}> 
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '500' },
  value: { fontSize: 13, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
