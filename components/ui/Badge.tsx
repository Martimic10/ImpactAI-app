import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppColors } from '@/lib/theme';

type BadgeVariant = 'green' | 'gray' | 'yellow' | 'red';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'green' }: BadgeProps) {
  const colors = useAppColors();

  const variantStyles: Record<BadgeVariant, { bg: string; text: string }> = {
    green: { bg: colors.surfaceSuccess, text: colors.success },
    gray: { bg: colors.surfaceAlt, text: colors.textSecondary },
    yellow: { bg: 'rgba(255, 214, 10, 0.14)', text: colors.warning },
    red: { bg: 'rgba(255, 69, 58, 0.14)', text: colors.danger },
  };

  const { bg, text } = variantStyles[variant];
  return (
    <View style={[styles.container, { backgroundColor: bg }]}> 
      <Text style={[styles.label, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
