import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SetupSheet, SETUP_ACCENT } from '@/components/gameSetup/SetupSheet';
import { useAppColors } from '@/lib/theme';
import type { GameCourseSetup } from '@/hooks/useGameCourseSetup';
import { formatTeeRowValue } from '@/lib/golfCourse/setup';
import type { TeeSet } from '@/lib/golfCourse/types';

export function TeeSelectSheet({ setup }: { setup: GameCourseSetup }) {
  const colors = useAppColors();
  const tees = setup.setup.course?.teeSets ?? [];
  const selectedId = setup.setup.teeSet?.id;

  return (
    <SetupSheet visible={setup.activeSheet === 'tee'} title="Select tees" onClose={setup.closeSheet}>
      {tees.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No tee data</Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            This course does not have tee boxes yet. Try another course.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tees}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <TeeRow
              tee={item}
              selected={item.id === selectedId}
              colors={colors}
              onPress={() => setup.selectTee(item)}
            />
          )}
        />
      )}
    </SetupSheet>
  );
}

function TeeRow({
  tee,
  selected,
  colors,
  onPress,
}: {
  tee: TeeSet;
  selected: boolean;
  colors: ReturnType<typeof useAppColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: selected ? SETUP_ACCENT : colors.border,
          backgroundColor: selected
            ? 'rgba(52,224,111,0.12)'
            : pressed
              ? 'rgba(52,224,111,0.06)'
              : colors.surfaceAlt,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: teeColor(tee.name) }]} />
      <View style={styles.textCol}>
        <Text style={[styles.name, { color: colors.text }]}>{tee.name}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={2}>
          {formatTeeRowValue(tee)}
        </Text>
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={22} color={SETUP_ACCENT} /> : null}
    </Pressable>
  );
}

function teeColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('black')) return '#1A1A1A';
  if (n.includes('blue')) return '#4A9EFF';
  if (n.includes('white')) return '#E8E8E8';
  if (n.includes('gold') || n.includes('yellow')) return '#FFCC00';
  if (n.includes('red')) return '#FF453A';
  return SETUP_ACCENT;
}

const styles = StyleSheet.create({
  list: { maxHeight: 400 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  textCol: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 4, lineHeight: 18 },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
