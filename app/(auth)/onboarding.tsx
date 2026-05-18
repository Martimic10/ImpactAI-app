import React, { useRef, useState } from 'react';
import {
  View,
  Text,
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
import { SafeAreaView } from 'react-native-safe-area-context';

/** Aligns onboarding with Home / product: premium dark + electric green */
const ACCENT = '#34E06F';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.42)';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.14)';
const ACCENT_BORDER = 'rgba(52, 224, 111, 0.38)';
const BG = '#0A0A0A';
const SURFACE = '#121212';

const { width, height } = Dimensions.get('window');
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<OnboardingSlide>);

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  visual: React.ReactNode;
}

// Card height / width: compact so titles + CTA have room; still readable on SE.
const VISUAL_CARD_WIDTH = width - 56;
const CARD_HEIGHT = Math.min(360, Math.max(252, height * 0.34));

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

// ── Screen 1: Home hub — built in code (no raster) ───────────────────────────
//
// Matches today’s app IA: streak snapshot, tab strip with elevated Upload,
// quick actions row, and a Social teaser. Scales cleanly on every phone size.
function HomeHubVisual() {
  const pulseStyle = useSlowPulse();

  return (
    <View style={styles.visualContainer}>
      <View style={shared.cardShadow}>
        <View style={[shared.card, hub.cardBg]}>
          <View pointerEvents="none" style={hub.glowBlob} />

          <View style={hub.pad}>
            <View style={hub.rowBetween}>
              <Text style={hub.brand}>IMPACTAI</Text>
              <View style={hub.notif}>
                <Animated.View style={[hub.notifDot, pulseStyle]} />
              </View>
            </View>

            <Text style={hub.greetSm}>Your hub</Text>
            <Text style={hub.greetLg}>Home</Text>

            <View style={hub.streakCard}>
              <Ionicons name="flame" size={18} color={ACCENT} />
              <View style={{ flex: 1 }}>
                <Text style={hub.streakLabel}>Practice streak</Text>
                <Text style={hub.streakValue}>7 days</Text>
              </View>
              <View style={hub.streakRing}>
                <Text style={hub.streakNum}>7</Text>
              </View>
            </View>

            <View style={hub.chromeCard}>
              <Text style={hub.chromeLabel}>Navigation</Text>
              <View style={hub.fakeTabBar}>
                <Ionicons name="home" size={16} color={ACCENT} />
                <Ionicons name="chatbubble-ellipses-outline" size={15} color="rgba(255,255,255,0.32)" />
                <View style={hub.uploadFab}>
                  <Ionicons name="add" size={22} color="#0A0A0A" />
                </View>
                <Ionicons name="people-outline" size={16} color="rgba(255,255,255,0.32)" />
                <Ionicons name="person-outline" size={16} color="rgba(255,255,255,0.32)" />
              </View>
            </View>

            <Text style={hub.sectionKicker}>Quick snapshot</Text>
            <View style={hub.miniActions}>
              <View style={hub.miniChip}>
                <Ionicons name="cloud-upload-outline" size={16} color={ACCENT} />
                <Text style={hub.miniChipTxt}>Upload</Text>
              </View>
              <View style={hub.miniChip}>
                <Ionicons name="sparkles" size={16} color={ACCENT} />
                <Text style={hub.miniChipTxt}>Coach</Text>
              </View>
              <View style={hub.miniChip}>
                <Ionicons name="trophy-outline" size={16} color={ACCENT} />
                <Text style={hub.miniChipTxt}>Social</Text>
              </View>
            </View>
          </View>

          <View style={shared.topChip}>
            <Animated.View style={[shared.topChipDot, pulseStyle]} />
            <Text style={shared.topChipText}>LIVE</Text>
          </View>

          <View style={hub.bottomBadge}>
            <Ionicons name="layers-outline" size={15} color={ACCENT} />
            <Text style={hub.bottomBadgeTxt} numberOfLines={2}>
              Home · Coach · Upload · Social — one focused surface
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// Shared card frame styles used by all three slides.
const shared = StyleSheet.create({
  cardShadow: {
    width: VISUAL_CARD_WIDTH,
    borderRadius: 22,
    shadowColor: ACCENT_GLOW,
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  card: {
    width: '100%',
    height: CARD_HEIGHT,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    backgroundColor: SURFACE,
  },
  topChip: {
    position: 'absolute',
    top: 12,
    right: 12,
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
    backgroundColor: ACCENT,
  },
  topChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.6,
  },
});

const hub = StyleSheet.create({
  cardBg: {
    backgroundColor: SURFACE,
  },
  glowBlob: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: ACCENT_SOFT,
    top: -85,
    right: -65,
    opacity: 0.8,
  },
  pad: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 68,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 2.4,
  },
  notif: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  greetSm: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    marginTop: 8,
  },
  greetLg: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.7,
    marginBottom: 10,
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(14,16,14,0.92)',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    marginBottom: 8,
  },
  streakLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.42)',
  },
  streakValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    marginTop: 1,
  },
  streakRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161616',
  },
  streakNum: {
    fontSize: 15,
    fontWeight: '800',
    color: ACCENT,
  },
  chromeCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(8,8,8,0.72)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    gap: 6,
  },
  chromeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.32)',
    letterSpacing: 1.4,
  },
  fakeTabBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  uploadFab: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    borderWidth: 2,
    borderColor: SURFACE,
    shadowColor: ACCENT,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sectionKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.32)',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  miniActions: {
    flexDirection: 'row',
    gap: 6,
  },
  miniChip: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(52,224,111,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.24)',
  },
  miniChipTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: -0.15,
  },
  bottomBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(12, 14, 12, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  bottomBadgeTxt: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.02,
    lineHeight: 17,
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
                <View style={[v2.poseDot, { left: 48, top: 48, backgroundColor: ACCENT }]} />
                <View style={[v2.poseDot, { left: 68, top: 48, backgroundColor: ACCENT }]} />
                <View style={[v2.poseDot, { left: 62, top: 94 }]} />
              </View>
            </View>

            {/* Bottom frosted control panel */}
            <View style={v2.bottomBar}>
              <View style={v2.chipRow}>
                <View style={v2.featureChip}>
                  <Ionicons name="scan-outline" size={11} color={ACCENT} />
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
    backgroundColor: '#0C1418',
  },
  midBand: {
    position: 'absolute',
    top: '32%',
    left: 0,
    right: 0,
    height: '22%',
    backgroundColor: '#0F1A12',
    opacity: 0.9,
  },
  groundBand: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
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
    borderColor: ACCENT,
    borderWidth: 2,
    opacity: 0.9,
  },
  cornerTL: { top: 12, left: 12, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: 12, right: 12, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: 12, left: 12, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 12, right: 12, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },

  content: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 14,
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
    backgroundColor: 'rgba(255,255,255,0.38)',
    marginLeft: 10,
  },
  golferTorso: {
    width: 4,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.32)',
    marginLeft: 17,
    marginTop: 2,
    borderRadius: 2,
  },
  golferLegLeft: {
    position: 'absolute',
    width: 3,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.28)',
    top: 60,
    left: 14,
    transform: [{ rotate: '-7deg' }],
    borderRadius: 2,
  },
  golferLegRight: {
    position: 'absolute',
    width: 3,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.28)',
    top: 60,
    left: 21,
    transform: [{ rotate: '7deg' }],
    borderRadius: 2,
  },
  golferArm: {
    position: 'absolute',
    width: 3,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.32)',
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
    borderColor: ACCENT,
  },

  arcDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },

  bottomBar: {
    marginHorizontal: 14,
    backgroundColor: 'rgba(14, 14, 14, 0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(52, 224, 111, 0.22)',
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
    gap: 8,
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
    backgroundColor: 'rgba(26, 28, 26, 0.96)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  featureText: { fontSize: 11, fontWeight: '700', color: ACCENT, letterSpacing: 0.15 },

  recordRow: {
    alignItems: 'center',
  },
  recordBtnOuter: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnInner: {
    width: 18,
    height: 18,
    borderRadius: 5,
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
  { label: 'Tempo',      value: 81, color: ACCENT },
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
                <Ionicons name="repeat" size={11} color={ACCENT} />
                <Text style={v3.drillText}>Hip-bump drill</Text>
              </View>
              <View style={v3.drillChip}>
                <Ionicons name="time-outline" size={11} color={ACCENT} style={{ opacity: 0.75 }} />
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
    backgroundColor: SURFACE,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  scoreRingOuter: {
    padding: 2,
    borderRadius: 999,
    backgroundColor: ACCENT_SOFT,
  },
  scoreRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161616',
  },
  scoreNum: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', lineHeight: 22 },
  scoreLabel: { color: '#8E8E93', fontSize: 9, letterSpacing: 1.2, fontWeight: '800', marginTop: 2 },

  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT,
  },
  aiKicker: { color: ACCENT, fontSize: 10, fontWeight: '800', letterSpacing: 2 },

  issueTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: -0.3 },
  issueSub: { color: '#8E8E93', fontSize: 11, lineHeight: 15 },

  scoresPanel: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', width: 68 },
  barTrack: {
    flex: 1,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    justifyContent: 'space-between',
  },
  fixTop: { gap: 8 },
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
  fixTitle: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.15 },
  highPill: {
    borderWidth: 1,
    borderColor: '#FF453AAA',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  highPillText: { fontSize: 10, fontWeight: '800', color: '#FF453A', letterSpacing: 1 },
  fixDetail: { color: '#8E8E93', fontSize: 11, lineHeight: 15 },

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
    backgroundColor: 'rgba(52, 224, 111, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(52, 224, 111, 0.28)',
  },
  drillText: { color: 'rgba(255,255,255,0.88)', fontSize: 10, fontWeight: '700' },
});

