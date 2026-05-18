import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import type { SocialGameFullDetail } from '@/lib/socialGameDetails';
import { GameCourseSetupSection } from '@/components/gameSetup/GameCourseSetupSection';
import type { GameCourseSetup } from '@/hooks/useGameCourseSetup';
import { getMinTeams, type TeamRoster } from '@/lib/teamGameRoster';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const MAX_TEAMS = 4;

function TeamCard({
  team,
  width,
  colors,
  themeMode,
  canDelete,
  onDelete,
}: {
  team: TeamRoster;
  width: number;
  colors: ReturnType<typeof useAppColors>;
  themeMode: 'light' | 'dark';
  canDelete: boolean;
  onDelete: () => void;
}) {
  const hasYou = team.players.some((p) => p.id === 'p1');
  const cardBg = themeMode === 'dark' ? 'rgba(32, 34, 32, 0.96)' : colors.surfaceAlt;

  return (
    <View style={[styles.teamCard, { width, backgroundColor: cardBg, borderColor: colors.border }]}>
      <View style={styles.teamCardHeader}>
        <View style={styles.teamTitleRow}>
          <View style={[styles.teamDot, { backgroundColor: team.color }]} />
          <Text style={[styles.teamName, { color: colors.text }]} numberOfLines={1}>
            {team.name}
          </Text>
        </View>
        <View style={styles.teamHeaderActions}>
          {hasYou ? (
            <View style={styles.youBadge}>
              <Text style={styles.youBadgeText}>You</Text>
            </View>
          ) : null}
          {canDelete ? (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${team.name}`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.deleteTeamBtn,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.75 : 1,
                  backgroundColor:
                    themeMode === 'dark' ? 'rgba(0, 0, 0, 0.38)' : 'rgba(0, 0, 0, 0.07)',
                },
              ]}
            >
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.teamPlayers}>
        {team.players.map((p) => (
          <View key={p.id} style={styles.teamPlayerRow}>
            <ProfileAvatar
              size="xs"
              imageUri={p.avatarUrl}
              initials={p.initials}
              backgroundColor="rgba(255,255,255,0.06)"
              initialsColor={team.color}
            />
            <View style={styles.teamPlayerText}>
              <Text style={[styles.teamPlayerName, { color: colors.text }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={[styles.teamPlayerHcp, { color: colors.textSecondary }]} numberOfLines={1}>
                Hcp {p.handicap}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function SocialGameTeamPlayTab({
  detail,
  themeMode,
  teams,
  onTeamsChange,
  onStartGame,
  courseSetup,
}: {
  detail: SocialGameFullDetail;
  themeMode: 'light' | 'dark';
  teams: TeamRoster[];
  onTeamsChange: (teams: TeamRoster[]) => void;
  onStartGame: () => void;
  courseSetup: GameCourseSetup;
}) {
  const colors = useAppColors();
  const { width: screenW } = useWindowDimensions();
  const innerW = screenW - 40;
  const cardW = Math.floor((innerW - 10) / 2);
  const minTeams = useMemo(() => getMinTeams(detail.gameId), [detail.gameId]);
  const canRemoveTeams = teams.length > minTeams;

  const onRowTap = useCallback((title: string) => {
    Alert.alert(title, 'Customize this before your round — coming soon.');
  }, []);

  const onEditTeams = useCallback(() => {
    Alert.alert('Edit teams', 'Drag-and-drop team editor coming soon.');
  }, []);

  const onAddTeam = useCallback(() => {
    if (teams.length >= MAX_TEAMS) {
      Alert.alert('Maximum teams', `This format supports up to ${MAX_TEAMS} teams.`);
      return;
    }
    const nextIdx = teams.length;
    onTeamsChange([
      ...teams,
      {
        id: `team-${Date.now()}`,
        name: `Team ${nextIdx + 1}`,
        color: ['#34E06F', '#4A9EFF', '#A78BFA', '#FF9F43'][nextIdx % 4],
        players: [
          {
            id: `t${nextIdx}-p0`,
            name: `Guest ${nextIdx + 1}`,
            handicap: '—',
            initials: 'GW',
          },
        ],
      },
    ]);
  }, [teams, onTeamsChange]);

  const onDeleteTeam = useCallback(
    (teamId: string) => {
      const team = teams.find((t) => t.id === teamId);
      if (!team) return;

      if (team.players.some((p) => p.id === 'p1')) {
        Alert.alert('Cannot remove', 'Your team must stay in the game.');
        return;
      }
      if (teams.length <= minTeams) {
        Alert.alert(
          'Minimum teams',
          `This format needs at least ${minTeams} team${minTeams === 1 ? '' : 's'}.`,
        );
        return;
      }

      Alert.alert('Remove team?', `Remove ${team.name} and its players from this game?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => onTeamsChange(teams.filter((t) => t.id !== teamId)),
        },
      ]);
    },
    [teams, onTeamsChange, minTeams],
  );

  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.root}>
      <GameCourseSetupSection setup={courseSetup} themeMode={themeMode} />

      <View>
        <View style={styles.teamsHeader}>
          <Text style={styles.sectionKicker}>Teams & Players</Text>
          <Pressable onPress={onEditTeams} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
            <Text style={styles.editTeams}>Edit Teams</Text>
          </Pressable>
        </View>

        <View style={styles.teamGrid}>
          {teams.map((team) => {
            const hasYou = team.players.some((p) => p.id === 'p1');
            return (
              <TeamCard
                key={team.id}
                team={team}
                width={cardW}
                colors={colors}
                themeMode={themeMode}
                canDelete={canRemoveTeams && !hasYou}
                onDelete={() => onDeleteTeam(team.id)}
              />
            );
          })}
        </View>

        <Pressable
          onPress={onAddTeam}
          style={({ pressed }) => [
            styles.addTeamBtn,
            {
              borderColor: 'rgba(52,224,111,0.45)',
              backgroundColor: themeMode === 'dark' ? ACCENT_SOFT : 'rgba(52,224,111,0.08)',
              opacity: pressed ? 0.88 : 1,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            },
          ]}
        >
          <View style={styles.addTeamInner}>
            <View style={styles.addTeamIconRing}>
              <Ionicons name="add" size={22} color={ACCENT} />
            </View>
            <Text style={styles.addTeamTxt}>Add Team</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.startGameBtnShell} collapsable={false}>
        <Pressable
          onPress={onStartGame}
          accessibilityRole="button"
          accessibilityLabel="Start Game"
          style={({ pressed }) => [styles.startGameBtnPressable, { opacity: pressed ? 0.92 : 1 }]}
        >
          <View style={styles.startGameBtnInner}>
            <Text style={styles.startGameBtnText}>Start Game</Text>
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: 20,
    gap: 22,
    width: '100%',
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: ACCENT,
  },
  teamsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editTeams: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCENT,
  },
  teamGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  teamCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    minHeight: 168,
  },
  teamCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 6,
  },
  teamHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  deleteTeamBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  teamDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    flex: 1,
  },
  youBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 0.3,
  },
  teamPlayers: { gap: 8 },
  teamPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamPlayerText: { flex: 1, minWidth: 0 },
  teamPlayerName: { fontSize: 13, fontWeight: '700', letterSpacing: -0.1 },
  teamPlayerHcp: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  addTeamBtn: {
    alignSelf: 'stretch',
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  addTeamInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
  },
  addTeamIconRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(52,224,111,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTeamTxt: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.15,
    color: ACCENT,
  },
  startGameBtnShell: {
    width: '100%',
    marginTop: 16,
    marginBottom: 24,
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
  startGameBtnPressable: {
    width: '100%',
    minHeight: 56,
  },
  startGameBtnInner: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 28,
    width: '100%',
  },
  startGameBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: 0.15,
  },
});
