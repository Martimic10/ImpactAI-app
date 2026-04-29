import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';

const BUCKET = 'swing-videos';

export async function uploadSwingVideo(
  localUri: string,
  userId: string,
  swingId: string
): Promise<string> {
  const ext = localUri.split('.').pop() ?? 'mp4';
  const path = `${userId}/${swingId}.${ext}`;

  const base64 = await new File(localUri).base64();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: `video/${ext}`, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
