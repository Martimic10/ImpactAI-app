import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Swing } from '@/types';
import { DEV_MODE, MOCK_SWINGS } from '@/lib/devMode';
import { subscribeSwingDataUpdates } from '@/lib/swingDataUpdates';

export function useSwings(userId: string | undefined) {
  const [swings, setSwings] = useState<Swing[]>(() => (DEV_MODE ? MOCK_SWINGS : []));
  const [loading, setLoading] = useState(false);

  const fetchSwings = useCallback(async () => {
    if (DEV_MODE) {
      setSwings(MOCK_SWINGS);
      return;
    }
    if (!userId) {
      setSwings([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('swings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const dbSwings = ((data ?? []) as Swing[]).filter((s) => s.result_json != null);
    setSwings(dbSwings);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchSwings();
  }, [fetchSwings]);

  useEffect(() => {
    if (DEV_MODE) return undefined;
    return subscribeSwingDataUpdates(() => {
      void fetchSwings();
    });
  }, [fetchSwings]);

  async function saveSwing(
    videoUrl: string,
    resultJson: object,
    privacy: 'private' | 'friends' = 'private',
  ) {
    if (DEV_MODE) {
      const newSwing: Swing = {
        id: `swing-dev-${Date.now()}`,
        user_id: userId ?? 'dev-user-001',
        video_url: videoUrl,
        status: 'completed',
        result_json: resultJson as Swing['result_json'],
        privacy,
        created_at: new Date().toISOString(),
      };
      setSwings((prev) => [newSwing, ...prev]);
      return newSwing;
    }

    if (!userId) return null;
    const { data, error } = await supabase
      .from('swings')
      .insert({ user_id: userId, video_url: videoUrl, result_json: resultJson, privacy, status: 'completed' })
      .select()
      .single();

    if (error) throw error;
    await fetchSwings();
    return data as Swing;
  }

  async function deleteSwing(swingId: string) {
    if (DEV_MODE) {
      setSwings((prev) => prev.filter((s) => s.id !== swingId));
      return;
    }
    const { error } = await supabase.from('swings').delete().eq('id', swingId);
    if (error) throw error;
    setSwings((prev) => prev.filter((s) => s.id !== swingId));
  }

  return { swings, loading, saveSwing, deleteSwing, refetch: fetchSwings };
}

export function useFriendSwings(friendId: string | undefined) {
  const [swings, setSwings] = useState<Swing[]>(DEV_MODE ? MOCK_SWINGS.filter((s) => s.privacy === 'friends') : []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (DEV_MODE) return;

    if (!friendId) return;
    setLoading(true);
    supabase
      .from('swings')
      .select('*')
      .eq('user_id', friendId)
      .eq('privacy', 'friends')
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) setSwings(data as Swing[]);
        setLoading(false);
      });
  }, [friendId]);

  return { swings, loading };
}
