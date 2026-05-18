import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LiveGameScorecardScreen } from '@/components/friends/LiveGameScorecardScreen';
import { getSocialGameFullDetail } from '@/lib/socialGameDetails';
import { useAppColors } from '@/lib/theme';

export default function GameScorecardRoute() {
  const router = useRouter();
  const colors = useAppColors();
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  useEffect(() => {
    if (id && !getSocialGameFullDetail(id)) {
      router.replace({ pathname: '/(tabs)/friends', params: { segment: 'games' } });
    }
  }, [id, router]);

  if (!id) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  if (!getSocialGameFullDetail(id)) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return <LiveGameScorecardScreen gameId={id} />;
}
