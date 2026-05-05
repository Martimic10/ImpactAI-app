import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Dimensions,
  FlatList,
  StyleSheet,
  ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  useAnimatedScrollHandler,
} from 'react-native-reanimated';

const { width } = Dimensions.get('window');
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<OnboardingSlide>);

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  visual: React.ReactNode;
}

// ── Screen 1: Welcome — full-bleed photo ─────────────────────────────────────
function WelcomeVisual() {
  return (
    <View style={styles.visualContainer}>
      <View style={v1.card}>
        <Image
          source={require('@/assets/onboarding-screen-1.png')}
          style={v1.photo}
          resizeMode="cover"
        />
        {/* Bottom gradient badge */}
        <View style={v1.badge}>
          <View style={v1.badgeDot} />
          <Text style={v1.badgeText}>AI-Powered Swing Analysis</Text>
        </View>
      </View>
    </View>
  );
}

const v1 = StyleSheet.create({
  card: {
    width: width - 48,
    height: 320,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.35)',
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});

// ── Screen 2: Record / Camera Mockup ────────────────────────────────────────
function RecordVisual() {
  return (
    <View style={styles.visualContainer}>
      <View style={[styles.visualCard, { padding: 0, overflow: 'hidden' }]}>
        {/* Camera frame bg */}
        <View style={v2.cameraFrame}>
          {/* Corner brackets */}
          <View style={[v2.corner, v2.cornerTL]} />
          <View style={[v2.corner, v2.cornerTR]} />
          <View style={[v2.corner, v2.cornerBL]} />
          <View style={[v2.corner, v2.cornerBR]} />

          {/* REC badge */}
          <View style={v2.recBadge}>
            <View style={v2.recDot} />
            <Text style={v2.recText}>REC</Text>
            <Text style={v2.recTime}>0:04</Text>
          </View>

          {/* Swing path arc (fake overlay) */}
          <View style={v2.arcContainer}>
            {/* Stick-figure golfer */}
            <View style={v2.golferBody}>
              {/* Head */}
              <View style={v2.golferHead} />
              {/* Torso */}
              <View style={v2.golferTorso} />
              {/* Club line */}
              <View style={v2.clubLine} />
            </View>
            {/* Swing arc dots */}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const angle = -60 + i * 20;
              const rad = (angle * Math.PI) / 180;
              const r = 64;
              return (
                <View
                  key={i}
                  style={[
                    v2.arcDot,
                    {
                      left: 80 + r * Math.cos(rad) - 4,
                      top: 90 - r * Math.sin(rad) - 4,
                      opacity: 0.3 + i * 0.1,
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Bottom bar */}
          <View style={v2.bottomBar}>
            <View style={v2.featureChip}>
              <Ionicons name="scan-outline" size={12} color="#4CAF50" />
              <Text style={v2.featureText}>Pose tracking</Text>
            </View>
            <View style={v2.featureChip}>
              <Ionicons name="speedometer-outline" size={12} color="#FF9F0A" />
              <Text style={[v2.featureText, { color: '#FF9F0A' }]}>Tempo AI</Text>
            </View>
          </View>
        </View>

        {/* Record button row */}
        <View style={v2.recordRow}>
          <View style={v2.recordBtn}>
            <View style={v2.recordInner} />
          </View>
          <Text style={v2.recordHint}>Tap to stop</Text>
        </View>
      </View>
    </View>
  );
}

const v2 = StyleSheet.create({
  cameraFrame: {
    width: '100%',
    height: 200,
    backgroundColor: '#0A0A0A',
    position: 'relative',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#4CAF50',
    borderWidth: 2,
  },
  cornerTL: { top: 12, left: 12, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 12, right: 12, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 12, left: 12, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 12, right: 12, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  recBadge: {
    position: 'absolute',
    top: 14,
    left: '50%',
    transform: [{ translateX: -36 }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF453A' },
  recText: { fontSize: 11, fontWeight: '700', color: '#FF453A', letterSpacing: 1 },
  recTime: { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  arcContainer: { position: 'absolute', width: '100%', height: '100%' },
  golferBody: { position: 'absolute', left: 68, top: 30 },
  golferHead: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#4CAF5055', borderWidth: 1, borderColor: '#4CAF50',
  },
  golferTorso: {
    width: 2, height: 30,
    backgroundColor: '#4CAF5077',
    marginLeft: 6,
  },
  clubLine: {
    position: 'absolute',
    top: 14, left: 6,
    width: 2, height: 36,
    backgroundColor: '#4CAF5055',
    transform: [{ rotate: '30deg' }],
  },
  arcDot: {
    position: 'absolute',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  featureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(30,30,30,0.9)',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A',
  },
  featureText: { fontSize: 11, fontWeight: '600', color: '#4CAF50' },
  recordRow: {
    paddingVertical: 18,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#161616',
  },
  recordBtn: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 3, borderColor: '#FF453A',
    alignItems: 'center', justifyContent: 'center',
  },
  recordInner: {
    width: 20, height: 20, borderRadius: 4,
    backgroundColor: '#FF453A',
  },
  recordHint: { fontSize: 11, color: '#555555' },
});

// ── Screen 3: Coaching — mirrors the real results screen layout ───────────────
const SCORES = [
  { label: 'Setup',      value: 72, color: '#FFD23A' },
  { label: 'Posture',    value: 65, color: '#FFD23A' },
  { label: 'Swing Path', value: 42, color: '#FF453A' },
  { label: 'Tempo',      value: 81, color: '#4CAF50' },
  { label: 'Contact',    value: 51, color: '#FF453A' },
];

function CoachVisual() {
  return (
    <View style={styles.visualContainer}>
      <View style={[styles.visualCard, { padding: 0, gap: 0, overflow: 'hidden' }]}>

        {/* Score summary row — matches the real summaryCard */}
        <View style={v3.summaryRow}>
          <View style={v3.scoreRing}>
            <Text style={v3.scoreNum}>63</Text>
            <Text style={v3.scoreLabel}>SCORE</Text>
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={v3.aiKicker}>AI SUMMARY</Text>
            <Text style={v3.issueTitle}>Over-the-top swing path</Text>
            <Text style={v3.issueSub} numberOfLines={2}>
              Downswing starts with the shoulders before the hips clear, creating a pull-fade.
            </Text>
          </View>
        </View>

        {/* Score bars — matches real scoreRowItem */}
        <View style={v3.scoresPanel}>
          {SCORES.map((s) => (
            <View key={s.label} style={v3.scoreRow}>
              <Text style={v3.rowLabel}>{s.label}</Text>
              <View style={v3.barTrack}>
                <View style={[v3.barFill, { width: `${s.value}%`, backgroundColor: s.color }]} />
              </View>
              <Text style={[v3.rowValue, { color: s.color }]}>{s.value}</Text>
            </View>
          ))}
        </View>

        {/* Fix card — matches real panel + fixHeader */}
        <View style={v3.fixCard}>
          <View style={v3.fixHeader}>
            <View style={v3.warnIcon}>
              <Ionicons name="alert-circle-outline" size={12} color="#FF9F0A" />
            </View>
            <Text style={v3.fixTitle} numberOfLines={1}>Over-the-top swing path</Text>
            <View style={v3.highPill}>
              <Text style={v3.highPillText}>HIGH</Text>
            </View>
          </View>
          <Text style={v3.fixDetail}>
            Start the downswing by bumping your lead hip toward the target before your shoulders unwind.
          </Text>
        </View>

      </View>
    </View>
  );
}

const v3 = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#242424',
  },
  scoreRing: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 5, borderColor: '#FFD23A',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#141414',
  },
  scoreNum: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', lineHeight: 22 },
  scoreLabel: { color: '#8A98A3', fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  aiKicker: { color: '#B6FF2F', fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  issueTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: -0.2 },
  issueSub: { color: '#8A98A3', fontSize: 11, lineHeight: 15 },
  scoresPanel: { paddingHorizontal: 14, paddingVertical: 10, gap: 7, borderBottomWidth: 1, borderBottomColor: '#242424' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 11, fontWeight: '600', color: '#FFFFFF', width: 62 },
  barTrack: { flex: 1, height: 4, backgroundColor: '#2A2A2A', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  rowValue: { fontSize: 12, fontWeight: '800', width: 22, textAlign: 'right' },
  fixCard: { padding: 14, gap: 6 },
  fixHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warnIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#3C2A17', alignItems: 'center', justifyContent: 'center',
  },
  fixTitle: { flex: 1, color: '#F4F7FA', fontSize: 12, fontWeight: '700' },
  highPill: {
    borderWidth: 1, borderColor: '#FF453AAA', borderRadius: 14,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  highPillText: { fontSize: 10, fontWeight: '800', color: '#FF453A', letterSpacing: 1 },
  fixDetail: { color: '#9DA8B0', fontSize: 11, lineHeight: 16 },
});

// ── Slides data ──────────────────────────────────────────────────────────────
const SLIDES: OnboardingSlide[] = [
  {
    id: '1',
    title: 'Welcome to\nImpactAI',
    subtitle: 'Your AI golf coach. Instant swing analysis and personalized feedback to improve your game.',
    visual: <WelcomeVisual />,
  },
  {
    id: '2',
    title: 'Record or\nUpload Your Swing',
    subtitle: 'Film face-on or down-the-line. Our AI reads every frame and breaks down your technique in seconds.',
    visual: <RecordVisual />,
  },
  {
    id: '3',
    title: 'Get Coached.\nGet Better.',
    subtitle: 'Receive specific drills, feel cues, and track your improvement over time. Like having a coach in your pocket.',
    visual: <CoachVisual />,
  },
];

// ── Screen ───────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]) setActiveIndex(viewableItems[0].index ?? 0);
    }
  ).current;

  async function handleNext() {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      await AsyncStorage.setItem('hasSeenOnboarding', 'true');
      router.replace('/(auth)/login');
    }
  }

  async function handleSkip() {
    await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    router.replace('/(auth)/login');
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Skip */}
      <View style={styles.skipRow}>
        {activeIndex > 0 && (
          <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Slides */}
      <AnimatedFlatList
        ref={flatListRef as React.RefObject<FlatList<OnboardingSlide>>}
        data={SLIDES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={styles.visualArea}>
              {item.visual}
            </View>
            <View style={styles.textArea}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.subtitle}>{item.subtitle}</Text>
            </View>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => {
          const dotStyle = useAnimatedStyle(() => {
            const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
            const dotWidth = interpolate(scrollX.value, inputRange, [8, 24, 8], 'clamp');
            const opacity = interpolate(scrollX.value, inputRange, [0.4, 1, 0.4], 'clamp');
            return { width: dotWidth, opacity };
          });
          return <Animated.View key={i} style={[styles.dot, dotStyle]} />;
        })}
      </View>

      {/* CTA */}
      <View style={styles.ctaArea}>
        <TouchableOpacity onPress={handleNext} style={styles.nextBtn} activeOpacity={0.85}>
          <Text style={styles.nextText}>
            {activeIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  skipRow: {
    height: 60,
    paddingTop: 56,
    paddingHorizontal: 24,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  skipText: { color: '#8E8E93', fontSize: 16 },
  slide: {
    width,
    flex: 1,
    paddingHorizontal: 24,
  },
  visualArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visualContainer: {
    width: width - 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualCard: {
    width: '100%',
    backgroundColor: '#161616',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#282828',
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minHeight: 280,
  },
  textArea: { paddingBottom: 24, gap: 12 },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 16, color: '#8E8E93', lineHeight: 24 },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 20,
  },
  dot: { height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  ctaArea: { paddingHorizontal: 24, paddingBottom: 48 },
  nextBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 16,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
