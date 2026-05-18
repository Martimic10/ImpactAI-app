import React, { useEffect, useState } from 'react';
import { View, Image, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swing } from '@/types';
import {
  extractVideoThumbnailUri,
  getCachedSwingThumbnail,
} from '@/lib/thumbnails';
import { subscribeSwingDataUpdates } from '@/lib/swingDataUpdates';

export type ThumbnailSize = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<ThumbnailSize, { w: number; h: number; r: number; icon: number }> = {
  sm: { w: 52, h: 52, r: 12, icon: 18 },
  md: { w: 72, h: 72, r: 14, icon: 24 },
  lg: { w: 100, h: 68, r: 16, icon: 28 },
};

// In-memory cache: swingId → local thumb URI
const thumbCache: Record<string, string> = {};

interface SwingThumbnailProps {
  swing: Swing | null;
  size?: ThumbnailSize;
  fill?: boolean;
  active?: boolean;
  style?: ViewStyle;
}

export function SwingThumbnail({
  swing,
  size = 'md',
  fill = false,
  active = false,
  style,
}: SwingThumbnailProps) {
  const d = SIZE_MAP[size];

  const storedUrl = swing?.thumbnail_url ?? null;
  const cached =
    swing?.id ? thumbCache[swing.id] ?? getCachedSwingThumbnail(swing.id) : null;
  const [dynamicUrl, setDynamicUrl] = useState<string | null>(cached);

  const displayUrl = storedUrl ?? dynamicUrl;

  useEffect(() => {
    if (!swing?.id) return;
    if (storedUrl) return;

    const prefetched = thumbCache[swing.id] ?? getCachedSwingThumbnail(swing.id);
    if (prefetched) {
      setDynamicUrl(prefetched);
      return;
    }

    const videoUrl = swing.video_url;
    if (!videoUrl) return;

    let cancelled = false;
    extractVideoThumbnailUri(videoUrl, swing.id)
      .then((uri) => {
        if (cancelled || !uri) return;
        thumbCache[swing.id] = uri;
        setDynamicUrl(uri);
      })
      .catch((e: unknown) => {
        console.warn('[SwingThumbnail] thumbnail extraction failed for', swing.id, e);
      });

    return () => {
      cancelled = true;
    };
  }, [swing?.id, storedUrl, swing?.video_url]);

  useEffect(() => {
    if (!swing?.id || storedUrl) return undefined;
    return subscribeSwingDataUpdates(() => {
      const uri = thumbCache[swing.id] ?? getCachedSwingThumbnail(swing.id);
      if (uri) setDynamicUrl(uri);
    });
  }, [swing?.id, storedUrl]);

  const containerStyle: ViewStyle[] = [
    styles.wrap,
    fill ? StyleSheet.absoluteFill : { width: d.w, height: d.h, borderRadius: d.r },
    active ? styles.active : undefined,
    style,
  ].filter(Boolean) as ViewStyle[];

  const radius = fill ? 0 : d.r;

  return (
    <View style={containerStyle}>
      {displayUrl ? (
        <Image
          source={{ uri: displayUrl }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons
            name="videocam"
            size={fill ? 36 : d.icon}
            color={active ? '#4CAF50' : '#3A3A3A'}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  active: {
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
  },
});
