import { Stack } from 'expo-router';
import { useAppColors } from '@/lib/theme';
import { stackScreenOptions } from '@/lib/navigation';

export default function AuthLayout() {
  const colors = useAppColors();

  return (
    <Stack screenOptions={stackScreenOptions(colors)}>
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
