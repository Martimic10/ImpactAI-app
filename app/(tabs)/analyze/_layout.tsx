import { Stack } from 'expo-router';
import { useAppColors } from '@/lib/theme';
import { stackPushOptions, stackScreenOptions } from '@/lib/navigation';

export default function AnalyzeLayout() {
  const colors = useAppColors();

  return (
    <Stack screenOptions={stackScreenOptions(colors)}>
      <Stack.Screen name="index" />
      <Stack.Screen name="record" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="preview" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="processing" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="results" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="swing/[id]" options={stackPushOptions(colors)} />
    </Stack>
  );
}
