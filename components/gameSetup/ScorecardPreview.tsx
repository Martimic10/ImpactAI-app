import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppColors } from '@/lib/theme';
import type { ActiveCourseScorecard } from '@/lib/golfCourse/types';
import { activeScorecardToRuntime, runtimeTotals } from '@/lib/golfCourse/runtimeScorecard';

const ACCENT = '#34E06F';
const CELL_W = 34;
const LABEL_W = 44;
const ROW_H = 24;

export function ScorecardPreview({
  scorecard,
  themeMode,
}: {
  scorecard: ActiveCourseScorecard;
  themeMode: 'light' | 'dark';
}) {
  const colors = useAppColors();
  const runtime = useMemo(() => activeScorecardToRuntime(scorecard), [scorecard]);
  const totals = useMemo(() => runtimeTotals(runtime), [runtime]);
  const showIn = runtime.holeCount > 9;

  const cardBg = themeMode === 'dark' ? 'rgba(28, 30, 28, 0.98)' : colors.surfaceAlt;

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>Scorecard preview</Text>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: colors.border }]}>
        <Text style={[styles.courseName, { color: colors.text }]} numberOfLines={2}>
          {runtime.courseName}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{runtime.metaLine}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gridScroll}>
          <View>
            <View style={styles.gridRow}>
              <View style={[styles.labelCell, { width: LABEL_W }]}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Hole</Text>
              </View>
              {runtime.holeNumbers.map((n) => (
                <View key={`h-${n}`} style={[styles.cell, { width: CELL_W }]}>
                  <Text style={[styles.cellTxt, { color: colors.text }]}>{n}</Text>
                </View>
              ))}
              {showIn ? (
                <>
                  <View style={[styles.cell, styles.totalCell]}>
                    <Text style={[styles.cellTxt, { color: ACCENT }]}>Out</Text>
                  </View>
                  <View style={[styles.cell, styles.totalCell]}>
                    <Text style={[styles.cellTxt, { color: ACCENT }]}>In</Text>
                  </View>
                </>
              ) : null}
              <View style={[styles.cell, styles.totalCell]}>
                <Text style={[styles.cellTxt, { color: ACCENT }]}>Tot</Text>
              </View>
            </View>

            {(
              [
                ['Par', runtime.holePar, totals.outPar, totals.inPar, totals.totalPar],
                ['Hcp', runtime.holeHandicap, null, null, null],
                ['Yds', runtime.holeYards, totals.outYds, totals.inYds, totals.totalYds],
              ] as const
            ).map(([label, values, out, inn, tot]) => (
              <View key={label} style={styles.gridRow}>
                <View style={[styles.labelCell, { width: LABEL_W }]}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
                </View>
                {values.map((v, i) => (
                  <View key={`${label}-${i}`} style={[styles.cell, { width: CELL_W, height: ROW_H }]}>
                    <Text
                      style={[
                        styles.cellTxt,
                        { color: label === 'Yds' ? colors.textSecondary : colors.text },
                        label === 'Yds' && styles.cellSm,
                      ]}
                    >
                      {v}
                    </Text>
                  </View>
                ))}
                {showIn && out != null ? (
                  <View style={[styles.cell, styles.totalCell, { height: ROW_H }]}>
                    <Text style={[styles.cellTxt, { color: colors.text }]}>{out}</Text>
                  </View>
                ) : null}
                {showIn && inn != null ? (
                  <View style={[styles.cell, styles.totalCell, { height: ROW_H }]}>
                    <Text style={[styles.cellTxt, { color: colors.text }]}>{inn}</Text>
                  </View>
                ) : null}
                {tot != null ? (
                  <View style={[styles.cell, styles.totalCell, { height: ROW_H }]}>
                    <Text style={[styles.cellTxtBold, { color: colors.text }]}>{tot}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', marginTop: 4 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: ACCENT,
    marginBottom: 10,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  courseName: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  meta: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  gridScroll: { marginTop: 4 },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  labelCell: { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 6 },
  label: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  cell: { justifyContent: 'center', alignItems: 'center' },
  totalCell: { width: 40 },
  cellTxt: { fontSize: 12, fontWeight: '700' },
  cellTxtBold: { fontSize: 12, fontWeight: '900' },
  cellSm: { fontSize: 10, fontWeight: '600' },
});
