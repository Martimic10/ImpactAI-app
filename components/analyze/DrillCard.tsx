import React from 'react';
import { View, Text } from 'react-native';
import { SwingResult } from '@/types';
import { useAppColors } from '@/lib/theme';

interface DrillCardProps {
  drill: SwingResult['drill'];
}

export function DrillCard({ drill }: DrillCardProps) {
  const colors = useAppColors();

  return (
    <View
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: colors.surfaceSuccess, borderColor: colors.success, borderWidth: 1 }}
    >
      <View className="px-5 pt-5 pb-3">
        <View className="flex-row items-center gap-2 mb-1">
          <Text className="text-lg">🎯</Text>
          <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.textSecondary }}>
            Recommended Drill
          </Text>
        </View>
        <Text className="text-lg font-bold" style={{ color: colors.text }}>{drill.name}</Text>
      </View>

      <View className="mx-4 rounded-xl p-4 mb-3" style={{ backgroundColor: colors.surfaceAlt }}>
        <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: colors.textSecondary }}>Why this drill</Text>
        <Text className="text-sm leading-5" style={{ color: colors.text }}>{drill.whyThisDrill}</Text>
      </View>

      <View className="mx-4 mb-5">
        <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: colors.textSecondary }}>Steps</Text>
        {drill.steps.map((step, i) => (
          <View key={i} className="flex-row items-start gap-2 mb-1">
            <Text style={{ color: colors.success, fontWeight: '700' }}>{i + 1}.</Text>
            <Text className="text-sm leading-5 flex-1" style={{ color: colors.text }}>{step}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
