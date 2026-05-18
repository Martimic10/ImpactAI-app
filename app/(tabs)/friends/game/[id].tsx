import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { getSocialGameFullDetail, categoryLabel } from '@/lib/socialGameDetails';
import type { SocialGameDetailStep, SocialGameDetailTip } from '@/lib/socialGameDetails';
import { SocialGamePlayTab } from '@/components/friends/SocialGamePlayTab';
import { SocialGameTeamPlayTab } from '@/components/friends/SocialGameTeamPlayTab';
import { usePreferences } from '@/hooks/usePreferences';
import {
  createDefaultTeams,
  flattenTeams,
  isTeamCategoryGame,
  type TeamRoster,
} from '@/lib/teamGameRoster';
import { formatHandicapDisplay } from '@/lib/preferences';
import { requiresProForGame } from '@/lib/plans';
import { usePaywall } from '@/hooks/usePaywall';
import { useAuth } from '@/hooks/useAuth';
import { fetchFriendProfiles } from '@/lib/friends';
import { buildSoloGameRoster } from '@/lib/gameRoster';
import { setLiveGameRoster, type LiveGameRosterPlayer } from '@/lib/liveGameSession';
import { useGameCourseSetup } from '@/hooks/useGameCourseSetup';
import { formatCourseMeta } from '@/lib/golfCourse/setup';
import type { UserProfile } from '@/types';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.18)';
const H_PAD = 20;

/** Match `tabBarStyle.height` in `app/(tabs)/_layout.tsx` — tab bar is `position: 'absolute'` and overlays this stack. */
const TAB_BAR_OVERLAY_HEIGHT = Platform.OS === 'ios' ? 100 : 76;

type Ion = React.ComponentProps<typeof Ionicons>['name'];
type DetailTab = 'how' | 'play';

