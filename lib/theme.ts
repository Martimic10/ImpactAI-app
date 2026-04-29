import { useTheme } from '@/hooks/useTheme';

export type AppColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceSuccess: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  icon: string;
  success: string;
  warning: string;
  danger: string;
  accent: string;
  accentText: string;
};

export const DARK_COLORS: AppColors = {
  background: '#0D0D0D',
  surface: '#161616',
  surfaceAlt: '#1A1A1A',
  surfaceSuccess: '#1B2E1B',
  border: '#2A2A2A',
  borderStrong: '#3A3A3A',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textMuted: '#666666',
  icon: '#888888',
  success: '#4CAF50',
  warning: '#FF9F0A',
  danger: '#FF453A',
  accent: '#B6FF2F',
  accentText: '#0D0D0D',
};

export const LIGHT_COLORS: AppColors = {
  background: '#F3F6F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F9FC',
  surfaceSuccess: '#EBF8EF',
  border: '#D6DEE7',
  borderStrong: '#BFCBD8',
  text: '#111B26',
  textSecondary: '#556270',
  textMuted: '#758292',
  icon: '#5E6B78',
  success: '#2E9E48',
  warning: '#C08A00',
  danger: '#D5362D',
  accent: '#B0F33A',
  accentText: '#111B26',
};

export function useAppColors() {
  const { theme } = useTheme();
  return theme === 'light' ? LIGHT_COLORS : DARK_COLORS;
}

