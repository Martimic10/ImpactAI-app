import * as LegacyFS from 'expo-file-system/legacy';

// Key swing moments: address, top of backswing, impact
const FRAME_TIMES_MS = [200, 1000, 2000];

function getVideoThumbnails() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-video-thumbnails');
    if (!mod?.getThumbnailAsync) return null;
    return mod;
  } catch {
    return null;
  }
}

function detectMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.m4v')) return 'video/mp4';
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.heic') || lower.includes('.heif')) return 'image/heic';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.webp')) return 'image/webp';
  // ph:// and other picker URIs without extension default to image
  return 'image/jpeg';
}

async function readBase64(uri: string): Promise<string> {
  // Use legacy API — reliable on both Expo Go and custom builds
  return LegacyFS.readAsStringAsync(uri, { encoding: 'base64' });
}

export async function extractFrames(uri: string): Promise<string[]> {
  const mime = detectMimeType(uri);
  const isImage = !mime.startsWith('video');

  if (isImage) {
    try {
      const base64 = await readBase64(uri);
      console.log('[video] image frame size (chars):', base64.length);
      return [base64];
    } catch (e) {
      console.warn('[video] failed to read image:', e);
      return [];
    }
  }

  const VideoThumbnails = getVideoThumbnails();
  if (!VideoThumbnails) {
    console.warn('[video] expo-video-thumbnails not linked — run `npx expo run:ios`');
    return [];
  }

  const frames: string[] = [];

  for (const timeMs of FRAME_TIMES_MS) {
    try {
      const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
        time: timeMs,
        quality: 0.7,
      });
      const base64 = await readBase64(thumbUri);
      frames.push(base64);
    } catch (e) {
      console.warn(`[video] frame at ${timeMs}ms failed:`, e);
    }
  }

  console.log(`[video] extracted ${frames.length}/${FRAME_TIMES_MS.length} frames`);
  return frames;
}
