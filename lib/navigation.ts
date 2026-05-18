import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { AppColors } from '@/lib/theme';

/** Shared stack options — themed background prevents white flashes during transitions. */
export function stackScreenOptions(colors: AppColors): NativeStackNavigationOptions {
  return {
    headerShown: false,
    animation: 'simple_push',
    contentStyle: { backgroundColor: colors.background },
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
  };
}

/** Push transitions within a tab (e.g. profile → settings). */
export function stackPushOptions(colors: AppColors): NativeStackNavigationOptions {
  return {
    ...stackScreenOptions(colors),
    animation: 'slide_from_right',
  };
}
