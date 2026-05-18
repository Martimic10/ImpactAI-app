import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import type { SocialGameFullDetail } from '@/lib/socialGameDetails';
import type { LiveGameRosterPlayer } from '@/lib/liveGameSession';
import { GameCourseSetupSection } from '@/components/gameSetup/GameCourseSetupSection';
import type { GameCourseSetup } from '@/hooks/useGameCourseSetup';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.18)';

export type PlayTabPlayer = LiveGameRosterPlayer;

function PlayGlassCard({
  children,
  themeMode,
  style,
  surface = 'default',
}: {
  children: React.ReactNode;
  themeMode: 'light' | 'dark';
  style?: object;
  surface?: 'default' | 'setup';
}) {
  const bg =
    surface === 'setup'
      ? themeMode === 'dark'
        ? 'rgba(32, 34, 32, 0.96)'
        : 'rgba(255,255,255,0.97)'
      : themeMode === 'dark'
        ? 'rgba(22, 24, 22, 0.92)'
        : 'rgba(255,255,255,0.94)';
  const border =
    surface === 'setup'
      ? themeMode === 'dark'
        ? 'rgba(255,255,255,0.07)'
        : 'rgba(0,0,0,0.08)'
      : 'rgba(52,224,111,0.16)';
  return (
    <View
      style={[
        playStyles.glass,
        surface === 'setup' && playStyles.glassSetup,
        surface === 'setup' && playStyles.glassSetupInner,
        { backgroundColor: bg, borderColor: border },
        style,
      ]}
    >
      {surface === 'default' ? <View pointerEvents="none" style={playStyles.glassGlow} /> : null}
      {children}
    </View>
  );
}

