import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { usePreferences } from '@/hooks/usePreferences';
import {
  type GoalFocus,
  formatHandicapDisplay,
  isValidHandicapInput,
} from '@/lib/preferences';
import { hasProAccess, isAdmin, isFounder, getPlanLimits } from '@/lib/plans';
import { usePaywall } from '@/hooks/usePaywall';
import { DEV_MODE } from '@/lib/devMode';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Swing, getSwingScore } from '@/types';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.14)';
const H_PAD = 20;
const { width: SCREEN_W } = Dimensions.get('window');

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

function progressTrend(swings: Swing[]) {
  if (swings.length < 2) return { label: 'Steady', tone: 'neutral' as const };
  const latest = getSwingScore(swings[0].result_json);
  const older = getSwingScore(swings[Math.min(5, swings.length - 1)].result_json);
  const diff = latest - older;
  if (Math.abs(diff) < 2) return { label: 'Steady', tone: 'neutral' as const };
  if (diff > 0) return { label: `+${diff}`, tone: 'up' as const };
  return { label: `${diff}`, tone: 'down' as const };
}

function swingsThisMonth(swings: { created_at: string }[]) {
  const now = new Date();
  return swings.filter((s) => {
    const d = new Date(s.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function StatChip({
  icon,
  label,
  value,
  sub,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  sub?: string;
}) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 14, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 280 });
      }}
    >
      <Animated.View style={[styles.statChip, anim]}>
        <View style={styles.statChipGlow} />
        <View style={styles.statIconRing}>
          <Ionicons name={icon} size={16} color={ACCENT} />
        </View>
        <Text style={styles.statChipLabel}>{label}</Text>
        <Text style={styles.statChipValue}>{value}</Text>
        {sub ? <Text style={styles.statChipSub}>{sub}</Text> : null}
      </Animated.View>
    </Pressable>
  );
}

function AchievementCard({
  title,
  detail,
  icon,
  unlocked,
  progress,
}: {
  title: string;
  detail: string;
  icon: IoniconName;
  unlocked: boolean;
  progress?: string;
}) {
  return (
    <View style={[styles.badgeCard, !unlocked && styles.badgeCardLocked]}>
      <View style={[styles.badgeIconWrap, unlocked && styles.badgeIconWrapOn]}>
        <Ionicons name={icon} size={22} color={unlocked ? ACCENT : '#555'} />
      </View>
      <Text style={[styles.badgeTitle, !unlocked && styles.badgeTitleLocked]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.badgeDetail} numberOfLines={2}>
        {detail}
      </Text>
      {progress && !unlocked ? <Text style={styles.badgeProgress}>{progress}</Text> : null}
      {!unlocked ? (
        <View style={styles.lockRow}>
          <Ionicons name="lock-closed" size={12} color="#666" />
          <Text style={styles.lockText}>Locked</Text>
        </View>
      ) : (
        <View style={styles.unlockedPill}>
          <Ionicons name="checkmark-circle" size={12} color={ACCENT} />
          <Text style={styles.unlockedText}>Unlocked</Text>
        </View>
      )}
    </View>
  );
}

