import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useTheme } from '@/hooks/useTheme';
import { getSocialGameFullDetail, type SocialGameDetailStep } from '@/lib/socialGameDetails';
import { emptyScores, mockApproachDistance, type LiveScorecardPlayer } from '@/lib/liveScorecardData';
import {
  getDefaultActiveScorecard,
  getRuntimeScorecard,
  type RuntimeScorecard,
} from '@/lib/golfCourse/runtimeScorecard';
import {
  DEFAULT_LIVE_GAME_ROSTER,
  getLiveGameCourseSetup,
  getLiveGameRoster,
  getLiveGameTeams,
  isLiveTeamGame,
  rosterToScorecardPlayers,
  type LiveGameTeam,
} from '@/lib/liveGameSession';
import { EnterScoreModal } from '@/components/friends/EnterScoreModal';
import { TeamLiveScorecardTab } from '@/components/friends/TeamLiveScorecardTab';
import { createDefaultTeams, isTeamCategoryGame } from '@/lib/teamGameRoster';
import { computeTeamPoints } from '@/lib/teamScorecard';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.22)';
const TAB_BAR_OVERLAY_HEIGHT = Platform.OS === 'ios' ? 100 : 76;

type ScoreTab = 'scorecard' | 'leaderboard' | 'info';

type Ion = React.ComponentProps<typeof Ionicons>['name'];

const SCORECARD_TABS: { key: ScoreTab; label: string; icon: Ion }[] = [
  { key: 'scorecard', label: 'Scorecard', icon: 'grid-outline' },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'trophy-outline' },
  { key: 'info', label: 'Game Info', icon: 'information-circle-outline' },
];

const HOLE_CELL = 34;
const HOLE_CELL_CURRENT = 40;
const ROW_LABEL_W = 44;
/** Shared row heights so Hole / Par / HCP / Yds line up with each data row. */
const COURSE_GRID_HEADER_H = 20;
const COURSE_GRID_ROW_H = 24;
const SCORE_HOLE_COL_W = 46;

function buildInitialStrokes(
  playerIds: string[],
  holeCount: number,
): Record<string, (number | null)[]> {
  const o: Record<string, (number | null)[]> = {};
  playerIds.forEach((id) => {
    o[id] = emptyScores(holeCount);
  });
  return o;
}

