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
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<OnboardingSlide>);

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  visual: React.ReactNode;
}

// Card scales with the screen so it lands with the same visual weight on
// every iPhone — bigger on Plus/Pro Max, sensibly smaller on SE. Shared
// across all three slides for a consistent product feel. Tuned so the
// content of slides 2 & 3 fills the frame without empty pockets.
const CARD_HEIGHT = Math.min(520, Math.max(400, height * 0.54));

// Slow synchronized pulse used by every "live" / "rec" dot in the deck.
// Defined as a hook so each slide can subscribe independently.
function useSlowPulse() {
  const pulse = useSharedValue(1);
  React.useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, []);
  return useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 0.85 + pulse.value * 0.25 }],
  }));
}

// ── Screen 1: Welcome — full-bleed photo ─────────────────────────────────────
//
// The hero card. Tall, glowing green border, frosted bottom badge with a
// pulsing dot. Corner brackets live on the recording screen now (they're a
// camera/AI-tracking signal, not a "welcome" signal).
function WelcomeVisual() {
  const pulseStyle = useSlowPulse();

  return (
    <View style={styles.visualContainer}>
      <View style={shared.cardShadow}>
        <View style={shared.card}>
          <Image
            source={require('@/assets/onboarding-screen-1.png')}
            style={v1.photo}
            resizeMode="cover"
          />

          {/* Bottom-up dark gradient so the badge reads cleanly over any
              photo. Stacked semi-opaque bands instead of a native lib. */}
          <View pointerEvents="none" style={shared.gradientStack}>
            <View style={[shared.gradBand, { opacity: 0.0 }]} />
            <View style={[shared.gradBand, { opacity: 0.15 }]} />
            <View style={[shared.gradBand, { opacity: 0.32 }]} />
            <View style={[shared.gradBand, { opacity: 0.55 }]} />
            <View style={[shared.gradBand, { opacity: 0.78, height: 70 }]} />
          </View>

          {/* Top-right "LIVE" chip */}
          <View style={shared.topChip}>
            <Animated.View style={[shared.topChipDot, pulseStyle]} />
            <Text style={shared.topChipText}>LIVE</Text>
          </View>

          {/* Bottom badge — frosted glass */}
          <View style={v1.badge}>
            <Animated.View style={[v1.badgeDot, pulseStyle]} />
            <Text style={v1.badgeText}>AI-Powered Swing Analysis</Text>
            <Ionicons name="sparkles" size={13} color="#A5D6A7" style={{ marginLeft: 4 }} />
          </View>
        </View>
      </View>
    </View>
  );
}

// Shared card frame styles used by all three slides.
const shared = StyleSheet.create({
  // Soft green-tinted outer glow.
  cardShadow: {
    width: width - 40,
    borderRadius: 32,
    shadowColor: '#4CAF50',
    shadowOpacity: 0.25,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  card: {
    width: '100%',
    height: CARD_HEIGHT,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(76,175,80,0.32)',
    backgroundColor: '#0A0A0A',
  },
  gradientStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 240,
    justifyContent: 'flex-end',
  },
  gradBand: {
    width: '100%',
    height: 40,
    backgroundColor: '#000000',
  },
  topChip: {
    position: 'absolute',
    top: 18,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  topChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  topChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.4,
  },
});

const v1 = StyleSheet.create({
  photo: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    bottom: 22,
    left: 22,
    right: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(10,16,12,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.45)',
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  badgeText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});

