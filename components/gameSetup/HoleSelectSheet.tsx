import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SetupSheet, SETUP_ACCENT } from '@/components/gameSetup/SetupSheet';
import { useAppColors } from '@/lib/theme';
import type { GameCourseSetup } from '@/hooks/useGameCourseSetup';
import { holeSelectionLabel, isHoleSelectionEnabled } from '@/lib/golfCourse/setup';
import type { HoleSelection } from '@/lib/golfCourse/types';

const OPTIONS: { key: HoleSelection; subtitle: string }[] = [
  { key: 'front9', subtitle: 'Holes 1–9' },
  { key: 'back9', subtitle: 'Holes 10–18' },
  { key: '18', subtitle: 'Full round' },
];

export function HoleSelectSheet({ setup }: { setup: GameCourseSetup }) {
  const colors = useAppColors();
  const tee = setup.setup.teeSet;

  return (
    <SetupSheet visible={setup.activeSheet === 'holes'} title="Holes to play" onClose={setup.closeSheet}>
      <View style={styles.options}>
        {OPTIONS.map((opt) => {
          const enabled = isHoleSelectionEnabled(tee, opt.key);
          const selected = setup.setup.holeSelection === opt.key;
          return (
            <Pressable
              key={opt.key}
              disabled={!enabled}
              onPress={() => setup.selectHoleSelection(opt.key)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: selected ? SETUP_ACCENT : colors.border,
                  backgroundColor: !enabled
                    ? 'rgba(128,128,128,0.12)'
                    : selected
                      ? 'rgba(52,224,111,0.12)'
                      : pressed
                        ? 'rgba(52,224,111,0.06)'
                        : colors.surfaceAlt,
                  opacity: enabled ? 1 : 0.45,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>
                  {holeSelectionLabel(opt.key)}
                </Text>
                <Text style={[styles.optionSub, { color: colors.textSecondary }]}>
                  {!enabled ? 'Not available for this tee' : opt.subtitle}
                </Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={22} color={SETUP_ACCENT} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {tee ? (
        <Text style={[styles.footer, { color: colors.textMuted }]}>
          {tee.holeCount} holes on scorecard · playing {setup.setup.selectedHoles.length}
        </Text>
      ) : null}
    </SetupSheet>
  );
}

const styles = StyleSheet.create({
  options: { gap: 10, paddingBottom: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 12,
  },
  optionTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  optionSub: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  footer: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 8 },
});
