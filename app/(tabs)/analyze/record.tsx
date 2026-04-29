import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';

export default function RecordScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [duration, setDuration] = useState(0);

  const recordingDot = useSharedValue(1);
  const dotStyle = useAnimatedStyle(() => ({ opacity: recordingDot.value }));

  useEffect(() => {
    if (isRecording) {
      recordingDot.value = withRepeat(withTiming(0.2, { duration: 600 }), -1, true);
      const interval = setInterval(() => setDuration((d) => d + 1), 1000);
      return () => clearInterval(interval);
    } else {
      recordingDot.value = 1;
      setDuration(0);
    }
  }, [isRecording]);

  if (!cameraPermission || !micPermission) {
    return <View className="flex-1 bg-black" />;
  }

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-6">
        <Text className="text-white text-xl font-bold mb-3">Camera Access Needed</Text>
        <Text className="text-white/70 text-center mb-6">
          ImpactAI needs camera and microphone access to record your swing.
        </Text>
        <TouchableOpacity
          onPress={async () => {
            await requestCameraPermission();
            await requestMicPermission();
          }}
          className="bg-[#2E7D32] px-8 py-4 rounded-2xl"
        >
          <Text className="text-white font-semibold text-base">Allow Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function startRecording() {
    if (!cameraRef.current) return;
    try {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (video) {
        router.push({
          pathname: '/(tabs)/analyze/preview',
          params: { uri: video.uri },
        });
      }
    } catch {
      Alert.alert('Error', 'Failed to record video. Please try again.');
    } finally {
      setIsRecording(false);
    }
  }

  async function stopRecording() {
    if (!cameraRef.current) return;
    cameraRef.current.stopRecording();
    setIsRecording(false);
  }

  function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="video"
      />

      {/* Guide overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Top overlay */}
        <View className="bg-black/50 px-6 pt-14 pb-4">
          <Text className="text-white text-center text-sm font-medium">
            Keep your full body and club in frame
          </Text>
        </View>

        {/* Guide lines */}
        <View className="flex-1 mx-12 my-8 border border-white/20 rounded-2xl" />

        {/* Bottom safe area */}
        <View className="bg-transparent h-48" />
      </View>

      {/* Controls */}
      <View className="absolute bottom-0 left-0 right-0 pb-10 pt-4 px-6 bg-black/60">
        {/* Duration */}
        {isRecording && (
          <View className="flex-row items-center justify-center mb-4 gap-2">
            <Animated.View style={dotStyle} className="w-3 h-3 rounded-full bg-red-500" />
            <Text className="text-white font-semibold text-base">
              {formatDuration(duration)}
            </Text>
          </View>
        )}

        <View className="flex-row items-center justify-between">
          {/* Back button */}
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-14 h-14 rounded-full bg-white/20 items-center justify-center"
          >
            <Text className="text-white text-lg">✕</Text>
          </TouchableOpacity>

          {/* Record button */}
          <TouchableOpacity
            onPress={isRecording ? stopRecording : startRecording}
            className="w-20 h-20 rounded-full items-center justify-center"
            style={{
              backgroundColor: isRecording ? '#D32F2F' : 'white',
              borderWidth: 4,
              borderColor: isRecording ? '#FF8A80' : 'rgba(255,255,255,0.4)',
            }}
          >
            {isRecording ? (
              <View className="w-6 h-6 rounded bg-white" />
            ) : (
              <View className="w-7 h-7 rounded-full bg-red-500" />
            )}
          </TouchableOpacity>

          {/* Flip camera */}
          <TouchableOpacity
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            className="w-14 h-14 rounded-full bg-white/20 items-center justify-center"
          >
            <Ionicons name="camera-reverse-outline" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <Text className="text-white/50 text-xs text-center mt-3">
          {isRecording ? 'Tap stop when done • Max 30 seconds' : 'Tap to start recording'}
        </Text>
      </View>
    </View>
  );
}