// ── Screen 2: Record / Camera Viewfinder ─────────────────────────────────────
//
// Looks like a real phone camera viewing the golfer. Corner brackets at all
// four corners — they belong here, not on the welcome screen. Pulsing REC
// chip up top, swing-arc tracking dots overlaid on a silhouette, and a
// record button + feature chips along the bottom in a frosted bar.
function RecordVisual() {
  const recPulse = useSlowPulse();

  return (
    <View style={styles.visualContainer}>
      <View style={shared.cardShadow}>
        <View style={shared.card}>
          {/* Viewfinder backdrop — subtle vertical fade from sky to ground */}
          <View style={v2.skyBand} />
          <View style={v2.midBand} />
          <View style={v2.groundBand} />

          {/* AI tracking corner brackets — moved here from screen 1 */}
          <View pointerEvents="none" style={v2.cornersWrap}>
            <View style={[v2.corner, v2.cornerTL]} />
            <View style={[v2.corner, v2.cornerTR]} />
            <View style={[v2.corner, v2.cornerBL]} />
            <View style={[v2.corner, v2.cornerBR]} />
          </View>

          {/* Flex content stack: REC row → scene (flex 1) → control bar.
              This guarantees the golfer is centered in the live area and the
              control bar always sits cleanly above the bottom brackets. */}
          <View style={v2.content}>
            {/* Top REC chip */}
            <View style={v2.topRow}>
              <View style={v2.recChip}>
                <Animated.View style={[v2.recDot, recPulse]} />
                <Text style={v2.recLabel}>REC</Text>
                <View style={v2.recDivider} />
                <Text style={v2.recTime}>0:04</Text>
              </View>
            </View>

            {/* Center scene — fills available space; golfer + arc dots
                positioned relative to a fixed-size inner canvas so the
                geometry stays the same on every device size. */}
            <View style={v2.scene}>
              <View style={v2.sceneInner}>
                <View style={v2.golfer}>
                  <View style={v2.golferHead} />
                  <View style={v2.golferTorso} />
                  <View style={v2.golferLegLeft} />
                  <View style={v2.golferLegRight} />
                  <View style={v2.golferArm} />
                  <View style={v2.golferClub} />
                </View>

                {/* Swing arc — 9 dots tracing the club path, centered on the
                    golfer's hand position (HAND_X, HAND_Y). */}
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
                  const HAND_X = 70;
                  const HAND_Y = 100;
                  const angle = -55 + i * 16;
                  const rad = (angle * Math.PI) / 180;
                  const r = 78;
                  return (
                    <View
                      key={i}
                      style={[
                        v2.arcDot,
                        {
                          left: HAND_X + r * Math.cos(rad) - 5,
                          top: HAND_Y - r * Math.sin(rad) - 5,
                          opacity: 0.25 + i * 0.085,
                        },
                      ]}
                    />
                  );
                })}

                {/* Pose landmark dots on the golfer */}
                <View style={[v2.poseDot, { left: 56, top: 18 }]} />
                <View style={[v2.poseDot, { left: 48, top: 48, backgroundColor: '#4CAF50' }]} />
                <View style={[v2.poseDot, { left: 68, top: 48, backgroundColor: '#4CAF50' }]} />
                <View style={[v2.poseDot, { left: 62, top: 94 }]} />
              </View>
            </View>

            {/* Bottom frosted control panel */}
            <View style={v2.bottomBar}>
              <View style={v2.chipRow}>
                <View style={v2.featureChip}>
                  <Ionicons name="scan-outline" size={11} color="#4CAF50" />
                  <Text style={v2.featureText}>Pose tracking</Text>
                </View>
                <View style={v2.featureChip}>
                  <Ionicons name="speedometer-outline" size={11} color="#FF9F0A" />
                  <Text style={[v2.featureText, { color: '#FF9F0A' }]}>Tempo</Text>
                </View>
              </View>

              <View style={v2.recordRow}>
                <View style={v2.recordBtnOuter}>
                  <View style={v2.recordBtnInner} />
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const v2 = StyleSheet.create({
  // Three-band sky → mid → ground gradient. Suggests outdoor without any
  // image asset.
  skyBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '38%',
    backgroundColor: '#0F1A24',
  },
  midBand: {
    position: 'absolute',
    top: '32%',
    left: 0,
    right: 0,
    height: '22%',
    backgroundColor: '#11231A',
    opacity: 0.85,
  },
  groundBand: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0A0A',
  },

  cornersWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: '#4CAF50',
    borderWidth: 2.2,
  },
  cornerTL: { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },

  content: {
    flex: 1,
    paddingTop: 22,
    paddingBottom: 22,
  },

  topRow: {
    alignItems: 'center',
  },

  recChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.45)',
  },
  recDot: { width: 8, height: 8, borderRadius: 5, backgroundColor: '#FF453A' },
  recLabel: { fontSize: 11, fontWeight: '800', color: '#FF453A', letterSpacing: 1.6 },
  recDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.18)' },
  recTime: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', fontVariant: ['tabular-nums'] },

  scene: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fixed-size canvas the golfer + dots are positioned within. Keeps the
  // composition identical across phones; flex spacing handles the rest.
  sceneInner: {
    width: 200,
    height: 180,
  },

  // Stylized golfer silhouette inside sceneInner.
  golfer: { position: 'absolute', left: 50, top: 14 },
  golferHead: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#A5D6A7',
    marginLeft: 10,
  },
  golferTorso: {
    width: 4,
    height: 40,
    backgroundColor: '#A5D6A7',
    marginLeft: 17,
    marginTop: 2,
    borderRadius: 2,
  },
  golferLegLeft: {
    position: 'absolute',
    width: 3,
    height: 32,
    backgroundColor: '#A5D6A7',
    top: 60,
    left: 14,
    transform: [{ rotate: '-7deg' }],
    borderRadius: 2,
  },
  golferLegRight: {
    position: 'absolute',
    width: 3,
    height: 32,
    backgroundColor: '#A5D6A7',
    top: 60,
    left: 21,
    transform: [{ rotate: '7deg' }],
    borderRadius: 2,
  },
  golferArm: {
    position: 'absolute',
    width: 3,
    height: 26,
    backgroundColor: '#A5D6A7',
    top: 24,
    left: 26,
    transform: [{ rotate: '35deg' }],
    borderRadius: 2,
  },
  golferClub: {
    position: 'absolute',
    width: 2,
    height: 56,
    backgroundColor: 'rgba(255,255,255,0.6)',
    top: 42,
    left: 38,
    transform: [{ rotate: '55deg' }],
    borderRadius: 1,
  },

  poseDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(76,175,80,0.85)',
  },

  arcDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },

  bottomBar: {
    marginHorizontal: 22,
    backgroundColor: 'rgba(10,12,10,0.78)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.25)',
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(30,32,30,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  featureText: { fontSize: 11, fontWeight: '700', color: '#4CAF50', letterSpacing: 0.2 },

  recordRow: {
    alignItems: 'center',
  },
  recordBtnOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnInner: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#FF453A',
  },
});

