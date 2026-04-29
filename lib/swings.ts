import { supabase } from '@/lib/supabase';
import { Swing } from '@/types';

export async function getSwingById(swingId: string): Promise<Swing | null> {
  const { data, error } = await supabase
    .from('swings')
    .select('*')
    .eq('id', swingId)
    .single();
  if (error) return null;
  return data as Swing;
}

export async function getUserSwings(userId: string): Promise<Swing[]> {
  const { data } = await supabase
    .from('swings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Swing[];
}

export async function saveSwingThumbnail(
  swingId: string,
  thumbnailUrl: string
): Promise<void> {
  const { error } = await supabase
    .from('swings')
    .update({ thumbnail_url: thumbnailUrl })
    .eq('id', swingId);
  if (error) {
    console.error('[swings] saveSwingThumbnail failed:', error.message, '— run migration to add thumbnail_url column');
  } else {
    console.log('[swings] thumbnail saved for swing', swingId);
  }
}

export async function updateSwingAnalysis(
  swingId: string,
  resultJson: object,
  currentVersion: number
): Promise<void> {
  await supabase
    .from('swings')
    .update({
      result_json: resultJson,
      status: 'completed',
      analysis_version: currentVersion + 1,
      last_analyzed_at: new Date().toISOString(),
    })
    .eq('id', swingId);
}