function ScorecardSegmentTab({
  active,
  label,
  icon,
  iconMuted,
  labelMuted,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: Ion;
  iconMuted: string;
  labelMuted: string;
  onPress: () => void;
}) {
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
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
    <TouchableOpacity onPress={onPress} activeOpacity={0.92} style={{ flex: 1 }}>
      <Animated.View
        style={[s.segmentCell, { shadowColor: ACCENT, borderWidth: 1.5 }, shell]}
      >
        <Ionicons name={icon} size={16} color={active ? ACCENT : iconMuted} />
        <Text
          style={[s.segmentLabel, { color: active ? ACCENT : labelMuted }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function InfoStepTimeline({
  steps,
  textColor,
  muted,
}: {
  steps: SocialGameDetailStep[];
  textColor: string;
  muted: string;
}) {
  return (
    <View style={s.infoTimeline}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <View key={step.title} style={s.infoStepRow}>
            <View style={s.infoStepTrack}>
              <View style={s.infoStepNum}>
                <Text style={s.infoStepNumTxt}>{i + 1}</Text>
              </View>
              {!last ? <View style={s.infoStepConnector} /> : null}
            </View>
            <View style={s.infoStepBody}>
              <Text style={[s.infoStepTitle, { color: textColor }]}>{step.title}</Text>
              <Text style={[s.infoStepDesc, { color: muted }]}>{step.description}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function GlassSurface({
  children,
  style,
  glow,
  colors,
  isDark,
}: {
  children: React.ReactNode;
  style?: object;
  glow?: boolean;
  colors: ReturnType<typeof useAppColors>;
  isDark: boolean;
}) {
  return (
    <View
      style={[
        s.glassOuter,
        {
          backgroundColor: isDark ? 'rgba(22,24,22,0.94)' : colors.surface,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
        },
        style,
      ]}
    >
      {glow ? <View pointerEvents="none" style={s.glassGlow} /> : null}
      {children}
    </View>
  );
}

export function LiveGameScorecardScreen({ gameId }: { gameId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const detail = useMemo(() => getSocialGameFullDetail(gameId), [gameId]);
  const gameTitle = detail?.title ?? 'Live Game';
  const scoringLabel = detail?.settings.find((x) => x.label === 'Scoring')?.value ?? 'Points (CTP table)';

  const courseSetup = useMemo(
    () => getLiveGameCourseSetup(gameId) ?? getDefaultActiveScorecard(),
    [gameId],
  );
  const runtime: RuntimeScorecard = useMemo(
    () => getRuntimeScorecard(courseSetup),
    [courseSetup],
  );
  const holeCount = runtime.holeCount;

  const initialPlayers = useMemo(() => {
    const roster = getLiveGameRoster(gameId) ?? DEFAULT_LIVE_GAME_ROSTER;
    return rosterToScorecardPlayers(roster);
  }, [gameId]);

  const initialTeams = useMemo((): LiveGameTeam[] | null => {
    const fromSession = getLiveGameTeams(gameId);
    if (fromSession?.length) return fromSession;
    if (detail && isTeamCategoryGame(detail.category)) {
      return createDefaultTeams(detail.gameId);
    }
    return null;
  }, [gameId, detail]);

  const isTeamGame = isLiveTeamGame(gameId) || (initialTeams != null && initialTeams.length > 0);

  const [tab, setTab] = useState<ScoreTab>('scorecard');
  const [currentHole, setCurrentHole] = useState(1);
  const [players, setPlayers] = useState<LiveScorecardPlayer[]>(initialPlayers);
  const [teams] = useState<LiveGameTeam[]>(initialTeams ?? []);

  const [strokes, setStrokes] = useState<Record<string, (number | null)[]>>(() => {
    const ids =
      initialTeams != null && initialTeams.length > 0
        ? initialTeams.flatMap((t) => t.players.map((p) => p.id))
        : initialPlayers.map((p) => p.id);
    return buildInitialStrokes(ids, holeCount);
  });
  const [scoreEntry, setScoreEntry] = useState<{ playerId: string; holeIndex: number } | null>(
    null
  );
  const [draftScore, setDraftScore] = useState(4);

  const scrollBottomPad =
    tab === 'scorecard' ? 20 : TAB_BAR_OVERLAY_HEIGHT + Math.max(insets.bottom, 12) + 24;
  const atFirstHole = currentHole <= 1;
  const atLastHole = currentHole >= holeCount;

  const ranked = useMemo(() => {
    return [...players].sort((a, b) => b.points - a.points);
  }, [players]);

  const rankedTeams = useMemo(() => {
    if (!isTeamGame || teams.length === 0) return [];
    return [...teams]
      .map((t) => ({
        team: t,
        points: computeTeamPoints(t, strokes, currentHole, runtime.holePar),
      }))
      .sort((a, b) => b.points - a.points);
  }, [isTeamGame, teams, strokes, currentHole, runtime.holePar]);

  const leaderId = ranked[0]?.id;
  const leaderTeamId = rankedTeams[0]?.team.id;

  const setStrokeAtHole = useCallback((playerId: string, holeIndex: number, value: number) => {
    setStrokes((prev) => {
      const row = [...(prev[playerId] ?? emptyScores())];
      row[holeIndex] = Math.max(1, Math.min(15, value));
      return { ...prev, [playerId]: row };
    });
  }, []);

  const openScoreEntry = useCallback(
    (playerId: string, holeIndex: number) => {
      const n = holeIndex + 1;
      if (n > currentHole) return;
      const row = strokes[playerId] ?? emptyScores();
      const par = runtime.holePar[holeIndex] ?? 4;
      const cur = row[holeIndex];
      setScoreEntry({ playerId, holeIndex });
      setDraftScore(cur ?? par);
    },
    [currentHole, strokes, runtime.holePar]
  );

  const closeScoreEntry = useCallback(() => setScoreEntry(null), []);

  const saveScoreEntry = useCallback(() => {
    if (!scoreEntry) return;
    setStrokeAtHole(scoreEntry.playerId, scoreEntry.holeIndex, draftScore);
    setScoreEntry(null);
  }, [draftScore, scoreEntry, setStrokeAtHole]);

  const scoreEntryPlayer = useMemo(() => {
    if (!scoreEntry) return null;
    const solo = players.find((p) => p.id === scoreEntry.playerId);
    if (solo) return solo;
    for (const team of teams) {
      const roster = team.players.find((p) => p.id === scoreEntry.playerId);
      if (roster) {
        return { ...roster, points: 0, delta: 0 } satisfies LiveScorecardPlayer;
      }
    }
    return null;
  }, [players, scoreEntry, teams]);

  const onAddTeam = useCallback(() => {
    Alert.alert('Add team', 'Add teams from game setup before you start — coming soon mid-round.');
  }, []);

  const addGuest = useCallback(() => {
    const n = players.length + 1;
    const id = `guest-${Date.now()}`;
    setPlayers((prev) => [
      ...prev,
      {
        id,
        name: `Guest ${n}`,
        handicap: '—',
        initials: 'GW',
        points: 0,
        delta: 0,
      },
    ]);
    setStrokes((prev) => ({ ...prev, [id]: emptyScores(holeCount) }));
  }, [players.length, holeCount]);

  const prevHole = useCallback(() => {
    setCurrentHole((h) => Math.max(1, h - 1));
  }, []);

  const nextHole = useCallback(() => {
    setCurrentHole((h) => Math.min(holeCount, h + 1));
  }, [holeCount]);

  const holeIdx = currentHole - 1;
  const currentPar = runtime.holePar[holeIdx] ?? 4;

  const holeNavRail = (
    <View
      style={[
        s.holeNavRail,
        {
          borderColor: isDark ? 'rgba(255,255,255,0.12)' : colors.border,
          backgroundColor: isDark ? 'rgba(28,30,28,0.96)' : colors.surfaceAlt,
        },
      ]}
    >
      <View
        style={[
          s.navPrevShell,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
            borderColor: isDark ? 'rgba(255,255,255,0.18)' : colors.border,
            opacity: atFirstHole ? 0.4 : 1,
          },
        ]}
        collapsable={false}
      >
        <Pressable
          onPress={prevHole}
          disabled={atFirstHole}
          style={({ pressed }) => [s.navPrevPressable, { opacity: pressed && !atFirstHole ? 0.8 : 1 }]}
        >
          <Text style={[s.navPrevTxt, { color: colors.textSecondary }]} numberOfLines={1}>
            Previous Hole
          </Text>
        </Pressable>
      </View>

      <Text style={[s.navCenter, { color: colors.text }]} numberOfLines={1}>
        Hole {currentHole} of 18
      </Text>

      <View style={[s.navNextShell, { opacity: atLastHole ? 0.4 : 1 }]} collapsable={false}>
        <Pressable
          onPress={nextHole}
          disabled={atLastHole}
          style={({ pressed }) => [
            s.navNextPressable,
            {
              opacity: pressed && !atLastHole ? 0.9 : 1,
              transform: [{ scale: pressed && !atLastHole ? 0.98 : 1 }],
            },
          ]}
        >
          <Text style={s.navNextTxt} numberOfLines={1}>
            Next Hole
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[s.root, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={s.screenBody}>
      <ScrollView
        style={s.scrollFlex}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scrollPad, { paddingBottom: scrollBottomPad }]}
      >
        {/* —— Header row —— */}
        <View style={s.headerRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [s.backCircle, { borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>

          <View style={s.headerCenter}>
            <View style={s.liveRow}>
              <View style={s.liveDot} />
              <Text style={s.liveTxt}>LIVE GAME</Text>
            </View>
            <Text style={[s.gameTitle, { color: colors.text }]} numberOfLines={2}>
              {gameTitle}
            </Text>
            <Text style={[s.courseLine, { color: colors.textSecondary }]} numberOfLines={2}>
              {runtime.courseName}
            </Text>
            <Text style={[s.metaLine, { color: colors.textMuted }]}>{runtime.metaLine}</Text>
          </View>

          <GlassSurface colors={colors} isDark={isDark} style={s.holeCard} glow>
            <Text style={s.holeCardK}>HOLE {currentHole}</Text>
            <Text style={[s.holeCardPar, { color: colors.text }]}>PAR {currentPar}</Text>
          </GlassSurface>
        </View>

        {/* —— Segments — same pattern as Social / game detail —— */}
        <View style={[s.segment, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          {SCORECARD_TABS.map(({ key, label, icon }) => (
            <ScorecardSegmentTab
              key={key}
              active={tab === key}
              label={label}
              icon={icon}
              iconMuted={colors.textMuted}
              labelMuted={colors.textSecondary}
              onPress={() => setTab(key)}
            />
          ))}
        </View>

        {tab === 'scorecard' && isTeamGame && teams.length > 0 ? (
          <TeamLiveScorecardTab
            gameId={gameId}
            teams={teams}
            currentHole={currentHole}
            strokes={strokes}
            runtime={runtime}
            colors={colors}
            isDark={isDark}
            onOpenScoreEntry={openScoreEntry}
            onAddTeam={onAddTeam}
          />
        ) : null}

        {tab === 'scorecard' && !isTeamGame ? (
          <Animated.View entering={FadeIn.duration(200)} style={s.tabBody}>
            {/* Course grid */}
            <View style={s.sectionBlock}>
              <Text style={[s.sectionK, { color: ACCENT }]}>COURSE</Text>
              <GlassSurface colors={colors} isDark={isDark} style={s.tableCard}>
              <View style={s.tableRow}>
                <View style={[s.rowLabelCol, { width: ROW_LABEL_W }]}>
                  {(['Hole', 'Par', 'HCP', 'Yds'] as const).map((label, rowIdx) => (
                    <View
                      key={label}
                      style={[
                        s.courseGridRow,
                        s.courseGridRowLabel,
                        { height: rowIdx === 0 ? COURSE_GRID_HEADER_H : COURSE_GRID_ROW_H },
                      ]}
                    >
                      <Text style={[s.tlHead, { color: colors.textMuted }]}>{label}</Text>
                    </View>
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hScroll}>
                  {runtime.holePar.map((par, i) => {
                    const n = runtime.holeNumbers[i] ?? i + 1;
                    const cur = n === currentHole;
                    const w = cur ? HOLE_CELL_CURRENT : HOLE_CELL;
                    return (
                      <View key={n} style={[s.hCol, { width: w }, cur && s.hColLive]}>
                        <View style={[s.courseGridRow, s.courseGridRowCell, { height: COURSE_GRID_HEADER_H }]}>
                          <Text style={[s.tcTop, { color: cur ? ACCENT : colors.textMuted }]}>{n}</Text>
                        </View>
                        <View style={[s.courseGridRow, s.courseGridRowCell, { height: COURSE_GRID_ROW_H }]}>
                          <Text style={[s.tc, { color: colors.text }]}>{par}</Text>
                        </View>
                        <View style={[s.courseGridRow, s.courseGridRowCell, { height: COURSE_GRID_ROW_H }]}>
                          <Text style={[s.tc, { color: colors.textSecondary }]}>
                            {runtime.holeHandicap[i]}
                          </Text>
                        </View>
                        <View style={[s.courseGridRow, s.courseGridRowCell, { height: COURSE_GRID_ROW_H }]}>
                          <Text style={[s.tcSm, { color: colors.textSecondary }]}>
                            {runtime.holeYards[i]}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </GlassSurface>
            </View>

            {/* Enter scores */}
            <View style={s.sectionBlock}>
              <Text style={[s.sectionTitleSm, { color: colors.text }]}>Enter Scores</Text>

              <View style={s.scorePlayerList}>
                {players.map((p) => (
                  <View
                    key={p.id}
                    style={[
                      s.scorePlayerCard,
                      {
                        backgroundColor: isDark ? 'rgba(36,38,36,0.98)' : colors.surface,
                        borderColor: isDark ? 'rgba(255,255,255,0.06)' : colors.border,
                      },
                    ]}
                  >
                    <View style={s.scorePlayerRow}>
                      <ProfileAvatar
                        size="xs"
                        imageUri={p.avatarUrl}
                        initials={p.initials}
                        backgroundColor="rgba(255,255,255,0.08)"
                      />

                      <View style={s.scorePlayerMeta}>
                        <Text style={[s.scoreName, { color: colors.text }]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={[s.scoreHcp, { color: colors.textSecondary }]}>
                          Hcp {p.handicap}
                        </Text>
                      </View>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={s.scoreHoleScroll}
                        contentContainerStyle={s.scoreHoleStrip}
                      >
                        {runtime.holePar.map((_, i) => {
                          const n = i + 1;
                          const isCurrent = n === currentHole;
                          const isPast = n < currentHole;
                          const v = strokes[p.id]?.[i];
                          const hasScore = v != null;

                          if (isCurrent && !hasScore) {
                            return (
                              <Pressable
                                key={n}
                                onPress={() => openScoreEntry(p.id, i)}
                                style={({ pressed }) => [
                                  s.scoreHoleCol,
                                  { width: SCORE_HOLE_COL_W, opacity: pressed ? 0.88 : 1 },
                                ]}
                              >
                                <View style={s.enterBox}>
                                  <Text style={[s.enterDash, { color: colors.text }]}>—</Text>
                                  <Text
                                    style={s.enterLbl}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.85}
                                  >
                                    Enter
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          }

                          if ((isPast || isCurrent) && hasScore) {
                            return (
                              <Pressable
                                key={n}
                                onPress={() => openScoreEntry(p.id, i)}
                                style={({ pressed }) => [
                                  s.scoreHoleCol,
                                  { width: SCORE_HOLE_COL_W, opacity: pressed && isCurrent ? 0.88 : 1 },
                                ]}
                              >
                                {isCurrent ? (
                                  <View style={s.enterBox}>
                                    <Text style={[s.enterScoreVal, { color: colors.text }]}>{v}</Text>
                                    <Text style={[s.enterDist, { color: colors.textMuted }]}>
                                      {mockApproachDistance(p.id, i)}
                                    </Text>
                                  </View>
                                ) : (
                                  <>
                                    <Text style={[s.holeScoreVal, { color: colors.text }]}>{v}</Text>
                                    <Text style={[s.holeDist, { color: colors.textMuted }]}>
                                      {mockApproachDistance(p.id, i)}
                                    </Text>
                                  </>
                                )}
                              </Pressable>
                            );
                          }

                          return (
                            <View key={n} style={[s.scoreHoleCol, { width: SCORE_HOLE_COL_W }]}>
                              <Text style={[s.holePending, { color: colors.textSecondary }]}>—</Text>
                            </View>
                          );
                        })}
                      </ScrollView>

                      <View style={s.scorePtsCol}>
                        <Text style={[s.scorePtsVal, { color: colors.text }]}>{p.points}</Text>
                        <Text style={s.scorePtsLbl}>PTS</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={s.sectionBlock}>
            <GlassSurface colors={colors} isDark={isDark} style={s.modeCard}>
              <Ionicons name="trophy-outline" size={18} color={ACCENT} />
              <View style={{ flex: 1 }}>
                <Text style={[s.modeLbl, { color: colors.textMuted }]}>Scoring</Text>
                <Text style={[s.modeVal, { color: colors.text }]} numberOfLines={2}>
                  {scoringLabel}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </GlassSurface>

            <Pressable
              onPress={addGuest}
              style={({ pressed }) => [
                s.addPlayer,
                {
                  borderColor: ACCENT,
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                },
              ]}
            >
              <View style={s.addPlayerInner}>
                <Ionicons name="add" size={22} color={ACCENT} />
                <Text style={s.addPlayerTxt}>Add Player</Text>
              </View>
            </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {tab === 'leaderboard' ? (
          <Animated.View entering={FadeIn.duration(200)} style={s.tabBody}>
            <Text style={[s.sectionTitle, { color: colors.text, marginBottom: 4 }]}>
              {isTeamGame ? 'Team standings' : 'Live standings'}
            </Text>
            <View style={s.playerList}>
            {isTeamGame && rankedTeams.length > 0
              ? rankedTeams.map(({ team, points }, i) => {
                  const hasYou = team.players.some((p) => p.id === 'p1');
                  const isLeader = team.id === leaderTeamId;
                  return (
                    <GlassSurface
                      colors={colors}
                      isDark={isDark}
                      key={team.id}
                      style={[s.lbRow, isLeader && s.playerCardLeader]}
                      glow={isLeader}
                    >
                      <Text style={[s.lbRank, { color: ACCENT }]}>{i + 1}</Text>
                      <ProfileAvatar
                        size="xs"
                        imageUri={team.players.find((pl) => pl.avatarUrl)?.avatarUrl ?? team.players[0]?.avatarUrl}
                        initials={team.players[0]?.initials ?? 'TM'}
                        backgroundColor="rgba(255,255,255,0.08)"
                        initialsColor={team.color}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={s.nameRow}>
                          <Text style={[s.pName, { color: colors.text }]}>{team.name}</Text>
                          {hasYou ? (
                            <View style={s.leaderPill}>
                              <Text style={s.leaderPillTxt}>YOU</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={[s.pHcp, { color: colors.textSecondary }]}>
                          {team.players.length} player{team.players.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[s.ptsVal, { color: team.color }]}>{points}</Text>
                        <Text style={[s.ptsLbl, { color: colors.textMuted }]}>PTS</Text>
                      </View>
                    </GlassSurface>
                  );
                })
              : ranked.map((p, i) => (
              <GlassSurface colors={colors} isDark={isDark} key={p.id} style={[s.lbRow, p.id === leaderId && s.playerCardLeader]} glow={p.id === leaderId}>
                <Text style={[s.lbRank, { color: ACCENT }]}>{i + 1}</Text>
                <ProfileAvatar
                  size="xs"
                  imageUri={p.avatarUrl}
                  initials={p.initials}
                  backgroundColor="rgba(255,255,255,0.08)"
                />
                <View style={{ flex: 1 }}>
                  <Text style={[s.pName, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[s.pHcp, { color: colors.textSecondary }]}>Hcp {p.handicap}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.ptsVal, { color: colors.text }]}>{p.points}</Text>
                  {p.delta !== 0 ? (
                    <Text style={[s.delta, { color: p.delta > 0 ? ACCENT : '#FF6B6B' }]}>
                      {p.delta > 0 ? `+${p.delta}` : p.delta}
                    </Text>
                  ) : null}
                </View>
              </GlassSurface>
            ))}
            </View>
          </Animated.View>
        ) : null}

        {tab === 'info' ? (
          <Animated.View entering={FadeIn.duration(200)} style={s.infoTabRoot}>
            {detail ? (
              <>
                <View style={s.infoSection}>
                  <Text style={[s.infoKicker, { color: colors.textMuted }]}>Overview</Text>
                  <GlassSurface colors={colors} isDark={isDark} style={s.infoCardPad}>
                    <View style={s.infoOverviewIcon}>
                      <Ionicons name="information-circle-outline" size={22} color={ACCENT} />
                    </View>
                    <Text style={[s.infoOverviewLead, { color: colors.text }]}>{detail.overview}</Text>
                    <View style={[s.infoDivider, { backgroundColor: 'rgba(52,224,111,0.12)' }]} />
                    <Text style={[s.infoMiniHead, { color: colors.text }]}>Objective</Text>
                    <Text style={[s.infoMiniBody, { color: colors.textSecondary }]}>{detail.objective}</Text>
                    <Text style={[s.infoMiniHead, { color: colors.text, marginTop: 14 }]}>Who wins</Text>
                    <Text style={[s.infoMiniBody, { color: colors.textSecondary }]}>{detail.whoWins}</Text>
                  </GlassSurface>
                </View>

                <View style={s.infoSection}>
                  <Text style={[s.infoKicker, { color: colors.textMuted }]}>How to play</Text>
                  <GlassSurface colors={colors} isDark={isDark} style={s.infoCardPad}>
                    <InfoStepTimeline
                      steps={detail.steps.slice(0, 4)}
                      textColor={colors.text}
                      muted={colors.textSecondary}
                    />
                  </GlassSurface>
                </View>

                <View style={s.infoSection}>
                  <Text style={[s.infoKicker, { color: colors.textMuted }]}>Scoring</Text>
                  <GlassSurface colors={colors} isDark={isDark} style={s.infoCardPad}>
                    <Text style={[s.infoScoringHeadline, { color: colors.textSecondary }]}>
                      {detail.scoringHeadline}
                    </Text>
                    {detail.scoringRows.map((row) => (
                      <View
                        key={row.label}
                        style={[
                          s.infoScoreRow,
                          row.accent && s.infoScoreRowAccent,
                          { borderColor: 'rgba(52,224,111,0.2)' },
                        ]}
                      >
                        <Text style={[s.infoScoreLabel, { color: colors.text }]}>{row.label}</Text>
                        <Text
                          style={[
                            s.infoScoreValue,
                            { color: row.accent ? ACCENT : colors.textSecondary },
                          ]}
                        >
                          {row.value}
                        </Text>
                      </View>
                    ))}
                    {detail.scoringNote ? (
                      <Text style={[s.infoScoringNote, { color: colors.textMuted }]}>
                        {detail.scoringNote}
                      </Text>
                    ) : null}
                  </GlassSurface>
                </View>
              </>
            ) : (
              <Text style={{ color: colors.textMuted }}>Game details unavailable.</Text>
            )}
          </Animated.View>
        ) : null}
      </ScrollView>

      {tab === 'scorecard' ? (
        <View
          style={[
            s.holeNavDock,
            {
              paddingBottom: TAB_BAR_OVERLAY_HEIGHT,
              backgroundColor: colors.background,
            },
          ]}
        >
          {holeNavRail}
        </View>
      ) : null}
      </View>

      <EnterScoreModal
        visible={scoreEntry != null}
        playerName={scoreEntryPlayer?.name ?? 'Player'}
        holeNumber={scoreEntry ? scoreEntry.holeIndex + 1 : currentHole}
        par={scoreEntry ? (runtime.holePar[scoreEntry.holeIndex] ?? 4) : currentPar}
        value={draftScore}
        onChange={setDraftScore}
        onSave={saveScoreEntry}
        onClose={closeScoreEntry}
        isDark={isDark}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  screenBody: { flex: 1 },
  scrollFlex: { flex: 1 },
  scrollPad: { paddingHorizontal: 20, paddingTop: 12, gap: 28 },
  tabBody: { gap: 32, width: '100%' },
  sectionBlock: { gap: 14, width: '100%' },
  playerList: { gap: 16, width: '100%', marginTop: 4 },
  scorePlayerList: { gap: 10, width: '100%', marginTop: 12 },
  scorePlayerCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  scorePlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scorePlayerMeta: { width: 72, flexShrink: 0 },
  scoreName: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  scoreHcp: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  scoreHoleScroll: { flex: 1, minWidth: 0 },
  scoreHoleStrip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 },
  scoreHoleCol: { alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  enterBox: {
    width: 44,
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(52,224,111,0.04)',
  },
  enterDash: { fontSize: 16, fontWeight: '700', lineHeight: 18 },
  enterLbl: {
    fontSize: 7,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 0.15,
    lineHeight: 9,
    marginTop: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    maxWidth: 38,
  },
  enterScoreVal: { fontSize: 17, fontWeight: '800', lineHeight: 20 },
  enterDist: { fontSize: 9, fontWeight: '600', marginTop: 3, lineHeight: 12 },
  holeScoreVal: { fontSize: 17, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
  holeDist: { fontSize: 9, fontWeight: '600', marginTop: 3, lineHeight: 12, textAlign: 'center' },
  holePending: { fontSize: 16, fontWeight: '600', lineHeight: 20 },
  scorePtsCol: { alignItems: 'flex-end', minWidth: 36, paddingLeft: 4 },
  scorePtsVal: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4, lineHeight: 22 },
  scorePtsLbl: { fontSize: 10, fontWeight: '900', color: ACCENT, letterSpacing: 0.5, marginTop: 2 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 4,
  },
  backCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 6 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  liveTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: ACCENT },
  gameTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  courseLine: { fontSize: 13, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  metaLine: { fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  holeCard: {
    width: 86,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
    backgroundColor: 'rgba(32,34,32,0.96)',
  },
  holeCardK: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1, color: ACCENT },
  holeCardPar: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  glassOuter: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  glassGlow: {
    position: 'absolute',
    top: -24,
    left: '15%',
    right: '15%',
    height: 48,
    borderRadius: 999,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.35,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    gap: 4,
    marginTop: 2,
  },
  segmentCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  segmentLabel: { fontSize: 12, fontWeight: '800', letterSpacing: -0.15, flexShrink: 1 },
  sectionK: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  sectionTitleSm: { fontSize: 17, fontWeight: '800', letterSpacing: -0.25 },
  sectionSub: { fontSize: 13, fontWeight: '600', marginTop: 8, lineHeight: 20 },
  tableCard: { paddingVertical: 16, paddingLeft: 12, paddingRight: 8, marginTop: 4 },
  tableRow: { flexDirection: 'row', alignItems: 'stretch' },
  rowLabelCol: { paddingVertical: 8, paddingRight: 8, justifyContent: 'flex-start' },
  courseGridRow: { justifyContent: 'center', width: '100%' },
  courseGridRowLabel: { alignItems: 'flex-end' },
  courseGridRowCell: { alignItems: 'center' },
  tlHead: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2, lineHeight: 12 },
  hScroll: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 12 },
  hCol: {
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    marginHorizontal: 3,
  },
  hColLive: {
    backgroundColor: 'rgba(52,224,111,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.45)',
  },
  tcTop: { fontSize: 11, fontWeight: '900', lineHeight: 14, textAlign: 'center' },
  tc: { fontSize: 12, fontWeight: '700', lineHeight: 15, textAlign: 'center' },
  tcSm: { fontSize: 10, fontWeight: '600', lineHeight: 13, textAlign: 'center' },
  playerCard: {
    padding: 18,
    borderRadius: 20,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  playerCardLeader: {
    borderColor: 'rgba(52,224,111,0.45)',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.22,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 6 },
    }),
  },
  playerTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1.5,
    borderColor: 'rgba(52,224,111,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSm: { width: 40, height: 40, borderRadius: 20 },
  avatarLeader: {
    borderColor: ACCENT,
    ...Platform.select({
      ios: { shadowColor: ACCENT, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
      android: { elevation: 4 },
    }),
  },
  avatarTxt: { fontSize: 14, fontWeight: '900', color: ACCENT },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pName: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
  pHcp: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  leaderPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(52,224,111,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.4)',
  },
  leaderPillTxt: { fontSize: 9, fontWeight: '900', color: ACCENT, letterSpacing: 0.6 },
  pointsCol: { alignItems: 'flex-end', minWidth: 72 },
  ptsVal: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  ptsLbl: { fontSize: 10, fontWeight: '700', marginTop: -2 },
  delta: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  stand: { fontSize: 11, fontWeight: '900', marginTop: 4 },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 16,
  },
  modeLbl: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  modeVal: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  addPlayer: {
    alignSelf: 'stretch',
    marginTop: 2,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(52,224,111,0.05)',
    overflow: 'hidden',
  },
  addPlayerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
  },
  addPlayerTxt: { fontSize: 15, fontWeight: '800', color: ACCENT },
  infoTabRoot: { gap: 22, width: '100%' },
  infoSection: { gap: 10, width: '100%' },
  infoKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  infoCardPad: { padding: 20, borderRadius: 18 },
  infoOverviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.25)',
    marginBottom: 12,
  },
  infoOverviewLead: { fontSize: 15, lineHeight: 23, fontWeight: '600' },
  infoDivider: { height: 1, marginVertical: 16 },
  infoMiniHead: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  infoMiniBody: { fontSize: 14, lineHeight: 21, fontWeight: '500', marginTop: 6 },
  infoTimeline: { paddingTop: 4 },
  infoStepRow: { flexDirection: 'row', alignItems: 'stretch' },
  infoStepTrack: { width: 40, alignItems: 'center' },
  infoStepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  infoStepNumTxt: { fontSize: 14, fontWeight: '900', color: '#0A0A0A' },
  infoStepConnector: {
    width: 2,
    flex: 1,
    minHeight: 28,
    marginTop: 6,
    backgroundColor: 'rgba(52,224,111,0.22)',
    borderRadius: 1,
  },
  infoStepBody: { flex: 1, paddingLeft: 12, paddingBottom: 22 },
  infoStepTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  infoStepDesc: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginTop: 5 },
  infoScoringHeadline: { fontSize: 13, fontWeight: '700', marginBottom: 12 },
  infoScoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  infoScoreRowAccent: { backgroundColor: 'rgba(52, 224, 111, 0.08)' },
  infoScoreLabel: { fontSize: 14, fontWeight: '600', flex: 1, paddingRight: 12 },
  infoScoreValue: { fontSize: 14, fontWeight: '800' },
  infoScoringNote: { fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 4 },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 16,
  },
  lbRank: { fontSize: 18, fontWeight: '900', width: 28, textAlign: 'center' },
  teamLbDot: { width: 14, height: 14, borderRadius: 7 },
  holeNavDock: {
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  holeNavRail: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 52,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  navPrevShell: {
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    minWidth: 118,
    minHeight: 42,
    justifyContent: 'center',
  },
  navPrevPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 42,
  },
  navPrevTxt: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  navCenter: {
    flex: 1,
    minWidth: 80,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 8,
    letterSpacing: -0.1,
  },
  navNextShell: {
    borderRadius: 999,
    backgroundColor: '#34E06F',
    flexShrink: 0,
    minWidth: 118,
    minHeight: 42,
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
    }),
  },
  navNextPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 22,
    minHeight: 42,
  },
  navNextTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
});
