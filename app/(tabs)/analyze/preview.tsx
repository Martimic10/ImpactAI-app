import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { decodeVideoUriFromRoute, encodeVideoUriForRoute } from '@/lib/analysisUri';

const { height: SCREEN_H } = Dimensions.get('window');
const GREEN = '#4CAF50';

const CLUBS = [
  'Driver', '3 Wood', '5 Wood', '4 Iron', '5 Iron', '6 Iron',
  '7 Iron', '8 Iron', '9 Iron', 'P Wedge', '52°', '54°', '56°', '58°', '60°',
];

const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|heic)$/i;

export default function PreviewScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const params = useLocalSearchParams<{ uri?: string | string[] }>();
  const uri = decodeVideoUriFromRoute(params.uri);
  const [club, setClub] = React.useState('Driver');
  const [isPlaying, setIsPlaying] = React.useState(true);

  const isImage = IMAGE_EXTS.test(uri ?? '');

  const player = useVideoPlayer(isImage ? null : (uri ?? null), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  function togglePlayPause() {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setIsPlaying((prev) => !prev);
  }

  if (!uri) {
    router.back();
    return null;
  }

  function handleAnalyze() {
    if (!uri) return;
    router.push({
      pathname: '/(tabs)/analyze/processing',
      params: { uri: encodeVideoUriForRoute(uri), club },
    });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* Header — fixed at top */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New Swing</Text>
        <View style={{ width: 42 }} />
      </View>

      {/* Scrollable body — video stays tall, club + buttons scroll into view */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        {/* Media preview */}
        <TouchableOpacity
          style={styles.mediaCard}
          onPress={isImage ? undefined : togglePlayPause}
          activeOpacity={1}
        >
          {isImage ? (
            <Image source={{ uri }} style={styles.media} resizeMode="cover" />
          ) : (
            <>
              <VideoView
                player={player}
                style={styles.media}
                contentFit="cover"
                nativeControls={false}
              />
              <View style={styles.playOverlay} pointerEvents="none">
                {!isPlaying && (
                  <View style={styles.playBtn}>
                    <Ionicons name="play" size={28} color="#FFFFFF" />
                  </View>
                )}
              </View>
            </>
          )}
        </TouchableOpacity>

        {/* Which club */}
        <Text style={[styles.clubPrompt, { color: colors.text }]}>Which club?</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.clubRow}
          style={styles.clubScroll}
        >
          {CLUBS.map((item) => {
            const active = club === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setClub(item)}
                style={[
                  styles.clubChip,
                  active
                    ? { backgroundColor: GREEN, borderColor: GREEN }
                    : { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                ]}
                activeOpacity={0.8}
              >
                <Text style={[styles.clubChipText, { color: active ? '#FFFFFF' : colors.textSecondary }]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.analyzeBtn} onPress={handleAnalyze} activeOpacity={0.88}>
            <Ionicons name="sparkles" size={18} color="#FFFFFF" />
            <Text style={styles.analyzeBtnText}>Analyze swing</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.secondaryBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            activeOpacity={0.85}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Choose different video</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
  },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2A',
    borderColor: '#3A3A3A',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },

  mediaCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
    height: SCREEN_H * 0.56,
    backgroundColor: '#1A1A1A',
    marginBottom: 24,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },

  clubPrompt: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
  },
  clubScroll: { flexGrow: 0, marginBottom: 12 },
  clubRow: {
    gap: 6,
    paddingHorizontal: 16,
    paddingRight: 24,
  },
  clubChip: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  clubChipText: {
    fontSize: 13,
    fontWeight: '600',
  },

  scrollContent: {
    paddingBottom: 36,
  },
  actions: {
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 4,
    paddingBottom: 28,
  },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GREEN,
    borderRadius: 16,
    height: 52,
  },
  analyzeBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  secondaryBtn: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
