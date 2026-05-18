import { Stack } from 'expo-router';
import { useAppColors } from '@/lib/theme';
import { stackPushOptions, stackScreenOptions } from '@/lib/navigation';

export default function ProfileLayout() {
  const colors = useAppColors();

  return (
    <Stack screenOptions={stackScreenOptions(colors)}>
      <Stack.Screen name="index" />
      <Stack.Screen name="settings" options={stackPushOptions(colors)} />
    </Stack>
  );
}
