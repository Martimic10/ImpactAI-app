import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Swing, getSwingScore } from '@/types';
import { useAppColors } from '@/lib/theme';

interface TrendInsightProps {
  swings: Swing[];
}

function computeTrends(swings: Swing[]): string[] {
  if (swings.length < 2) return [];

  const insights: string[] = [];
  const recent = swings.slice(0, 3);
  const older = swings.slice(3, 6);

  if (older.length > 0) {
    const recentAvg = recent.reduce((s, sw) => s + getSwingScore(sw.result_json), 0) / recent.length;
    const olderAvg = older.reduce((s, sw) => s + getSwingScore(sw.result_json), 0) / older.length;
    if (recentAvg > olderAvg + 0.5) insights.push('Consistency increasing 📈');
    else if (recentAvg < olderAvg - 5) insights.push('Focus needed — confidence dropping');
  }

  const recentIssues = recent.map((s) => s.result_json.primaryIssue.toLowerCase());
  if (new Set(recentIssues).size === 1) {
    insights.push(`Working on: ${recent[0].result_json.primaryIssue}`);
  }

  const ballFlights = swings.slice(0, 5).map((s) => s.result_json.ballFlightPrediction.toLowerCase());
  const sliceCount = ballFlights.filter((b) => b.includes('slice') || b.includes('fade')).length;
  const drawCount = ballFlights.filter((b) => b.includes('draw') || b.includes('hook')).length;

  if (sliceCount >= 3 && drawCount < sliceCount) insights.push('Slice tendency detected — work on path 🎯');
  else if (drawCount >= 3) insights.push('Draw bias showing — check face angle');

  if (swings.length >= 5) insights.push(`${swings.length} swings analyzed total 🏌️`);

  return insights.slice(0, 3);
}

export function TrendInsight({ swings }: TrendInsightProps) {
  const colors = useAppColors();
  const trends = computeTrends(swings);
  if (trends.length === 0) return null;

  return (
    <View style={styles.container}>
      {trends.map((insight, i) => (
        <View key={i} style={[styles.row, { backgroundColor: colors.surfaceSuccess, borderColor: colors.success + '66' }]}> 
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.text, { color: colors.text }]}>{insight}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 13, fontWeight: '500', flex: 1 },
});
