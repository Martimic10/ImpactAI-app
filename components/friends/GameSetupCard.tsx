import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '@/lib/theme';

const ACCENT = '#34E06F';

export type GameSetupRow = {
  key: string;
  label: string;
  value: string;
};

const DEFAULT_COURSE = 'Pebble Beach Golf Links';

export function GameSetupCard({
  themeMode,
  courseName = DEFAULT_COURSE,
  rows: rowsProp,
  onRowPress,
}: {
  themeMode: 'light' | 'dark';
  courseName?: string;
  rows?: GameSetupRow[];
  onRowPress: (label: string) => void;
}) {
  const colors = useAppColors();
  const chevronColor = themeMode === 'dark' ? 'rgba(52, 224, 111, 0.85)' : ACCENT;

  const rows = useMemo(
    () =>
      rowsProp ?? [
        { key: 'course', label: 'Course', value: courseName },
        { key: 'tee', label: 'Tees', value: 'White (6,374 yds)' },
        { key: 'holes', label: 'Holes', value: '18 Holes' },
      ],
    [rowsProp, courseName],
  );

  const cardBg = themeMode === 'dark' ? 'rgba(28, 30, 28, 0.98)' : colors.surfaceAlt;

  return (
    <View style={styles.root}>
      <Text style={styles.sectionKicker}>Game Setup</Text>
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            borderColor: themeMode === 'dark' ? 'rgba(255,255,255,0.06)' : colors.border,
          },
        ]}
      >
        {rows.map((row, i) => (
          <React.Fragment key={row.key}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              onPress={() => onRowPress(row.label)}
              style={({ pressed }) => [
                styles.rowOuter,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{row.label}</Text>
                  <Text style={[styles.value, { color: colors.text }]} numberOfLines={2}>
                    {row.value}
                  </Text>
                </View>
                <View style={styles.chevronWrap}>
                  <Ionicons name="chevron-forward" size={20} color={chevronColor} />
                </View>
              </View>
            </Pressable>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignSelf: 'stretch',
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: ACCENT,
  },
  card: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    overflow: 'hidden',
    alignSelf: 'stretch',
    width: '100%',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rowOuter: {
    width: '100%',
    alignSelf: 'stretch',
    paddingVertical: 16,
    paddingHorizontal: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'space-between',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
    marginBottom: 8,
  },
  value: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  chevronWrap: {
    marginLeft: 'auto',
    width: 28,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
