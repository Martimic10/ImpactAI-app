import { Stack } from 'expo-router';

export default function AnalyzeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="record" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="preview" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="processing" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="results" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="swing/[id]" />
    </Stack>
  );
}