// ── Slides data ──────────────────────────────────────────────────────────────
const SLIDES: OnboardingSlide[] = [
  {
    id: '1',
    title: 'ImpactAI\nstarts on Home',
    subtitle:
      'Home is your hub: streaks, clear next steps, and light social context. Upload when you are ready—the AI takes it from there.',
    visual: <HomeHubVisual />,
  },
  {
    id: '2',
    title: 'Upload is\nalways one tap away',
    subtitle:
      'Use the Upload tab (or Home) to record live or pick a clip. Film face-on or down-the-line and our AI breaks down every frame.',
    visual: <RecordVisual />,
  },
  {
    id: '3',
    title: 'Coach turns swings\ninto a plan',
    subtitle:
      'Trends and drills live under Coach. See how friends are practicing on Social, then tune your account in Profile.',
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* Skip */}
      <View style={styles.skipRow}>
        {activeIndex > 0 && (
          <TouchableOpacity onPress={handleSkip} style={styles.skipBtn} hitSlop={12}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  skipRow: {
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 8,
    minHeight: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  skipText: { color: 'rgba(255,255,255,0.45)', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  slide: {
    width,
    flex: 1,
    paddingHorizontal: 22,
  },
  visualArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visualContainer: {
    width: VISUAL_CARD_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textArea: { paddingBottom: 20, gap: 10, paddingTop: 4 },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 38,
    letterSpacing: -0.65,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    lineHeight: 24,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    paddingBottom: 16,
  },
  dot: { height: 8, borderRadius: 4, backgroundColor: ACCENT },
  ctaArea: { paddingHorizontal: 22, paddingBottom: 12 },
  nextBtn: {
    backgroundColor: ACCENT,
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT_GLOW,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  nextText: {
    color: '#0A0A0A',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
