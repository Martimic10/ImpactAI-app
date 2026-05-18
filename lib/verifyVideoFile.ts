import * as LegacyFS from 'expo-file-system/legacy';

/** Ensures the picked/recording URI still exists before we spend time analyzing. */
export async function assertVideoFileReadable(uri: string): Promise<void> {
  if (!uri.trim()) {
    throw new Error('No video file was provided.');
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return;
  }

  try {
    const info = await LegacyFS.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error(
        'This video is no longer on your device (it may have been cleared). Please pick or record it again.',
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('no longer on your device')) {
      throw err;
    }
    console.warn('[verifyVideoFile] getInfoAsync failed, continuing:', err);
  }
}