// ── Screen 3: Coaching — mirrors the real results screen ─────────────────────
//
// Inside the same premium card frame: score ring, AI summary, animated
// score bars, and a coach's-fix card. Reads like a real product screenshot.
const SCORES: Array<{ label: string; value: number; color: string }> = [
  { label: 'Setup',      value: 72, color: '#FFD23A' },
  { label: 'Posture',    value: 65, color: '#FFD23A' },
  { label: 'Swing Path', value: 42, color: '#FF453A' },
  { label: 'Tempo',      value: 81, color: '#4CAF50' },
  { label: 'Contact',    value: 51, color: '#FF453A' },
];

function CoachVisual() {
  const summaryPulse = useSlowPulse();

  return (
    <View style={styles.visualContainer}>
      <View style={shared.cardShadow}>
        <View style={[shared.card, v3.card]}>
          {/* Header row with score ring + AI summary */}
          <View style={v3.summaryRow}>
            <View style={v3.scoreRingOuter}>
              <View style={v3.scoreRing}>
                <Text style={v3.scoreNum}>63</Text>
                <Text style={v3.scoreLabel}>SCORE</Text>
              </View>
            </View>

            <View style={{ flex: 1, gap: 6 }}>
              <View style={v3.kickerRow}>
                <Animated.View style={[v3.kickerDot, summaryPulse]} />
                <Text style={v3.aiKicker}>AI SUMMARY</Text>
              </View>
              <Text style={v3.issueTitle}>Over-the-top swing path</Text>
              <Text style={v3.issueSub} numberOfLines={2}>
                Downswing starts with the shoulders before the hips clear,
                creating a pull-fade.
              </Text>
            </View>
          </View>

          {/* Score bars */}
          <View style={v3.scoresPanel}>
            {SCORES.map((s) => (
              <View key={s.label} style={v3.scoreRow}>
                <Text style={v3.rowLabel}>{s.label}</Text>
                <View style={v3.barTrack}>
                  <View
                    style={[
                      v3.barFill,
                      { width: `${s.value}%`, backgroundColor: s.color },
                    ]}
                  />
                </View>
                <Text style={[v3.rowValue, { color: s.color }]}>{s.value}</Text>
              </View>
            ))}
          </View>

          {/* Coach's fix card — flex 1 so it fills the bottom of the frame.
              Inner space-between pushes the drill chips to the bottom edge,
              avoiding the dead pocket the card used to have. */}
          <View style={v3.fixCard}>
            <View style={v3.fixTop}>
              <View style={v3.fixHeader}>
                <View style={v3.warnIcon}>
                  <Ionicons name="alert-circle" size={14} color="#FF9F0A" />
                </View>
                <Text style={v3.fixTitle} numberOfLines={1}>
                  Coach's Fix
                </Text>
                <View style={v3.highPill}>
                  <Text style={v3.highPillText}>HIGH</Text>
                </View>
              </View>
              <Text style={v3.fixDetail}>
                Start the downswing by bumping your lead hip toward the target
                before your shoulders unwind. Feel: belt buckle first.
              </Text>
            </View>

            <View style={v3.drillRow}>
              <View style={v3.drillChip}>
                <Ionicons name="repeat" size={11} color="#4CAF50" />
                <Text style={v3.drillText}>Hip-bump drill</Text>
              </View>
              <View style={v3.drillChip}>
                <Ionicons name="time-outline" size={11} color="#A5D6A7" />
                <Text style={v3.drillText}>10 reps · 3 sets</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const v3 = StyleSheet.create({
  card: {
    backgroundColor: '#0E0F0E',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F221F',
  },
  scoreRingOuter: {
    padding: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,210,58,0.12)',
  },
  scoreRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 5,
    borderColor: '#FFD23A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#141414',
  },
  scoreNum: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', lineHeight: 26 },
  scoreLabel: { color: '#8A98A3', fontSize: 9, letterSpacing: 1.2, fontWeight: '800', marginTop: 2 },

  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#B6FF2F',
  },
  aiKicker: { color: '#B6FF2F', fontSize: 10, fontWeight: '800', letterSpacing: 2 },

  issueTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  issueSub: { color: '#8A98A3', fontSize: 12, lineHeight: 17 },

  scoresPanel: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#1F221F',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { fontSize: 12, fontWeight: '700', color: '#FFFFFF', width: 76 },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#1F221F',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },
  rowValue: {
    fontSize: 13,
    fontWeight: '800',
    width: 26,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },

  fixCard: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 20,
    justifyContent: 'space-between',
  },
  fixTop: { gap: 10 },
  fixHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  warnIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#3C2A17',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.35)',
  },
  fixTitle: { flex: 1, color: '#F4F7FA', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  highPill: {
    borderWidth: 1,
    borderColor: '#FF453AAA',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  highPillText: { fontSize: 10, fontWeight: '800', color: '#FF453A', letterSpacing: 1 },
  fixDetail: { color: '#9DA8B0', fontSize: 12, lineHeight: 17 },

  drillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  drillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#152119',
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.32)',
  },
  drillText: { color: '#A5D6A7', fontSize: 11, fontWeight: '700' },
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
