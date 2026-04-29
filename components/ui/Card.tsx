import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { useAppColors } from '@/lib/theme';

interface CardProps extends ViewProps {
  children: React.ReactNode;
  variant?: 'default' | 'green' | 'elevated';
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

export function Card({ children, variant = 'default', padding = 'md', style, ...props }: CardProps) {
  const colors = useAppColors();

  return (
    <View
      style={[
        styles.base,
        variant === 'default' && { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
        variant === 'green' && { backgroundColor: colors.surfaceSuccess, borderWidth: 1, borderColor: colors.success },
        variant === 'elevated' && {
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 4,
        },
        padding === 'sm' && styles.paddingSm,
        padding === 'md' && styles.paddingMd,
        padding === 'lg' && styles.paddingLg,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
  },
  paddingSm: { padding: 12 },
  paddingMd: { padding: 16 },
  paddingLg: { padding: 20 },
});
