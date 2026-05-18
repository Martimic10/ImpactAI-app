import { Stack } from 'expo-router';
import { useAppColors } from '@/lib/theme';
import { stackPushOptions, stackScreenOptions } from '@/lib/navigation';

export default function FriendsLayout() {
  const colors = useAppColors();

  return (
    <Stack screenOptions={stackScreenOptions(colors)}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={stackPushOptions(colors)} />
      <Stack.Screen name="game/[id]" options={stackPushOptions(colors)} />
      <Stack.Screen name="game-scorecard/[id]" options={stackPushOptions(colors)} />
    </Stack>
  );
}