function ChevronSettingRow({
  label,
  value,
  onPress,
  colors,
  themeMode,
  showDivider,
}: {
  label: string;
  value: string;
  onPress: () => void;
  colors: ReturnType<typeof useAppColors>;
  themeMode: 'light' | 'dark';
  showDivider: boolean;
}) {
  const chevronColor =
    themeMode === 'dark' ? 'rgba(52, 224, 111, 0.8)' : ACCENT;

  return (
    <>
      {showDivider ? <View style={playStyles.setupDivider} /> : null}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          playStyles.chevronRowOuter,
          playStyles.chevronRowOuterSetup,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={playStyles.chevronRowInner}>
          <View style={playStyles.chevronTextBlock}>
            <Text
              style={[playStyles.setupLabel, { color: colors.textSecondary }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {label}
            </Text>
            <Text
              style={[playStyles.setupValue, { color: colors.text }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {value}
            </Text>
          </View>
          <View style={playStyles.chevronTrailing}>
            <Ionicons name="chevron-forward" size={20} color={chevronColor} />
          </View>
        </View>
      </Pressable>
    </>
  );
}

export function SocialGamePlayTab({
  detail,
  themeMode,
  players,
  onPlayersChange,
  onStartGame,
  courseSetup,
}: {
  detail: SocialGameFullDetail;
  themeMode: 'light' | 'dark';
  players: PlayTabPlayer[];
  onPlayersChange: (players: PlayTabPlayer[]) => void;
  onStartGame: () => void;
  courseSetup: GameCourseSetup;
}) {
  const colors = useAppColors();

  const formatPlay = useMemo(
    () => detail.settings.find((s) => s.label === 'Format')?.value ?? 'Stroke Play',
    [detail.settings]
  );

  const gameSettingsRows = useMemo(
    () => [
      { key: 'format', label: 'Format', value: formatPlay },
      { key: 'scoring', label: 'Scoring', value: 'Points (CTP table)' },
      { key: 'hcp', label: 'Handicaps', value: 'Net — full course' },
      { key: 'teebox', label: 'Tee box', value: courseSetup.setup.teeSet?.name ?? 'Select tees' },
      { key: 'date', label: 'Date', value: 'Today · 2:10 PM' },
      { key: 'tie', label: 'Tie handling', value: 'Split points' },
      { key: 'entry', label: 'Score entry', value: 'Hole by hole' },
    ],
    [formatPlay, courseSetup.setup.teeSet?.name],
  );

  const onGameSettingTap = useCallback((title: string) => {
    Alert.alert(title, 'Customize this before your round — coming soon.');
  }, []);

  const addPlayer = useCallback(() => {
    const n = players.length + 1;
    onPlayersChange([
      ...players,
      {
        id: `p-${Date.now()}`,
        name: `Guest ${n}`,
        handicap: '—',
        initials: 'GW',
      },
    ]);
  }, [players, onPlayersChange]);

  const removePlayer = useCallback(
    (id: string) => {
      if (id === 'p1') {
        Alert.alert('Cannot remove', 'You are the host for this game.');
        return;
      }
      onPlayersChange(players.filter((p) => p.id !== id));
    },
    [players, onPlayersChange]
  );

  return (
    <Animated.View entering={FadeIn.duration(240)} style={playStyles.playTabRoot}>
      <GameCourseSetupSection setup={courseSetup} themeMode={themeMode} />

      {/* Players — single card list like premium mockup */}
      <View>
        <View style={playStyles.playersHeaderRow}>
          <Text style={playStyles.playersSectionTitle}>PLAYERS ({players.length})</Text>
          <Pressable
            onPress={() => Alert.alert('Edit roster', 'Roster editor coming soon.')}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={playStyles.playersEdit}>Edit</Text>
          </Pressable>
        </View>

        <PlayGlassCard themeMode={themeMode} surface="setup" style={{ marginTop: 12, padding: 0 }}>
          <View style={playStyles.playersListInset}>
            {players.map((p, i) => (
              <React.Fragment key={p.id}>
                {i > 0 ? (
                  <View
                    style={[
                      playStyles.playerDivider,
                      {
                        backgroundColor:
                          themeMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                      },
                    ]}
                  />
                ) : null}
                <View style={playStyles.playerRowOuter}>
                  <View style={playStyles.playerRow}>
                    <ProfileAvatar
                      size="sm"
                      imageUri={p.avatarUrl}
                      initials={p.initials}
                      backgroundColor={ACCENT_SOFT}
                    />
                    <View style={playStyles.playerTextCol}>
                      <Text style={[playStyles.playerName, { color: colors.text }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[playStyles.hcp, { color: colors.textSecondary }]} numberOfLines={1}>
                        Handicap {p.handicap}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removePlayer(p.id)}
                      style={({ pressed }) => [
                        playStyles.removeBtn,
                        {
                          borderColor: colors.border,
                          opacity: pressed ? 0.75 : 1,
                          backgroundColor:
                            themeMode === 'dark' ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.07)',
                        },
                      ]}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </View>
              </React.Fragment>
            ))}
          </View>
        </PlayGlassCard>

        <Pressable
          onPress={addPlayer}
          style={({ pressed }) => [
            playStyles.addPlayer,
            {
              backgroundColor: themeMode === 'dark' ? '#1A1A1A' : '#EEF0EE',
              borderColor: ACCENT,
              opacity: pressed ? 0.88 : 1,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            },
          ]}
        >
          <View style={playStyles.addPlayerInner}>
            <Ionicons name="add" size={22} color={ACCENT} />
            <Text style={playStyles.addPlayerTxt}>Add Player</Text>
          </View>
        </Pressable>
      </View>

      {/* Game settings — same card + row treatment as Game setup */}
      <View style={playStyles.gameSettingsSection}>
        <Text style={playStyles.setupSectionTitle}>Game Settings</Text>
        <PlayGlassCard themeMode={themeMode} surface="setup" style={{ marginTop: 12, padding: 0 }}>
          <View style={playStyles.setupListInset}>
            {gameSettingsRows.map((row, i) => (
              <ChevronSettingRow
                key={row.key}
                label={row.label}
                value={row.value}
                onPress={() => onGameSettingTap(row.label)}
                colors={colors}
                themeMode={themeMode}
                showDivider={i > 0}
              />
            ))}
          </View>
        </PlayGlassCard>

        <View style={playStyles.startGameBtnShell} collapsable={false}>
          <Pressable
            onPress={onStartGame}
            accessibilityRole="button"
            accessibilityLabel="Start Game"
            style={({ pressed }) => [playStyles.startGameBtnPressable, { opacity: pressed ? 0.92 : 1 }]}
          >
            <View style={playStyles.startGameBtnInner}>
              <Text style={playStyles.startGameBtnText}>Start Game</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const playStyles = StyleSheet.create({
  playTabRoot: {
    marginTop: 20,
    gap: 22,
    width: '100%',
    alignSelf: 'stretch',
  },
  gameSettingsSection: {
    width: '100%',
    marginBottom: 24,
  },
  setupSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: ACCENT,
  },
  glass: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
    }),
  },
  glassSetup: {
    borderRadius: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 4 },
    }),
  },
  glassSetupInner: {
    alignItems: 'stretch',
    width: '100%',
  },
  glassGlow: {
    position: 'absolute',
    top: -28,
    left: '10%',
    right: '10%',
    height: 52,
    borderRadius: 999,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.32,
  },
  setupDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 6,
    marginVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  setupListInset: {
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 12,
  },
  chevronRowOuter: {
    width: '100%',
    alignSelf: 'stretch',
  },
  chevronRowOuterSetup: {
    paddingVertical: 18,
    paddingLeft: 10,
    paddingRight: 10,
  },
  chevronRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'space-between',
  },
  chevronTextBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  chevronTrailing: {
    marginLeft: 'auto',
    width: 28,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  setupLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
    marginBottom: 8,
    paddingTop: 1,
  },
  setupValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  playersHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playersSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: ACCENT,
  },
  playersEdit: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.2,
  },
  playersListInset: {
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 10,
  },
  playerDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 8,
    marginVertical: 0,
  },
  playerRowOuter: {
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  playerTextCol: { flex: 1, minWidth: 0, justifyContent: 'center' },
  playerName: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  hcp: { fontSize: 13, fontWeight: '600', marginTop: 3 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlayer: {
    alignSelf: 'stretch',
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
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
  addPlayerTxt: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.15,
    color: ACCENT,
  },
  startGameBtnShell: {
    width: '100%',
    marginTop: 16,
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