function MenuLink({
  icon,
  label,
  onPress,
  danger,
  colors,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuLink, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.menuLinkIcon, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.textMuted} />
      </View>
      <Text style={[styles.menuLinkLabel, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function defaultBioForGoal(goal: GoalFocus) {
  if (goal === 'Distance') return 'Chasing speed with purpose. Always improving.';
  if (goal === 'Accuracy') return 'Dialing in start lines and face control.';
  return 'Golf obsessed. Always improving.';
}

function SparkRow({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <View style={styles.sparkRow}>
      {values.map((v, i) => {
        const h = 4 + (v / max) * 18;
        return <View key={i} style={[styles.sparkBar, { height: h, backgroundColor: i === values.length - 1 ? ACCENT : '#3A3A3A' }]} />;
      })}
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { user, signOut } = useAuth();
  const { swings, refetch } = useSwings(user?.id);
  const { prefs, setDisplayName, setBio, setHandicap, reloadPrefs } = usePreferences();

  const { openPaywall, Paywall } = usePaywall();
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showHandicapModal, setShowHandicapModal] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftHandicap, setDraftHandicap] = useState('');

  const perfCardSize = useMemo(() => Math.floor((SCREEN_W - H_PAD * 2 - 12) / 2), []);

  useFocusEffect(
    useCallback(() => {
      refetch();
      reloadPrefs();
      router.prefetch('/(tabs)/profile/settings');
    }, [refetch, reloadPrefs, router]),
  );

  const isPro = hasProAccess(user);
  const admin = isAdmin(user);
  const founder = isFounder(user);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const streak = useMemo(() => computePracticeStreak(swings), [swings]);
  const trend = useMemo(() => progressTrend(swings), [swings]);
  const avgScore =
    swings.length > 0
      ? Math.round(swings.reduce((a, s) => a + getSwingScore(s.result_json), 0) / swings.length)
      : 0;
  const monthUploads = useMemo(() => swingsThisMonth(swings), [swings]);
  const challengeWins = useMemo(
    () => Math.min(24, Math.floor(swings.length * 0.55) + (streak >= 3 ? 2 : 0)),
    [swings.length, streak],
  );
  const totalPoints = useMemo(() => {
    const base = swings.reduce((a, s) => a + getSwingScore(s.result_json), 0);
    return base + streak * 25 + monthUploads * 10;
  }, [swings, streak, monthUploads]);

  const winRate = useMemo(() => {
    if (swings.length === 0) return 0;
    return Math.min(92, 48 + Math.round((avgScore - 50) * 0.8) + Math.min(12, streak * 2));
  }, [swings.length, avgScore, streak]);

  const sparkScores = useMemo(() => {
    const last = swings.slice(0, 5).map((s) => getSwingScore(s.result_json));
    while (last.length < 5) last.push(avgScore || 50);
    return last.reverse();
  }, [swings, avgScore]);

  const handle = user?.username ? `@${user.username.toLowerCase().replace(/\s+/g, '')}` : '@golfer';
  const profileHeadline = prefs.displayName.trim() || user?.username || 'Golfer';
  const profileBio = prefs.bio.trim() || defaultBioForGoal(prefs.goalFocus);
  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'IA';

  const achievements = useMemo(
    () => [
      {
        id: 's7',
        title: '7 Day Streak',
        detail: 'Practice 7 days in a row',
        icon: 'flame' as IoniconName,
        unlocked: streak >= 7,
        progress: streak < 7 ? `${streak}/7 days` : undefined,
      },
      {
        id: 'sw50',
        title: '50 Swings',
        detail: 'Upload 50 analyzed swings',
        icon: 'golf' as IoniconName,
        unlocked: swings.length >= 50,
        progress: swings.length < 50 ? `${swings.length}/50` : undefined,
      },
      {
        id: 'champ',
        title: 'Challenge Champion',
        detail: 'Win 10 friend challenges',
        icon: 'trophy' as IoniconName,
        unlocked: challengeWins >= 10,
        progress: challengeWins < 10 ? `${challengeWins}/10 wins` : undefined,
      },
      {
        id: 'top',
        title: 'Top Performer',
        detail: 'Average score 75+',
        icon: 'trending-up' as IoniconName,
        unlocked: avgScore >= 75 && swings.length >= 5,
        progress: avgScore < 75 || swings.length < 5 ? `Avg ${avgScore || '—'}` : undefined,
      },
      {
        id: 'course',
        title: 'Course Crusher',
        detail: '30 swings in one month',
        icon: 'navigate' as IoniconName,
        unlocked: monthUploads >= 30,
        progress: monthUploads < 30 ? `${monthUploads}/30 this month` : undefined,
      },
      {
        id: 'king',
        title: 'Consistency King',
        detail: '4-week positive score trend',
        icon: 'ribbon' as IoniconName,
        unlocked: trend.tone === 'up' && swings.length >= 8,
        progress:
          trend.tone === 'up' && swings.length < 8
            ? `${swings.length}/8 swings`
            : trend.tone !== 'up'
              ? 'Trending up unlocks this'
              : undefined,
      },
    ],
    [streak, swings.length, challengeWins, avgScore, monthUploads, trend],
  );

  async function saveEditProfile() {
    await setDisplayName(draftDisplayName.trim());
    await setBio(draftBio.trim());
    await reloadPrefs();
    Keyboard.dismiss();
    setShowEditProfile(false);
  }

  function openEditProfileModal() {
    setDraftDisplayName(prefs.displayName);
    setDraftBio(prefs.bio);
    setShowEditProfile(true);
  }

  function openHandicapModal() {
    setDraftHandicap(prefs.handicap);
    setShowHandicapModal(true);
  }

  async function saveHandicapProfile() {
    const trimmed = draftHandicap.trim();
    if (!isValidHandicapInput(trimmed)) {
      Alert.alert('Invalid handicap', 'Use a number from 0–54, optional decimal (e.g. 12.4 or +2.1).');
      return;
    }
    await setHandicap(trimmed);
    await reloadPrefs();
    Keyboard.dismiss();
    setShowHandicapModal(false);
  }

  const handicapDisplay = formatHandicapDisplay(prefs.handicap);

  async function handleSignOut() {
    if (DEV_MODE) {
      Alert.alert('Dev Mode', 'Sign out is disabled in dev mode.');
      return;
    }
    Alert.alert('Sign out?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (err: unknown) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Sign out failed.');
          }
        },
      },
    ]);
  }

  if (!user) return null;

  const isDark = theme === 'dark';
  const dailyLimit = getPlanLimits(user).swingsPerDay;
  const todayUsed = swings.filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString()).length;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Paywall />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.pageTitleBlock, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>Profile</Text>
        </View>

        <View style={[styles.hero, { paddingHorizontal: H_PAD }]}>
          <View style={[styles.heroCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.heroTop}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/profile/settings')}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
                style={styles.avatarTap}
              >
                <ProfileAvatar
                  size="xl"
                  imageUri={user.avatar_url}
                  initials={initials}
                />
                <View style={[styles.avatarCamBadge, { borderColor: colors.background }]}>
                  <Ionicons name="camera" size={14} color="#0A0A0A" />
                </View>
              </TouchableOpacity>

              <View style={styles.heroTextCol}>
                <View style={styles.nameRow}>
                  <Text style={[styles.displayName, { color: colors.text }]} numberOfLines={1}>
                    {profileHeadline}
                  </Text>
                  {(isPro || admin || founder) && (
                    <View style={[styles.verified, { borderColor: 'rgba(52,224,111,0.4)' }]}>
                      <Ionicons name="checkmark-circle" size={14} color={ACCENT} />
                      <Text style={styles.verifiedText}>{founder ? 'Founder' : admin ? 'Admin' : 'Pro'}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.handle, { color: colors.textSecondary }]}>{handle}</Text>
                <Text style={[styles.bio, { color: colors.textSecondary }]}>{profileBio}</Text>
                <View style={styles.heroMetaRow}>
                  <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.metaSmall, { color: colors.textMuted }]}>ImpactAI · Your journey</Text>
                </View>
                <TouchableOpacity
                  style={[styles.hcpPill, { backgroundColor: ACCENT_SOFT, borderColor: 'rgba(52,224,111,0.25)' }]}
                  onPress={openHandicapModal}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Set handicap"
                >
                  <Text style={styles.hcpLabel}>Handicap</Text>
                  <View style={styles.hcpValueRow}>
                    <Text style={[styles.hcpValue, { color: colors.text }]}>{handicapDisplay}</Text>
                    <Ionicons name="chevron-down" size={14} color={ACCENT} style={{ opacity: 0.85 }} />
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.editProfileBtn, { borderColor: 'rgba(52,224,111,0.35)', backgroundColor: 'rgba(52,224,111,0.08)' }]}
              onPress={openEditProfileModal}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={18} color={ACCENT} />
              <Text style={styles.editProfileText}>Edit profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.sectionHead, styles.sectionHeadFirst, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your momentum</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.statsScroll, { paddingHorizontal: H_PAD }]}
        >
          <StatChip icon="flame-outline" label="Streak" value={`${streak}`} sub="days" />
          <StatChip icon="cloud-upload-outline" label="Swings" value={`${swings.length}`} sub="uploaded" />
          <StatChip
            icon="pulse-outline"
            label="Consistency"
            value={trend.label}
            sub={trend.tone === 'up' ? 'trending up' : trend.tone === 'down' ? 'room to grow' : 'steady'}
          />
          <StatChip icon="flag-outline" label="Wins" value={`${challengeWins}`} sub="challenges" />
          <StatChip icon="star-outline" label="Points" value={totalPoints >= 1000 ? `${(totalPoints / 1000).toFixed(1)}k` : `${totalPoints}`} sub="total" />
        </ScrollView>

        {isPro || admin || founder ? (
          <View style={[styles.proWrap, { paddingHorizontal: H_PAD }]}>
            <View style={[styles.proCard, { borderColor: 'rgba(52,224,111,0.28)' }]}>
              <View style={styles.proShine} />
              <View style={styles.proRow}>
                <View style={[styles.proIcon, { backgroundColor: ACCENT_SOFT }]}>
                  <Ionicons name="sparkles" size={22} color={ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.proTitle, { color: colors.text }]}>ImpactAI Pro</Text>
                  <Text style={[styles.proSub, { color: colors.textSecondary }]}>
                    {founder ? 'Founder access — thank you for building with us.' : "You're on the Pro plan"}
                  </Text>
                  <Text style={[styles.proMeta, { color: colors.textMuted }]}>
                    {dailyLimit === Infinity ? 'Unlimited analyses' : `${todayUsed} / ${dailyLimit} today`}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.managePlanBtn}
                onPress={() =>
                  Alert.alert('ImpactAI Pro', 'Subscription management will connect to billing in a future update.')
                }
                activeOpacity={0.88}
              >
                <Text style={styles.managePlanText}>Manage plan</Text>
                <Ionicons name="chevron-forward" size={16} color="#0A0A0A" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.proWrap, { paddingHorizontal: H_PAD }]}>
            <TouchableOpacity
              style={[styles.upgradeHero, { borderColor: 'rgba(52,224,111,0.35)' }]}
              onPress={openPaywall}
              activeOpacity={0.9}
            >
              <View style={[styles.upgradeIcon, { backgroundColor: ACCENT_SOFT }]}>
                <Ionicons name="rocket-outline" size={18} color={ACCENT} />
              </View>
              <Text style={[styles.upgradeTitle, { color: colors.text }]}>Unlock ImpactAI Pro</Text>
              <Text style={[styles.upgradeSub, { color: colors.textSecondary }]}>
                Unlimited swings, deeper coaching, and social leaderboards.
              </Text>
              <View style={styles.upgradeCta}>
                <Text style={styles.upgradeCtaText}>View Pro</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.sectionHead, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Performance</Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted }]}>Lightweight snapshot</Text>
        </View>
        <View style={[styles.perfGrid, { paddingHorizontal: H_PAD }]}>
          <View
            style={[
              styles.perfCard,
              { borderColor: colors.border, backgroundColor: colors.surface, width: perfCardSize, height: perfCardSize },
            ]}
          >
            <Text style={[styles.perfLabel, { color: colors.textMuted }]}>Consistency</Text>
            <View style={styles.perfCardMid}>
              <SparkRow values={sparkScores} />
            </View>
            <Text style={[styles.perfValue, { color: colors.text }]}>{trend.label}</Text>
            <Text style={[styles.perfCaption, { color: colors.textSecondary }]}>Last few swings</Text>
          </View>
          <View
            style={[
              styles.perfCard,
              { borderColor: colors.border, backgroundColor: colors.surface, width: perfCardSize, height: perfCardSize },
            ]}
          >
            <Text style={[styles.perfLabel, { color: colors.textMuted }]}>Avg score</Text>
            <View style={styles.perfCardMid}>
              <Ionicons name="analytics-outline" size={28} color={ACCENT} />
            </View>
            <Text style={[styles.perfValue, { color: colors.text }]}>{avgScore || '—'}</Text>
            <Text style={[styles.perfCaption, { color: colors.textSecondary }]}>All-time</Text>
          </View>
          <View
            style={[
              styles.perfCard,
              { borderColor: colors.border, backgroundColor: colors.surface, width: perfCardSize, height: perfCardSize },
            ]}
          >
            <Text style={[styles.perfLabel, { color: colors.textMuted }]}>This month</Text>
            <View style={styles.perfCardMid}>
              <Ionicons name="calendar-outline" size={28} color={ACCENT} />
            </View>
            <Text style={[styles.perfValue, { color: colors.text }]}>{monthUploads}</Text>
            <Text style={[styles.perfCaption, { color: colors.textSecondary }]}>uploads</Text>
          </View>
          <View
            style={[
              styles.perfCard,
              { borderColor: colors.border, backgroundColor: colors.surface, width: perfCardSize, height: perfCardSize },
            ]}
          >
            <Text style={[styles.perfLabel, { color: colors.textMuted }]}>Challenge rate</Text>
            <View style={styles.perfCardMid}>
              <Ionicons name="ribbon-outline" size={28} color={ACCENT} />
            </View>
            <Text style={[styles.perfValue, { color: colors.text }]}>{winRate}%</Text>
            <Text style={[styles.perfCaption, { color: colors.textSecondary }]}>win rate</Text>
          </View>
        </View>

        <View style={[styles.sectionHead, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Achievements</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.badgeScroll, { paddingHorizontal: H_PAD }]}
        >
          {achievements.map((a) => (
            <AchievementCard
              key={a.id}
              title={a.title}
              detail={a.detail}
              icon={a.icon}
              unlocked={a.unlocked}
              progress={a.progress}
            />
          ))}
        </ScrollView>

        <View style={[styles.sectionHead, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Account</Text>
        </View>
        <View style={[styles.menuBlock, { paddingHorizontal: H_PAD }]}>
          <MenuLink icon="diamond-outline" label="My plan" onPress={openPaywall} colors={colors} />
          <MenuLink icon="settings-outline" label="Settings" onPress={() => router.push('/(tabs)/profile/settings')} colors={colors} />
          <MenuLink icon="log-out-outline" label="Log out" onPress={handleSignOut} danger colors={colors} />
        </View>

        <Text style={[styles.version, { color: colors.textMuted }]}>ImpactAI v{appVersion}</Text>
      </ScrollView>

      <Modal visible={showEditProfile} animationType="fade" transparent onRequestClose={() => setShowEditProfile(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowEditProfile(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKb}
          >
            <View style={[styles.editSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.editSheetTitle, { color: colors.text }]}>Edit profile</Text>
              <Text style={[styles.editHint, { color: colors.textMuted }]}>
                Your name appears on the home greeting. Leave blank to use your username.
              </Text>
              <Text style={[styles.editLabel, { color: colors.textSecondary }]}>Name</Text>
              <TextInput
                style={[styles.editInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                value={draftDisplayName}
                onChangeText={setDraftDisplayName}
                placeholder="e.g. Michael"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                maxLength={60}
              />
              <Text style={[styles.editLabel, { color: colors.textSecondary }]}>Bio</Text>
              <TextInput
                style={[
                  styles.editInput,
                  styles.editInputBio,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
                ]}
                value={draftBio}
                onChangeText={setDraftBio}
                placeholder="Tell the community about your golf journey"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={200}
                textAlignVertical="top"
              />
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={[styles.editCancelBtn, { borderColor: colors.border }]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setShowEditProfile(false);
                  }}
                >
                  <Text style={[styles.editCancelText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editSaveBtn} onPress={saveEditProfile}>
                  <Text style={styles.editSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={showHandicapModal} animationType="fade" transparent onRequestClose={() => setShowHandicapModal(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowHandicapModal(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKb}>
            <View style={[styles.editSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.editSheetTitle, { color: colors.text }]}>Handicap index</Text>
              <Text style={[styles.editHint, { color: colors.textMuted }]}>
                Used for net games and friend matchups. Leave blank if you do not track one yet.
              </Text>
              <Text style={[styles.editLabel, { color: colors.textSecondary }]}>Index</Text>
              <TextInput
                style={[styles.editInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                value={draftHandicap}
                onChangeText={setDraftHandicap}
                placeholder="e.g. 12.4 or +2.1"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                maxLength={6}
                autoFocus
              />
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={[styles.editCancelBtn, { borderColor: colors.border }]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setShowHandicapModal(false);
                  }}
                >
                  <Text style={[styles.editCancelText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editSaveBtn} onPress={saveHandicapProfile}>
                  <Text style={styles.editSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingTop: 8, paddingBottom: 130 },

  pageTitleBlock: { paddingTop: 4, paddingBottom: 20 },
  pageTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },

  hero: { marginBottom: 32 },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    overflow: 'hidden',
  },
  heroTop: { flexDirection: 'row', gap: 16 },
  avatarTap: { position: 'relative' },
  avatarCamBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextCol: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  displayName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, flexShrink: 1 },
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: ACCENT_SOFT,
  },
  verifiedText: { fontSize: 11, fontWeight: '800', color: ACCENT, letterSpacing: 0.3 },
  handle: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  bio: { fontSize: 14, lineHeight: 20, marginTop: 8, fontWeight: '500' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaSmall: { fontSize: 12, fontWeight: '500' },
  hcpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  hcpLabel: { fontSize: 11, fontWeight: '700', color: ACCENT, textTransform: 'uppercase', letterSpacing: 0.5 },
  hcpValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hcpValue: { fontSize: 14, fontWeight: '800' },
  editProfileBtn: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  editProfileText: { fontSize: 15, fontWeight: '800', color: ACCENT },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 40,
    marginBottom: 16,
  },
  sectionHeadFirst: {
    marginTop: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sectionHint: { fontSize: 12, fontWeight: '600' },

  statsScroll: { gap: 14, paddingBottom: 8, marginBottom: 12 },
  statChip: {
    width: 118,
    borderRadius: 18,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingVertical: 14,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  statChipGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(52,224,111,0.04)',
  },
  statIconRing: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statChipLabel: { fontSize: 10, fontWeight: '800', color: '#888', letterSpacing: 0.8, textTransform: 'uppercase' },
  statChipValue: { fontSize: 22, fontWeight: '800', color: '#FFF', marginTop: 2, letterSpacing: -0.5 },
  statChipSub: { fontSize: 11, fontWeight: '600', color: '#666', marginTop: 2 },

  proWrap: { marginTop: 12, marginBottom: 8 },
  proCard: {
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: '#101810',
    padding: 18,
    overflow: 'hidden',
  },
  proShine: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(52,224,111,0.06)',
  },
  proRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  proIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proTitle: { fontSize: 18, fontWeight: '800' },
  proSub: { fontSize: 13, lineHeight: 18, marginTop: 4, fontWeight: '500' },
  proMeta: { fontSize: 12, marginTop: 8, fontWeight: '600' },
  managePlanBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 14,
  },
  managePlanText: { fontSize: 15, fontWeight: '800', color: '#0A0A0A' },
  upgradeHero: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#101010',
  },
  upgradeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeTitle: { fontSize: 16, fontWeight: '800', marginTop: 8, textAlign: 'center', letterSpacing: -0.2 },
  upgradeSub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 280,
    paddingHorizontal: 4,
  },
  upgradeCta: {
    marginTop: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 10,
    borderRadius: 12,
  },
  upgradeCtaText: { fontSize: 14, fontWeight: '800', color: '#0A0A0A' },

  perfGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  perfCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  perfCardMid: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    marginVertical: 6,
  },
  perfLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  perfValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 4 },
  perfCaption: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4, height: 32 },
  sparkBar: { width: 8, borderRadius: 3, minHeight: 4 },

  badgeScroll: { gap: 14, paddingBottom: 12, marginBottom: 8 },
  badgeCard: {
    width: 148,
    borderRadius: 18,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2C2C2C',
    padding: 14,
  },
  badgeCardLocked: { opacity: 0.72 },
  badgeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  badgeIconWrapOn: {
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
    shadowColor: ACCENT,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  badgeTitle: { fontSize: 14, fontWeight: '800', color: '#FFF', letterSpacing: -0.2 },
  badgeTitleLocked: { color: '#AAA' },
  badgeDetail: { fontSize: 11, color: '#777', marginTop: 4, lineHeight: 15, fontWeight: '500' },
  badgeProgress: { fontSize: 10, fontWeight: '700', color: ACCENT, marginTop: 8 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  lockText: { fontSize: 10, fontWeight: '700', color: '#666' },
  unlockedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  unlockedText: { fontSize: 10, fontWeight: '800', color: ACCENT },

  menuBlock: { gap: 14, marginBottom: 32, marginTop: 4 },
  menuLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuLinkIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLinkLabel: { flex: 1, fontSize: 15, fontWeight: '600' },

  version: { textAlign: 'center', fontSize: 12, marginTop: 16, marginBottom: 8 },

  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalKb: {
    width: '100%',
    zIndex: 1,
  },
  editSheet: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    gap: 8,
  },
  editSheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  editHint: { fontSize: 13, lineHeight: 18, marginBottom: 8, fontWeight: '500' },
  editLabel: { fontSize: 12, fontWeight: '700', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  editInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  editInputBio: { minHeight: 100, paddingTop: 12 },
  editActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editCancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  editCancelText: { fontSize: 16, fontWeight: '700' },
  editSaveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  editSaveText: { fontSize: 16, fontWeight: '800', color: '#0A0A0A' },
});
