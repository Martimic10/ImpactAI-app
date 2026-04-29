import React, { useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

interface VideoPlayerProps {
  uri: string;
}

const SPEED_OPTIONS = [1, 0.5, 0.25] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

export function VideoPlayer({ uri }: VideoPlayerProps) {
  const [speed, setSpeed] = useState<Speed>(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.playbackRate = speed;
  });

  function togglePlay() {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setIsPlaying((p) => !p);
  }

  function setPlaybackSpeed(s: Speed) {
    setSpeed(s);
    player.playbackRate = s;
  }

  return (
    <View className="rounded-2xl overflow-hidden bg-black">
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
      />

      {/* Controls overlay */}
      <View className="px-4 py-3 bg-black/80 gap-3">
        {/* Play/Pause */}
        <TouchableOpacity
          onPress={togglePlay}
          className="items-center justify-center py-2"
        >
          <Text className="text-white text-2xl">{isPlaying ? '⏸' : '▶️'}</Text>
        </TouchableOpacity>

        {/* Speed controls */}
        <View className="flex-row items-center gap-2">
          <Text className="text-white/60 text-xs mr-1">Speed</Text>
          {SPEED_OPTIONS.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setPlaybackSpeed(s)}
              className="px-3 py-1.5 rounded-lg"
              style={{
                backgroundColor: speed === s ? '#2E7D32' : 'rgba(255,255,255,0.15)',
              }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: speed === s ? '#fff' : 'rgba(255,255,255,0.7)' }}
              >
                {s === 1 ? '1x' : `${s}x`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    height: 280,
  },
});
