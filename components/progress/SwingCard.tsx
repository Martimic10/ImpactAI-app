import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { Swing } from '@/types';
import { useAppColors } from '@/lib/theme';

interface SwingCardProps {
  swing: Swing;
  onPress?: () => void;
  showTrend?: boolean;
  prevConfidence?: number;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SwingCard({ swing, onPress, prevConfidence }: SwingCardProps) {
  const colors = useAppColors();
  const result = swing.result_json;
  const score = result.scores?.confidence ?? result.confidence ?? 5;
  const improved = prevConfidence !== undefined && score > prevConfidence;
  const declined = prevConfidence !== undefined && score < prevConfidence;

  const trendBg = improved ? colors.surfaceSuccess : declined ? 'rgba(255,69,58,0.14)' : colors.surfaceAlt;
  const trendColor = improved ? colors.success : declined ? colors.danger : colors.textSecondary;
  const trendLabel = improved ? '↑ Improving' : declined ? '↓ Declined' : '→ Stable';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card variant="elevated">
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={[styles.date, { color: colors.textMuted }]}>{formatDate(swing.created_at)}</Text>
              <Text style={[styles.issue, { color: colors.text }]} numberOfLines={1}>{result.primaryIssue}</Text>
            </View>
            {prevConfidence !== undefined && (
              <View style={[styles.trendBadge, { backgroundColor: trendBg }]}> 
                <Text style={[styles.trendText, { color: trendColor }]}>{trendLabel}</Text>
              </View>
            )}
          </View>
          <ConfidenceBar value={score} />
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  titleBlock: { flex: 1, marginRight: 10 },
  date: { fontSize: 12, marginBottom: 2 },
  issue: { fontSize: 15, fontWeight: '600' },
  trendBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  trendText: { fontSize: 11, fontWeight: '700' },
});