function DetailSegment({
  value,
  active,
  label,
  iconMuted,
  labelMuted,
  onPress,
}: {
  value: DetailTab;
  active: boolean;
  label: string;
  iconMuted: string;
  labelMuted: string;
  onPress: (v: DetailTab) => void;
}) {
  const progress = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    progress.value = withSpring(active ? 1 : 0, { damping: 16, stiffness: 260, mass: 0.55 });
  }, [active, progress]);

  const shell = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(52, 224, 111, 0)', ACCENT_SOFT]
    ),
    borderColor: interpolateColor(progress.value, [0, 1], ['rgba(52, 224, 111, 0)', ACCENT]),
    shadowOpacity: progress.value * 0.34,
    shadowRadius: 4 + progress.value * 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: progress.value * 5,
  }));

  return (
    <Pressable onPress={() => onPress(value)} style={{ flex: 1 }}>
      <Animated.View
        style={[
          styles.segCell,
          { shadowColor: ACCENT, borderWidth: 1.5 },
          shell,
        ]}
      >
        <Ionicons
          name={value === 'how' ? 'book-outline' : 'rocket-outline'}
          size={16}
          color={active ? ACCENT : iconMuted}
        />
        <Text style={[styles.segLabel, { color: active ? ACCENT : labelMuted }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function GlassCard({
  children,
  style,
  themeMode,
}: {
  children: React.ReactNode;
  style?: object;
  themeMode: 'light' | 'dark';
}) {
  const bg =
    themeMode === 'dark' ? 'rgba(22, 24, 22, 0.92)' : 'rgba(255,255,255,0.94)';
  return (
    <View
      style={[
        styles.glassCard,
        {
          backgroundColor: bg,
          borderColor: 'rgba(52,224,111,0.16)',
        },
        style,
      ]}
    >
      <View pointerEvents="none" style={styles.glassGlow} />
      {children}
    </View>
  );
}

function StepTimeline({ steps, textColor, muted }: { steps: SocialGameDetailStep[]; textColor: string; muted: string }) {
  return (
    <View style={styles.timelineWrap}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <View key={i} style={[styles.stepRow, !last && styles.stepRowSpaced]}>
            <View style={styles.stepTrack}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              {!last ? <View style={styles.stepConnector} /> : null}
            </View>
            <View style={styles.stepBody}>
              <Text style={[styles.stepTitle, { color: textColor }]}>{step.title}</Text>
              <Text style={[styles.stepDesc, { color: muted }]}>{step.description}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TipRow({ tip, themeMode }: { tip: SocialGameDetailTip; themeMode: 'light' | 'dark' }) {
  const colors = useAppColors();
  return (
    <View
      style={[
        styles.tipCard,
        {
          backgroundColor: themeMode === 'dark' ? 'rgba(255,255,255,0.04)' : colors.surfaceAlt,
          borderColor: 'rgba(52,224,111,0.14)',
        },
      ]}
    >
      <View style={styles.tipIcon}>
        <Ionicons name={tip.icon as Ion} size={16} color={ACCENT} />
      </View>
      <Text style={[styles.tipText, { color: colors.text }]}>{tip.text}</Text>
    </View>
  );
}

function SettingsList({
  rows,
  colors,
  themeMode,
}: {
  rows: { label: string; value: string }[];
  colors: ReturnType<typeof useAppColors>;
  themeMode: 'light' | 'dark';
}) {
  return (
    <GlassCard themeMode={themeMode} style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          style={[
            styles.setRow,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(52,224,111,0.12)' },
          ]}
        >
          <Text style={[styles.setLabel, { color: colors.textMuted }]}>{row.label}</Text>
          <Text style={[styles.setValue, { color: colors.text }]}>{row.value}</Text>
        </View>
      ))}
    </GlassCard>
  );
}

export default function SocialGameDetailScreen() {
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { theme } = useTheme();
  const colors = useAppColors();
  const { isPro, requirePro, Paywall } = usePaywall();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const themeMode = theme === 'dark' ? 'dark' : 'light';

  const [tab, setTab] = useState<DetailTab>('how');
  const [roster, setRoster] = useState<LiveGameRosterPlayer[]>([]);
  const [teams, setTeams] = useState<TeamRoster[]>([]);
  const courseSetup = useGameCourseSetup();
  const { prefs } = usePreferences();
  const detail = id ? getSocialGameFullDetail(id) : null;
  const isTeamMode = detail ? isTeamCategoryGame(detail.category) : false;
  const scrollRef = useRef<ScrollView>(null);
  const scrollPlayToTopAfterTransition = useRef(false);

  useEffect(() => {
    if (!detail) {
      router.replace({ pathname: '/(tabs)/friends', params: { segment: 'games' } });
    }
  }, [detail, router]);

  useEffect(() => {
    if (!user) return;
    const userHcpRaw = formatHandicapDisplay(prefs.handicap);
    const userHcp = userHcpRaw === '—' ? '8.4' : userHcpRaw;
    setRoster((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: 'p1',
          name: 'You',
          handicap: userHcp,
          initials: (user.username ?? 'YO').slice(0, 2).toUpperCase(),
          avatarUrl: user.avatar_url,
        },
      ];
    });
  }, [user?.id, user?.username, user?.avatar_url, prefs.handicap]);

  useEffect(() => {
    if (!detail || !user) return;
    let cancelled = false;

    void (async () => {
      const friends = await fetchFriendProfiles(user.id);
      if (cancelled) return;

      const userHcpRaw = formatHandicapDisplay(prefs.handicap);
      const userHcp = userHcpRaw === '—' ? '8.4' : userHcpRaw;
      const userProfile: UserProfile = {
        id: user.id,
        username: user.username ?? 'golfer',
        email: user.email ?? '',
        plan: user.plan,
        avatar_url: user.avatar_url,
      };

      if (isTeamMode) {
        const nextTeams = createDefaultTeams(detail.gameId, userHcp, {
          user: userProfile,
          friends,
        });
        setTeams(nextTeams);
        setRoster(flattenTeams(nextTeams));
      } else {
        setTeams([]);
        setRoster(buildSoloGameRoster(userProfile, friends, userHcp));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detail?.gameId, isTeamMode, user?.id, user?.username, user?.avatar_url, prefs.handicap]);

  useEffect(() => {
    if (tab !== 'play' || !scrollPlayToTopAfterTransition.current) return;
    scrollPlayToTopAfterTransition.current = false;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [tab]);

  const bottomInset = Math.max(insets.bottom, 12);
  const ctaBarHeight = 56;
  const howStickyHeight = 14 + ctaBarHeight + bottomInset;
  const scrollBottomPad =
    tab === 'how' ? TAB_BAR_OVERLAY_HEIGHT + howStickyHeight + 16 : TAB_BAR_OVERLAY_HEIGHT + bottomInset + 32;

  const onStartGame = useCallback(() => {
    if (!detail) return;
    if (!isPro && requiresProForGame(detail.gameId)) {
      requirePro();
      return;
    }
    const players = isTeamMode && teams.length > 0 ? flattenTeams(teams) : roster;
    setLiveGameRoster(
      detail.gameId,
      players,
      isTeamMode && teams.length > 0 ? teams : undefined,
      courseSetup.getActiveForSession(),
    );
    router.push({ pathname: '/(tabs)/friends/game-scorecard/[id]', params: { id: detail.gameId } });
  }, [router, detail, roster, teams, isTeamMode, isPro, requirePro, courseSetup]);

  const handleTeamsChange = useCallback((next: TeamRoster[]) => {
    setTeams(next);
    setRoster(flattenTeams(next));
  }, []);

  const onStickyCta = useCallback(() => {
    if (!detail) return;
    scrollPlayToTopAfterTransition.current = true;
    setTab('play');
  }, [detail]);

  if (!detail) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: H_PAD,
            paddingBottom: scrollBottomPad,
            width: '100%',
          }}
        >
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backBtn,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceAlt,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.hero}>
            <View style={[styles.heroIcon, { shadowColor: ACCENT }]}>
              <Ionicons name={detail.icon as Ion} size={34} color={ACCENT} />
            </View>
            <Text style={[styles.heroTitle, { color: colors.text }]}>{detail.title}</Text>
            {tab === 'play' ? (
              <>
                <Text style={[styles.heroPlaySub, { color: colors.textSecondary }]}>{detail.subtitle}</Text>
                <Text style={[styles.courseName, { color: colors.text }]} numberOfLines={2}>
                  {courseSetup.activeScorecard.course.name}
                </Text>
                <Text style={[styles.courseMeta, { color: colors.textMuted }]}>
                  {formatCourseMeta(courseSetup.activeScorecard)}
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.heroTag, { color: colors.textSecondary }]}>{detail.tagline}</Text>
                <Text style={[styles.heroDeck, { color: colors.textMuted }]}>{detail.subtitle}</Text>
                <View style={[styles.catPill, { borderColor: 'rgba(52,224,111,0.35)' }]}>
                  <Text style={[styles.catPillTxt, { color: ACCENT }]}>{categoryLabel(detail.category)}</Text>
                </View>
              </>
            )}
          </View>

          <View style={[styles.segment, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <DetailSegment
              value="how"
              active={tab === 'how'}
              label="How to Play"
              iconMuted={colors.textMuted}
              labelMuted={colors.textSecondary}
              onPress={setTab}
            />
            <DetailSegment
              value="play"
              active={tab === 'play'}
              label="Play"
              iconMuted={colors.textMuted}
              labelMuted={colors.textSecondary}
              onPress={setTab}
            />
          </View>

          {tab === 'how' ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.howTabRoot}>
              <View>
                <Text style={[styles.sectionKicker, { color: colors.textMuted }]}>Overview</Text>
                <GlassCard themeMode={themeMode} style={{ marginTop: 10, padding: 20 }}>
                  <View style={styles.overviewIconRow}>
                    <View style={styles.overviewIcon}>
                      <Ionicons name="information-circle-outline" size={22} color={ACCENT} />
                    </View>
                    <Text style={[styles.overviewLead, { color: colors.text }]}>{detail.overview}</Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: 'rgba(52,224,111,0.12)' }]} />
                  <Text style={[styles.miniHead, { color: colors.text }]}>Objective</Text>
                  <Text style={[styles.miniBody, { color: colors.textSecondary }]}>{detail.objective}</Text>
                  <Text style={[styles.miniHead, { color: colors.text, marginTop: 14 }]}>Who wins</Text>
                  <Text style={[styles.miniBody, { color: colors.textSecondary }]}>{detail.whoWins}</Text>
                </GlassCard>
              </View>

              <View>
                <Text style={[styles.sectionKicker, { color: colors.textMuted }]}>How to Play</Text>
                <GlassCard themeMode={themeMode} style={{ marginTop: 10, padding: 20 }}>
                  <StepTimeline steps={detail.steps} textColor={colors.text} muted={colors.textSecondary} />
                </GlassCard>
              </View>

              <View>
                <Text style={[styles.sectionKicker, { color: colors.textMuted }]}>Scoring Example</Text>
                <GlassCard themeMode={themeMode} style={{ marginTop: 10, padding: 18 }}>
                  <Text style={[styles.scoringHint, { color: colors.textSecondary }]}>{detail.scoringHeadline}</Text>
                  {detail.scoringRows.map((row) => (
                    <View
                      key={row.label}
                      style={[
                        styles.scoreRow,
                        row.accent && styles.scoreRowAccent,
                        { borderColor: 'rgba(52,224,111,0.2)' },
                      ]}
                    >
                      <Text style={[styles.scoreLabel, { color: colors.text }]}>{row.label}</Text>
                      <Text style={[styles.scoreValue, { color: row.accent ? ACCENT : colors.textSecondary }]}>
                        {row.value}
                      </Text>
                    </View>
                  ))}
                  {detail.scoringNote ? (
                    <Text style={[styles.scoringNote, { color: colors.textMuted }]}>{detail.scoringNote}</Text>
                  ) : null}
                </GlassCard>
              </View>

              <View>
                <Text style={[styles.sectionKicker, { color: colors.textMuted }]}>Tips</Text>
                <View style={{ marginTop: 10, gap: 10 }}>
                  {detail.tips.map((t, i) => (
                    <TipRow key={i} tip={t} themeMode={themeMode} />
                  ))}
                </View>
              </View>

              <View style={styles.gameSettingsPreviewSection}>
                <Text style={[styles.sectionKicker, { color: colors.textMuted }]}>Game settings preview</Text>
                <View style={{ marginTop: 10 }}>
                  <SettingsList rows={detail.settings} colors={colors} themeMode={themeMode} />
                </View>
              </View>
            </Animated.View>
          ) : isTeamMode ? (
            <SocialGameTeamPlayTab
              detail={detail}
              themeMode={themeMode}
              teams={teams}
              onTeamsChange={handleTeamsChange}
              onStartGame={onStartGame}
              courseSetup={courseSetup}
            />
          ) : (
            <SocialGamePlayTab
              detail={detail}
              themeMode={themeMode}
              players={roster}
              onPlayersChange={setRoster}
              onStartGame={onStartGame}
              courseSetup={courseSetup}
            />
          )}
        </ScrollView>

        {tab === 'how' ? (
          <View
            style={[
              styles.stickyBar,
              {
                bottom: TAB_BAR_OVERLAY_HEIGHT,
                paddingBottom: bottomInset,
                backgroundColor: colors.background,
                borderTopColor: 'rgba(255,255,255,0.07)',
              },
            ]}
          >
            <View style={styles.ctaShell} collapsable={false}>
              <Pressable
                onPress={onStickyCta}
                style={({ pressed }) => [
                  styles.ctaPressable,
                  {
                    opacity: pressed ? 0.92 : 1,
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  },
                ]}
              >
                <View style={styles.ctaRow}>
                  <Text style={styles.ctaText}>Continue to Setup</Text>
                  <Ionicons name="chevron-forward" size={20} color="#0A0A0A" />
                </View>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
      <Paywall />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  howTabRoot: {
    marginTop: 22,
    gap: 22,
    width: '100%',
    alignSelf: 'stretch',
  },
  gameSettingsPreviewSection: {
    width: '100%',
    marginBottom: 8,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 22,
  },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.4)',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.35,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 6 },
    }),
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroTag: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  heroDeck: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 340,
  },
  heroPlaySub: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 340,
  },
  courseName: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 16,
    textAlign: 'center',
  },
  courseMeta: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  catPill: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(52,224,111,0.08)',
  },
  catPillTxt: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  segment: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  segCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 6,
  },
  segLabel: { fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  glassCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 3 },
    }),
  },
  glassGlow: {
    position: 'absolute',
    top: -30,
    left: '12%',
    right: '12%',
    height: 56,
    borderRadius: 999,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.35,
  },
  overviewIconRow: { gap: 12 },
  overviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.25)',
    marginBottom: 4,
  },
  overviewLead: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
  },
  divider: { height: 1, marginVertical: 16 },
  miniHead: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  miniBody: { fontSize: 14, lineHeight: 21, fontWeight: '500', marginTop: 6 },
  timelineWrap: { paddingTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'stretch' },
  stepRowSpaced: { marginBottom: 0 },
  stepTrack: {
    width: 40,
    alignItems: 'center',
  },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  stepNumText: { fontSize: 14, fontWeight: '900', color: '#0A0A0A' },
  stepConnector: {
    width: 2,
    flex: 1,
    minHeight: 28,
    marginTop: 6,
    backgroundColor: 'rgba(52,224,111,0.22)',
    borderRadius: 1,
  },
  stepBody: { flex: 1, paddingLeft: 12, paddingBottom: 22 },
  stepTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  stepDesc: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginTop: 5 },
  scoringHint: { fontSize: 13, fontWeight: '700', marginBottom: 12 },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  scoreRowAccent: {
    backgroundColor: 'rgba(52, 224, 111, 0.08)',
  },
  scoreLabel: { fontSize: 14, fontWeight: '600', flex: 1, paddingRight: 12 },
  scoreValue: { fontSize: 14, fontWeight: '800' },
  scoringNote: { fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 4 },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  tipIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.25)',
  },
  tipText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  setRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  setLabel: { fontSize: 12, fontWeight: '700', width: 100 },
  setValue: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18, textAlign: 'right' },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: H_PAD,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaShell: {
    width: '100%',
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: '#34E06F',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.38,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 8 },
    }),
  },
  ctaPressable: {
    width: '100%',
    minHeight: 56,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 56,
    paddingHorizontal: 28,
    width: '100%',
  },
  ctaText: { fontSize: 17, fontWeight: '800', color: '#0A0A0A', letterSpacing: 0.15 },
});
