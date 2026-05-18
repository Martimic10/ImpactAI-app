import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  Image,
  Pressable,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { usePreferences } from '@/hooks/usePreferences';
import { useFocusEffect } from 'expo-router';
import { getPlanLimits } from '@/lib/plans';
import { getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { encodeVideoUriForRoute } from '@/lib/analysisUri';
import { usePaywall } from '@/hooks/usePaywall';
import { DEV_MODE } from '@/lib/devMode';
import type { User, Swing } from '@/types';

const ACCENT = '#34E06F';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.35)';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const CARD_RADIUS = 22;
const H_PAD = 22;

function greetingForHour(date: Date) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstNameFromUser(user: User | null) {
  if (!user) return 'there';
  if (user.username?.length) {
    const parts = user.username.match(/[A-Z][a-z]+|[a-z]+/g);
    if (parts?.length) return parts[0].replace(/^\w/, (c) => c.toUpperCase());
    return user.username;
  }
  const local = user.email?.split('@')[0]?.replace(/[._]/g, ' ') ?? '';
  if (local.length) return local.split(' ')[0].replace(/^\w/, (c) => c.toUpperCase());
  return 'there';
}

function startOfDayMs(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function computePracticeStreak(swings: { created_at: string }[]) {
  if (swings.length === 0) return 0;
  const practiced = new Set(swings.map((s) => startOfDayMs(new Date(s.created_at))));
  const today = startOfDayMs(new Date());
  const yesterday = today - 86400000;
  let anchor = today;
  if (!practiced.has(today)) {
    if (!practiced.has(yesterday)) return 0;
    anchor = yesterday;
  }
  let streak = 0;
  let t = anchor;
  while (practiced.has(t)) {
    streak += 1;
    t -= 86400000;
  }
  return streak;
}

function swingsInLast7Days(swings: { created_at: string }[]) {
  const cutoff = Date.now() - 7 * 86400000;
  return swings.filter((s) => new Date(s.created_at).getTime() >= cutoff).length;
}

function progressTrend(swings: Swing[]) {
  if (swings.length < 2) return { label: '—', tone: 'neutral' as const };
  const latest = getSwingScore(swings[0].result_json);
  const older = getSwingScore(swings[Math.min(5, swings.length - 1)].result_json);
  const diff = latest - older;
  if (Math.abs(diff) < 2) return { label: 'Steady', tone: 'neutral' as const };
  if (diff > 0) return { label: `+${diff}`, tone: 'up' as const };
  return { label: `${diff}`, tone: 'down' as const };
}

function firstNameForHomeGreeting(user: User | null, prefsDisplayName: string) {
  const d = prefsDisplayName.trim();
  if (d.length > 0) {
    const first = d.split(/\s+/)[0];
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  return firstNameFromUser(user);
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function QuickActionChip({
  icon,
  line1,
  line2,
  onPress,
  surfaceColor,
  borderColor,
  labelColor,
}: {
  icon: IoniconName;
  line1: string;
  line2: string;
  onPress: () => void;
  surfaceColor: string;
  borderColor: string;
  labelColor: string;
}) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.94, { damping: 16, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 280 });
      }}
    >
      <Animated.View
        style={[
          styles.quickChip,
          { backgroundColor: surfaceColor, borderColor },
          anim,
        ]}
      >
        <View style={styles.quickIconWrap}>
          <Ionicons name={icon} size={22} color={ACCENT} />
        </View>
        <View style={styles.quickChipTextBlock}>
          <Text style={[styles.quickChipLine1, { color: labelColor }]} numberOfLines={1}>
            {line1}
          </Text>
          <Text
            style={[styles.quickChipLine2, { color: labelColor }]}
            numberOfLines={1}
          >
            {line2}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function AnalyzeIndexScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { swings, refetch } = useSwings(user?.id);
  const { prefs, reloadPrefs } = usePreferences();

  useFocusEffect(
    React.useCallback(() => {
      refetch();
      reloadPrefs();
    }, [refetch, reloadPrefs])
  );

  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const { isPro, openPaywall, Paywall } = usePaywall();
  const dailyLimit = getPlanLimits(user).swingsPerDay;
  const todaySwings = swings.filter((s) => {
    const d = new Date(s.created_at);
    return d.toDateString() === new Date().toDateString();
  }).length;
  const analysesLeft = Math.max(0, (dailyLimit === Infinity ? 99 : dailyLimit) - todaySwings);

  const streak = useMemo(() => computePracticeStreak(swings), [swings]);
  const weekCount = useMemo(() => swingsInLast7Days(swings), [swings]);
  const trend = useMemo(() => progressTrend(swings), [swings]);
  const latestSwing = swings[0] ?? null;

  const friendActivities: {
    id: string;
    name: string;
    initials: string;
    text: string;
    time: string;
  }[] = [];

  const coachTip = useMemo(() => {
    const drill = latestSwing?.result_json?.drill?.name;
    if (drill) return `Focus on ${drill.toLowerCase()} during your next practice session.`;
    return 'Focus on tempo drills during your next practice session.';
  }, [latestSwing]);

  function openCaptureModal() {
    if (!isPro && todaySwings >= dailyLimit) {
      openPaywall();
      return;
    }
    setShowCaptureModal(true);
  }

  function goAskCoach() {
    router.push('/(tabs)/coach');
  }

  function handleRecordFromModal() {
    setShowCaptureModal(false);
    router.push('/(tabs)/analyze/record');
  }

  async function handleUploadFromModal() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      allowsEditing: false,
    });

    setShowCaptureModal(false);

    if (result.canceled || !result.assets?.[0]) return;

    router.push({
      pathname: '/(tabs)/analyze/preview',
      params: { uri: encodeVideoUriForRoute(result.assets[0].uri) },
    });
  }

  const greetingName = useMemo(
    () => firstNameForHomeGreeting(user ?? null, prefs.displayName),
    [user, prefs.displayName],
  );

  const streakLine =
    streak > 0
      ? `${streak} day practice streak`
      : weekCount > 0
        ? 'Log a swing today to start a streak'
        : 'Upload a swing to begin tracking';

  const screenW = Dimensions.get('window').width;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        scrollEventThrottle={16}
      >
        {/* ── Header ── */}
        <View style={[styles.header, { paddingHorizontal: H_PAD }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>
              {greetingForHour(new Date())}, {greetingName}
            </Text>
            <Text style={[styles.streakSub, { color: colors.textMuted }]}>{streakLine}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.iconCircle, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              onPress={() => router.push('/(tabs)/friends')}
              activeOpacity={0.85}
              hitSlop={12}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.85} hitSlop={8}>
              <ProfileAvatar
                size="sm"
                imageUri={user?.avatar_url}
                initials={(user?.username ?? user?.email ?? '?').slice(0, 2).toUpperCase()}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Hero ── */}
        <View style={[styles.heroWrap, { paddingHorizontal: H_PAD }]}>
          <View
            style={[
              styles.heroCard,
              {
                borderColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : colors.border,
                backgroundColor: theme === 'dark' ? 'rgba(22, 24, 22, 0.96)' : colors.surface,
              },
            ]}
          >
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={[styles.heroGlowTL, { width: screenW * 0.45 }]} />
              <View style={styles.heroGlowBR} />
              <View style={styles.heroGrain} />
            </View>

            <View style={styles.heroTopRow}>
              <View style={styles.heroKickerRow}>
                <Ionicons name="sparkles" size={14} color={ACCENT} />
                <Text style={styles.heroKicker}>AI COACHING</Text>
              </View>
              <View style={[styles.heroFairway, { borderColor: ACCENT_SOFT }]}>
                <Ionicons name="golf" size={18} color={ACCENT} style={{ opacity: 0.9 }} />
              </View>
            </View>

            <Text style={[styles.heroTitle, { color: colors.text }]}>Analyze a swing</Text>
            <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
              Record or upload a clip for AI feedback and scoring.
            </Text>

            <TouchableOpacity style={styles.heroPrimaryBtn} onPress={openCaptureModal} activeOpacity={0.9}>
              <Ionicons name="add-circle-outline" size={22} color="#0A0A0A" />
              <Text style={styles.heroPrimaryText}>Record or upload</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!isPro && (
          <TouchableOpacity
            style={[styles.miniPlan, { marginHorizontal: H_PAD, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            onPress={openPaywall}
            activeOpacity={0.88}
          >
            <Text style={[styles.miniPlanText, { color: colors.textSecondary }]}>
              {analysesLeft} analyses left today · <Text style={{ color: ACCENT, fontWeight: '700' }}>Go Pro</Text>
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Snapshot ── */}
        <View style={[styles.snapshotRow, { paddingHorizontal: H_PAD }]}>
          <View style={[styles.snapshotCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.snapshotLabel, { color: colors.textMuted }]}>This week</Text>
            <Text style={[styles.snapshotValue, { color: colors.text }]}>{weekCount}</Text>
            <Text style={[styles.snapshotHint, { color: colors.textSecondary }]}>Swings</Text>
            <View style={[styles.snapshotAccent, { backgroundColor: ACCENT_SOFT }]} />
          </View>
          <View style={[styles.snapshotCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.snapshotLabel, { color: colors.textMuted }]}>Streak</Text>
            <Text style={[styles.snapshotValue, { color: colors.text }]}>{streak}</Text>
            <Text style={[styles.snapshotHint, { color: colors.textSecondary }]}>Days</Text>
            <View style={[styles.snapshotAccent, { backgroundColor: ACCENT_SOFT }]} />
          </View>
          <View style={[styles.snapshotCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.snapshotLabel, { color: colors.textMuted }]}>Trend</Text>
            <View style={styles.trendRow}>
              <Text
                style={[
                  styles.snapshotValue,
                  styles.trendValue,
                  {
                    color:
                      trend.tone === 'up' ? ACCENT : trend.tone === 'down' ? colors.danger : colors.text,
                  },
                ]}
              >
                {trend.label}
              </Text>
              {trend.tone === 'up' ? (
                <Ionicons name="trending-up" size={18} color={ACCENT} style={{ opacity: 0.85 }} />
              ) : trend.tone === 'down' ? (
                <Ionicons name="trending-down" size={18} color={colors.danger} style={{ opacity: 0.85 }} />
              ) : (
                <Ionicons name="remove-outline" size={18} color={colors.textMuted} />
              )}
            </View>
            <Text style={[styles.snapshotHint, { color: colors.textSecondary }]}>vs last swings</Text>
            <View style={[styles.snapshotAccent, { backgroundColor: ACCENT_SOFT }]} />
          </View>
        </View>

        {/* ── Friend activity ── */}
        <View style={[styles.sectionBlock, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Friend Activity</Text>
          {friendActivities.length === 0 ? (
            <View style={[styles.emptySocial, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.emptySocialText, { color: colors.textSecondary }]}>
                Connect with friends to see their practice updates here.
              </Text>
            </View>
          ) : (
            <View style={styles.friendList}>
              {friendActivities.map((item) => (
                <View
                  key={item.id}
                  style={[styles.friendRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                >
                  <ProfileAvatar size="sm" initials={item.initials} />
                  <View style={styles.friendMid}>
                    <Text style={[styles.friendName, { color: colors.text }]}>{item.name}</Text>
                    <Text style={[styles.friendAct, { color: colors.textSecondary }]} numberOfLines={2}>
                      {item.text}
                    </Text>
                  </View>
                  <Text style={[styles.friendTime, { color: colors.textMuted }]}>{item.time}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── Quick actions (upload + coach live in hero + tab bar) ── */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionTitle, { color: colors.text, paddingHorizontal: H_PAD }]}>Quick actions</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickScroll}
          >
            <QuickActionChip
              icon="stats-chart-outline"
              line1="View"
              line2="Progress"
              onPress={() => router.push('/(tabs)/progress')}
              surfaceColor={colors.surfaceAlt}
              borderColor={colors.border}
              labelColor={colors.text}
            />
            <QuickActionChip
              icon="flag-outline"
              line1="Games"
              line2="Social"
              onPress={() => router.push({ pathname: '/(tabs)/friends', params: { segment: 'games' } })}
              surfaceColor={colors.surfaceAlt}
              borderColor={colors.border}
              labelColor={colors.text}
            />
          </ScrollView>
        </View>

        {/* ── Coach tip ── */}
        <Pressable
          style={[styles.sectionBlock, { paddingHorizontal: H_PAD, paddingBottom: 110 }]}
          onPress={goAskCoach}
          accessibilityRole="button"
          accessibilityLabel="Open Coach tab to discuss this tip"
        >
          <View style={[styles.tipCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <View style={styles.tipGlow} />
            <View style={styles.tipHeader}>
              <Ionicons name="sparkles" size={16} color={ACCENT} />
              <Text style={[styles.tipKicker, { color: ACCENT }]}>Coach tip</Text>
            </View>
            <Text style={[styles.tipBody, { color: colors.text }]}>{coachTip}</Text>
            <View style={styles.tipFooterRow}>
              <Text style={[styles.tipFooterHint, { color: colors.textMuted }]}>Open Coach tab</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
          </View>
        </Pressable>
      </ScrollView>

      <Modal
        visible={showCaptureModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCaptureModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowCaptureModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={{ gap: 10 }}>
                  <View style={styles.dragHandle} />

                  <View style={styles.modalHeader}>
                    <TouchableOpacity
                      onPress={() => setShowCaptureModal(false)}
                      style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="close" size={18} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>New Swing</Text>
                    <View style={{ width: 40 }} />
                  </View>

                  <View
                    style={[
                      styles.modalHero,
                      {
                        backgroundColor: theme === 'dark' ? '#121A14' : '#E9F8EC',
                        borderColor: theme === 'dark' ? 'rgba(52,224,111,0.2)' : '#CFE8D6',
                      },
                    ]}
                  >
                    <Ionicons name="sparkles" size={16} color={ACCENT} />
                    <Text style={[styles.modalKicker, { color: ACCENT }]}>AI SWING ANALYSIS</Text>
                    <Text style={[styles.modalHeroTitle, { color: colors.text }]}>Choose how to capture your swing</Text>
                    <Text style={[styles.modalHeroSub, { color: colors.textSecondary }]}>
                      Film down-the-line or face-on for the best analysis.
                    </Text>
                  </View>

                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.modalActionRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                      onPress={handleRecordFromModal}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.modalActionIcon, { backgroundColor: ACCENT_SOFT }]}>
                        <Ionicons name="camera" size={20} color={ACCENT} />
                      </View>
                      <View style={styles.modalActionTextWrap}>
                        <Text style={[styles.modalActionTitle, { color: colors.text }]}>Record swing</Text>
                        <Text style={[styles.modalActionSub, { color: colors.textSecondary }]}>
                          Use your camera in real time
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modalActionRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                      onPress={handleUploadFromModal}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.modalActionIcon, { backgroundColor: ACCENT_SOFT }]}>
                        <Ionicons name="cloud-upload-outline" size={20} color={ACCENT} />
                      </View>
                      <View style={styles.modalActionTextWrap}>
                        <Text style={[styles.modalActionTitle, { color: colors.text }]}>Upload from gallery</Text>
                        <Text style={[styles.modalActionSub, { color: colors.textSecondary }]}>
                          Pick a clip from your phone
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.tipsCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <Text style={[styles.tipsTitle, { color: colors.text }]}>Filming tips</Text>
                    {[
                      'Frame your whole body in portrait',
                      'Stand 8–12 feet from the camera',
                      'Good lighting — avoid direct sun behind you',
                      'One clean swing per clip',
                    ].map((tip) => (
                      <View key={tip} style={styles.tipRow}>
                        <Ionicons name="checkmark-circle-outline" size={18} color={ACCENT} />
                        <Text style={[styles.tipText, { color: colors.textSecondary }]}>{tip}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      <Paywall />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 22,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greeting: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  streakSub: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    marginBottom: 14,
  },
  heroCard: {
    borderRadius: CARD_RADIUS + 4,
    borderWidth: 1,
    paddingVertical: 26,
    paddingHorizontal: 22,
    overflow: 'hidden',
    shadowColor: ACCENT_GLOW,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 8,
  },
  heroGlowTL: {
    position: 'absolute',
    top: -80,
    left: -60,
    height: 200,
    borderRadius: 100,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.2,
  },
  heroGlowBR: {
    position: 'absolute',
    bottom: -40,
    right: -30,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  heroGrain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heroKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: ACCENT,
  },
  heroFairway: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  heroSub: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: 22,
    maxWidth: '92%',
  },
  heroPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: ACCENT,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 4,
  },
  heroPrimaryText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: -0.2,
  },

  miniPlan: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 22,
  },
  miniPlanText: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },

  snapshotRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  snapshotCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  snapshotLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  snapshotValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendValue: {
    fontSize: 20,
  },
  snapshotHint: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  snapshotAccent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },

  sectionBlock: {
    marginBottom: 26,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  emptySocial: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  emptySocialText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  friendList: { gap: 10 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  friendMid: { flex: 1 },
  friendName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  friendAct: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  friendTime: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },

  quickScroll: {
    paddingHorizontal: H_PAD,
    gap: 12,
    paddingBottom: 4,
  },
  quickChip: {
    width: 132,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  quickIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickChipTextBlock: {
    width: '100%',
    alignItems: 'center',
    gap: 3,
    minHeight: 38,
  },
  quickChipLine1: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    width: '100%',
    letterSpacing: -0.35,
    lineHeight: 18,
  },
  quickChipLine2: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
    letterSpacing: -0.1,
    lineHeight: 16,
    opacity: 0.78,
  },

  tipCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
  },
  tipGlow: {
    position: 'absolute',
    top: -30,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.15,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  tipKicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  tipBody: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 12,
  },
  tipFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tipFooterHint: {
    fontSize: 13,
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A3A3A',
    alignSelf: 'center',
    marginBottom: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  modalHero: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 5,
  },
  modalKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  modalHeroTitle: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
    letterSpacing: -0.3,
  },
  modalHeroSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  modalActions: {
    gap: 8,
  },
  modalActionRow: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionTextWrap: { flex: 1 },
  modalActionTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  modalActionSub: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  tipsCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
});
