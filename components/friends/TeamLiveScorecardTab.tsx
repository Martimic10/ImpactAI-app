import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { mockApproachDistance } from '@/lib/liveScorecardData';
import type { RuntimeScorecard } from '@/lib/golfCourse/runtimeScorecard';
import type { LiveGameTeam } from '@/lib/liveGameSession';
import type { LiveGameRosterPlayer } from '@/lib/liveGameSession';
import { computeTeamPoints, getTeamGameRules } from '@/lib/teamScorecard';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';

const HOLE_CELL = 34;
const HOLE_CELL_CURRENT = 40;
const ROW_LABEL_W = 44;
const COURSE_GRID_HEADER_H = 20;
const COURSE_GRID_ROW_H = 24;
const SCORE_HOLE_COL_W = 46;

type Colors = ReturnType<typeof useAppColors>;

function GlassSurface({
  children,
  style,
  colors,
  isDark,
}: {
  children: React.ReactNode;
  style?: object;
  colors: Colors;
  isDark: boolean;
}) {
  return (
    <View
      style={[
        ts.glassOuter,
        {
          backgroundColor: isDark ? 'rgba(22,24,22,0.94)' : colors.surface,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function CourseGrid({
  currentHole,
  runtime,
  colors,
  isDark,
}: {
  currentHole: number;
  runtime: RuntimeScorecard;
  colors: Colors;
  isDark: boolean;
}) {
  return (
    <View style={ts.sectionBlock}>
      <Text style={[ts.sectionK, { color: ACCENT }]}>COURSE</Text>
      <GlassSurface colors={colors} isDark={isDark} style={ts.tableCard}>
        <View style={ts.tableRow}>
          <View style={[ts.rowLabelCol, { width: ROW_LABEL_W }]}>
            {(['Hole', 'Par', 'HCP', 'Yds'] as const).map((label, rowIdx) => (
              <View
                key={label}
                style={[
                  ts.courseGridRow,
                  ts.courseGridRowLabel,
                  { height: rowIdx === 0 ? COURSE_GRID_HEADER_H : COURSE_GRID_ROW_H },
                ]}
              >
                <Text style={[ts.tlHead, { color: colors.textMuted }]}>{label}</Text>
              </View>
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ts.hScroll}>
            {runtime.holePar.map((par, i) => {
              const n = runtime.holeNumbers[i] ?? i + 1;
              const cur = n === currentHole;
              const w = cur ? HOLE_CELL_CURRENT : HOLE_CELL;
              return (
                <View key={n} style={[ts.hCol, { width: w }, cur && ts.hColLive]}>
                  <View style={[ts.courseGridRow, ts.courseGridRowCell, { height: COURSE_GRID_HEADER_H }]}>
                    <Text style={[ts.tcTop, { color: cur ? ACCENT : colors.textMuted }]}>{n}</Text>
                  </View>
                  <View style={[ts.courseGridRow, ts.courseGridRowCell, { height: COURSE_GRID_ROW_H }]}>
                    <Text style={[ts.tc, { color: colors.text }]}>{par}</Text>
                  </View>
                  <View style={[ts.courseGridRow, ts.courseGridRowCell, { height: COURSE_GRID_ROW_H }]}>
                    <Text style={[ts.tc, { color: colors.textSecondary }]}>
                      {runtime.holeHandicap[i]}
                    </Text>
                  </View>
                  <View style={[ts.courseGridRow, ts.courseGridRowCell, { height: COURSE_GRID_ROW_H }]}>
                    <Text style={[ts.tcSm, { color: colors.textSecondary }]}>
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
  );
}

function PlayerEnterScoreRow({
  player,
  currentHole,
  strokes,
  runtime,
  colors,
  onOpenScoreEntry,
  avatarColor,
}: {
  player: LiveGameRosterPlayer;
  currentHole: number;
  strokes: Record<string, (number | null)[]>;
  runtime: RuntimeScorecard;
  colors: Colors;
  onOpenScoreEntry: (playerId: string, holeIndex: number) => void;
  avatarColor?: string;
}) {
  return (
    <View style={ts.scorePlayerRow}>
      <ProfileAvatar
        size="xs"
        imageUri={player.avatarUrl}
        initials={player.initials}
        backgroundColor="rgba(255,255,255,0.08)"
        initialsColor={avatarColor ?? ACCENT}
      />

      <View style={ts.scorePlayerMeta}>
        <Text style={[ts.scoreName, { color: colors.text }]} numberOfLines={1}>
          {player.name}
        </Text>
        <Text style={[ts.scoreHcp, { color: colors.textSecondary }]}>Hcp {player.handicap}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={ts.scoreHoleScroll}
        contentContainerStyle={ts.scoreHoleStrip}
      >
        {runtime.holePar.map((_, i) => {
          const n = runtime.holeNumbers[i] ?? i + 1;
          const isCurrent = n === currentHole;
          const isPast = n < currentHole;
          const v = strokes[player.id]?.[i];
          const hasScore = v != null;

          if (isCurrent && !hasScore) {
            return (
              <Pressable
                key={n}
                onPress={() => onOpenScoreEntry(player.id, i)}
                style={({ pressed }) => [
                  ts.scoreHoleCol,
                  { width: SCORE_HOLE_COL_W, opacity: pressed ? 0.88 : 1 },
                ]}
              >
                <View style={ts.enterBox}>
                  <Text style={[ts.enterDash, { color: colors.text }]}>—</Text>
                  <Text
                    style={ts.enterLbl}
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
                onPress={() => onOpenScoreEntry(player.id, i)}
                style={({ pressed }) => [
                  ts.scoreHoleCol,
                  { width: SCORE_HOLE_COL_W, opacity: pressed && isCurrent ? 0.88 : 1 },
                ]}
              >
                {isCurrent ? (
                  <View style={ts.enterBox}>
                    <Text style={[ts.enterScoreVal, { color: colors.text }]}>{v}</Text>
                    <Text style={[ts.enterDist, { color: colors.textMuted }]}>
                      {mockApproachDistance(player.id, i)}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={[ts.holeScoreVal, { color: colors.text }]}>{v}</Text>
                    <Text style={[ts.holeDist, { color: colors.textMuted }]}>
                      {mockApproachDistance(player.id, i)}
                    </Text>
                  </>
                )}
              </Pressable>
            );
          }

          return (
            <View key={n} style={[ts.scoreHoleCol, { width: SCORE_HOLE_COL_W }]}>
              <Text style={[ts.holePending, { color: colors.textSecondary }]}>—</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={ts.scorePtsCol}>
        <Text style={[ts.scorePtsVal, { color: colors.text }]}>0</Text>
        <Text style={ts.scorePtsLbl}>PTS</Text>
      </View>
    </View>
  );
}

function TeamScorecardCard({
  team,
  currentHole,
  strokes,
  runtime,
  colors,
  isDark,
  onOpenScoreEntry,
}: {
  team: LiveGameTeam;
  currentHole: number;
  strokes: Record<string, (number | null)[]>;
  runtime: RuntimeScorecard;
  colors: Colors;
  isDark: boolean;
  onOpenScoreEntry: (playerId: string, holeIndex: number) => void;
}) {
  const hasYou = team.players.some((p) => p.id === 'p1');
  const teamPts = useMemo(
    () => computeTeamPoints(team, strokes, currentHole, runtime.holePar),
    [team, strokes, currentHole, runtime.holePar],
  );

  return (
    <View
      style={[
        ts.scorePlayerCard,
        {
          backgroundColor: isDark ? 'rgba(36,38,36,0.98)' : colors.surface,
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : colors.border,
        },
      ]}
    >
      <View style={ts.teamCardHeader}>
        <View style={ts.teamTitleRow}>
          <View style={[ts.teamDot, { backgroundColor: team.color }]} />
          <Text style={[ts.teamName, { color: colors.text }]} numberOfLines={1}>
            {team.name}
          </Text>
          {hasYou ? (
            <View style={ts.youBadge}>
              <Text style={ts.youBadgeText}>You</Text>
            </View>
          ) : null}
        </View>
        <View style={ts.scorePtsCol}>
          <Text style={[ts.scorePtsVal, { color: team.color }]}>{teamPts}</Text>
          <Text style={[ts.scorePtsLbl, { color: team.color }]}>PTS</Text>
        </View>
      </View>

      <View style={ts.teamPlayerList}>
        {team.players.map((p) => (
          <PlayerEnterScoreRow
            key={p.id}
            player={p}
            currentHole={currentHole}
            strokes={strokes}
            runtime={runtime}
            colors={colors}
            onOpenScoreEntry={onOpenScoreEntry}
            avatarColor={team.color}
          />
        ))}
      </View>
    </View>
  );
}

export function TeamLiveScorecardTab({
  gameId,
  teams,
  currentHole,
  strokes,
  runtime,
  colors,
  isDark,
  onOpenScoreEntry,
  onAddTeam,
}: {
  gameId: string;
  teams: LiveGameTeam[];
  currentHole: number;
  strokes: Record<string, (number | null)[]>;
  runtime: RuntimeScorecard;
  colors: Colors;
  isDark: boolean;
  onOpenScoreEntry: (playerId: string, holeIndex: number) => void;
  onAddTeam?: () => void;
}) {
  const rules = useMemo(() => getTeamGameRules(gameId), [gameId]);

  return (
    <Animated.View entering={FadeIn.duration(200)} style={ts.tabBody}>
      <GlassSurface colors={colors} isDark={isDark} style={ts.rulesCard}>
        <View style={ts.rulesTop}>
          <Text style={ts.rulesTitle}>{rules.title}</Text>
          <Ionicons name="information-circle-outline" size={20} color={ACCENT} />
        </View>
        <Text style={[ts.rulesBody, { color: colors.textSecondary }]}>{rules.body}</Text>
      </GlassSurface>

      <CourseGrid currentHole={currentHole} runtime={runtime} colors={colors} isDark={isDark} />

      <View style={ts.sectionBlock}>
        <Text style={[ts.sectionTitleSm, { color: colors.text }]}>Enter Scores</Text>

        <View style={ts.scorePlayerList}>
          {teams.map((team) => (
            <TeamScorecardCard
              key={team.id}
              team={team}
              currentHole={currentHole}
              strokes={strokes}
              runtime={runtime}
              colors={colors}
              isDark={isDark}
              onOpenScoreEntry={onOpenScoreEntry}
            />
          ))}
        </View>

        {onAddTeam ? (
          <Pressable
            onPress={onAddTeam}
            style={({ pressed }) => [
              ts.addTeam,
              {
                borderColor: ACCENT,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.99 : 1 }],
              },
            ]}
          >
            <View style={ts.addTeamInner}>
              <Ionicons name="add" size={22} color={ACCENT} />
              <Text style={ts.addTeamTxt}>Add Team</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const ts = StyleSheet.create({
  tabBody: { gap: 32, width: '100%' },
  sectionBlock: { gap: 14, width: '100%' },
  sectionTitleSm: { fontSize: 17, fontWeight: '800', letterSpacing: -0.25 },
  sectionK: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginBottom: 2,
  },
  glassOuter: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rulesCard: {
    padding: 16,
    borderRadius: 16,
    borderColor: 'rgba(52,224,111,0.22)',
    backgroundColor: 'rgba(52,224,111,0.06)',
  },
  rulesTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  rulesTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: ACCENT,
    flex: 1,
    paddingRight: 8,
  },
  rulesBody: { fontSize: 13, fontWeight: '600', lineHeight: 19 },
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
  scorePlayerList: { gap: 10, width: '100%', marginTop: 12 },
  scorePlayerCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  teamCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  teamTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  teamName: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
  youBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
  },
  youBadgeText: { fontSize: 10, fontWeight: '800', color: ACCENT },
  teamPlayerList: { gap: 14 },
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
  addTeam: {
    alignSelf: 'stretch',
    marginTop: 2,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(52,224,111,0.05)',
    overflow: 'hidden',
  },
  addTeamInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  addTeamTxt: { fontSize: 15, fontWeight: '800', color: ACCENT },
});
