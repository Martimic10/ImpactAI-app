import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SetupSheet, SETUP_ACCENT } from '@/components/gameSetup/SetupSheet';
import { useAppColors } from '@/lib/theme';
import type { GameCourseSetup } from '@/hooks/useGameCourseSetup';
import { formatCourseLocation } from '@/lib/golfCourse/setup';
import type { CourseSearchResult } from '@/lib/golfCourse/types';

function CourseResultRow({
  item,
  onPress,
  colors,
}: {
  item: CourseSearchResult;
  onPress: () => void;
  colors: ReturnType<typeof useAppColors>;
}) {
  const loc = formatCourseLocation(item.city, item.state);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.resultRow,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? 'rgba(52,224,111,0.08)' : colors.surfaceAlt,
        },
      ]}
    >
      <View style={styles.resultIcon}>
        <Ionicons name="golf-outline" size={20} color={SETUP_ACCENT} />
      </View>
      <View style={styles.resultText}>
        <Text style={[styles.resultName, { color: colors.text }]} numberOfLines={2}>
          {item.name}
        </Text>
        {loc ? (
          <Text style={[styles.resultMeta, { color: colors.textSecondary }]} numberOfLines={1}>
            {loc}
          </Text>
        ) : null}
        <Text style={[styles.resultHoles, { color: colors.textMuted }]}>
          {item.holes ? `${item.holes} holes` : 'Course'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export function CourseSearchSheet({
  setup,
}: {
  setup: GameCourseSetup;
}) {
  const colors = useAppColors();
  const [draft, setDraft] = useState(setup.searchQuery);

  useEffect(() => {
    if (setup.activeSheet !== 'course') return;
    setDraft(setup.searchQuery);
  }, [setup.activeSheet, setup.searchQuery]);

  useEffect(() => {
    if (setup.activeSheet !== 'course') return undefined;
    const t = setTimeout(() => {
      void setup.runSearch(draft);
    }, 550);
    return () => clearTimeout(t);
  }, [draft, setup.activeSheet, setup.runSearch]);

  return (
    <SetupSheet
      visible={setup.activeSheet === 'course'}
      title="Select course"
      onClose={setup.closeSheet}
    >
      <View
        style={[
          styles.searchBox,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Search by course or club name"
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { color: colors.text }]}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => void setup.runSearch(draft)}
        />
        {setup.searchLoading ? <ActivityIndicator size="small" color={SETUP_ACCENT} /> : null}
      </View>

      {setup.searchLoading ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Searching courses… this can take a few seconds on Wi‑Fi.
        </Text>
      ) : setup.backendReachable === false ? (
        <Text style={[styles.hint, { color: '#FF9F43' }]}>
          Can’t reach your Mac backend. Keep dev_golf_server.py running and use your Mac IP in
          .env.local (not localhost).
        </Text>
      ) : setup.searchError ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{setup.searchError}</Text>
      ) : (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Search 30,000+ courses worldwide
        </Text>
      )}

      <FlatList
        data={setup.searchResults}
        keyExtractor={(item) => item.id}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !setup.searchLoading && draft.trim().length >= 2 ? (
            <View style={styles.empty}>
              <Ionicons name="map-outline" size={32} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No courses found</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Try a different spelling or nearby city.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                Type at least 2 characters to search
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <CourseResultRow
            item={item}
            colors={colors}
            onPress={() => void setup.selectCourse(item)}
          />
        )}
      />
    </SetupSheet>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '600', padding: 0 },
  hint: { fontSize: 12, fontWeight: '600', marginBottom: 10 },
  list: { maxHeight: 360 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(52,224,111,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  resultMeta: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  resultHoles: { fontSize: 11, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
