import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { SwingResult } from '@/types';
import { useAppColors } from '@/lib/theme';

interface AIAnalysisCardProps {
  result: SwingResult;
}

export function AIAnalysisCard({ result }: AIAnalysisCardProps) {
  const colors = useAppColors();

  return (
    <View style={styles.container}>
      <Card variant="elevated">
        <View style={styles.issueSection}>
          <View style={styles.issueHeader}>
            <Text style={{ fontSize: 20 }}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Main Issue</Text>
              <Text style={[styles.issueTitle, { color: colors.text }]}>{result.primaryIssue}</Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Why this matters</Text>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{result.whyItHappens}</Text>
          </View>
        </View>
      </Card>

      <Card variant="elevated">
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>How to fix it</Text>
        <View style={styles.fixList}>
          {result.fixes.map((step: string, i: number) => (
            <View key={i} style={styles.fixRow}>
              <View style={[styles.stepBadge, { backgroundColor: colors.success }]}>
                <Text style={styles.stepNumber}>{i + 1}</Text>
              </View>
              <Text style={[styles.fixText, { color: colors.textSecondary }]}>{step}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card variant="green">
        <View style={styles.ballFlightRow}>
          <Text style={{ fontSize: 18 }}>⛳</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greenLabel, { color: colors.success }]}>Ball Flight Prediction</Text>
            <Text style={[styles.greenValue, { color: colors.text }]}>{result.ballFlightPrediction}</Text>
          </View>
        </View>
      </Card>

      <Card variant="elevated">
        <ConfidenceBar value={result.scores?.confidence ?? result.confidence ?? 5} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  issueSection: { gap: 12 },
  issueHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  issueTitle: { fontSize: 17, fontWeight: '700' },
  divider: { height: 1 },
  bodyText: { fontSize: 14, lineHeight: 20 },
  fixList: { gap: 10, marginTop: 8 },
  fixRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumber: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  fixText: { fontSize: 14, lineHeight: 20, flex: 1 },
  ballFlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greenLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  greenValue: { fontSize: 14, fontWeight: '500' },
});
