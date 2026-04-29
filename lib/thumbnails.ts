import * as LegacyFS from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { Swing } from '@/types';

const BUCKET = 'swing-videos';

function getVideoThumbnails() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-video-thumbnails');
    if (typeof mod?.getThumbnailAsync !== 'function') {
      console.warn('[thumbnails] getThumbnailAsync not found on module');
      return null;
    }
    return mod;
  } catch (e) {
    console.warn('[thumbnails] expo-video-thumbnails not available:', e);
    return null;
  }
}

async function localUriForVideo(videoUri: string, swingId: string): Promise<string> {
  // Already a local file — use as-is
  if (!videoUri.startsWith('http')) return videoUri;

  // Download remote video to cache so VideoThumbnails can read it
  const dest = `${LegacyFS.cacheDirectory}thumb_src_${swingId}.mp4`;
  try {
    const { uri } = await LegacyFS.downloadAsync(videoUri, dest);
    return uri;
  } catch (e) {
    console.warn('[thumbnails] download failed, trying remote URL directly:', e);
    return videoUri;
  }
}

export async function generateAndUploadThumbnail(
  videoUri: string,
  userId: string,
  swingId: string
): Promise<string | null> {
  const VideoThumbnails = getVideoThumbnails();
  if (!VideoThumbnails) {
    console.warn('[thumbnails] VideoThumbnails unavailable — no thumbnail generated');
    return null;
  }

  try {
    const localUri = await localUriForVideo(videoUri, swingId);
    console.log('[thumbnails] extracting frame from:', localUri.slice(0, 80));

    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(localUri, {
      time: 1000,
      quality: 0.7,
    });
    console.log('[thumbnails] frame extracted:', thumbUri);

    const base64 = await LegacyFS.readAsStringAsync(thumbUri, { encoding: 'base64' });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const path = `${userId}/${swingId}_thumb.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      console.error('[thumbnails] storage upload error:', error.message);
      return null;
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log('[thumbnails] uploaded:', data.publicUrl);
    return data.publicUrl;
  } catch (e) {
    console.error('[thumbnails] generateAndUploadThumbnail failed:', e);
    return null;
  }
}

export function getSwingThumbnailUrl(swing: Swing | null): string | null {
  if (!swing) return null;
  return swing.thumbnail_url ?? null;
}
