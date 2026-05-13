import * as LegacyFS from 'expo-file-system/legacy';
import { extractFramesFromVideo } from '@/lib/frames';

// Spread across a wider range so longer videos (5-8s) are covered
// Used only when backend is unavailable
const FRAME_TIMES_MS = [400, 1200, 2200, 3400, 5000];
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

// AI coaching only needs a handful of frames — more = bigger payload and
// no real improvement in coaching quality. Dense phase-detection frames
// go through a different code path in visualAnalysis.ts.
const COACHING_FRAME_COUNT = 8;

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
  return 'image/jpeg';
}

async function readBase64(uri: string): Promise<string> {
  return LegacyFS.readAsStringAsync(uri, { encoding: 'base64' });
}

async function extractFramesViaBackend(uri: string): Promise<string[]> {
  try {
    const frames = await extractFramesFromVideo(uri, {
      mode: 'analysis',
      frameCount: COACHING_FRAME_COUNT,
    });
    return frames.filter((f) => f && f.length > 0);
  } catch (e) {
    console.warn('[video] backend extraction threw:', e);
    return [];
  }
}

export async function extractFrames(uri: string): Promise<string[]> {
  const mime = detectMimeType(uri);
  const isImage = !mime.startsWith('video');

  // Images: read directly as base64
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

  // Videos: backend is strongly preferred for AI analysis.
  // It uses OpenCV to sample evenly across the actual video duration,
  // resizes to 640px max (vs full-res thumbnails), handles HEVC/MOV,
  // and produces ~50KB frames instead of ~270KB — far better for GPT-4o.
  if (BACKEND_URL) {
    const backendFrames = await extractFramesViaBackend(uri);
    if (backendFrames.length >= 2) {
      console.log(`[video] backend extracted ${backendFrames.length} frames`);
      return backendFrames;
    }
    console.warn('[video] backend returned insufficient frames, trying local');
  }

  // Local fallback — when backend is unavailable
  const VideoThumbnails = getVideoThumbnails();
  if (VideoThumbnails) {
    const frames: string[] = [];
    for (const timeMs of FRAME_TIMES_MS) {
      try {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
          time: timeMs,
          quality: 0.55,  // lower quality = smaller files, fewer refusals from AI
        });
        const base64 = await readBase64(thumbUri);
        frames.push(base64);
        if (frames.length >= 4) break;  // 4 good local frames is enough
      } catch {
        // timestamp past video end — normal for short videos, just skip
      }
    }
    console.log(`[video] local extracted ${frames.length} frames`);
    if (frames.length >= 2) return frames;
  }

  console.warn('[video] no frames extracted');
  return [];
}
