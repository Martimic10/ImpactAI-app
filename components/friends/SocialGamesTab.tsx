import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppColors } from '@/lib/theme';
import {
  SOCIAL_GAMES,
  SOCIAL_GAME_FILTER_OPTIONS,
  type SocialGameDef,
  type SocialGameFilterKey,
} from '@/lib/socialGames';
import { requiresProForGame } from '@/lib/plans';

const ACCENT = '#34E06F';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.22)';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const H_PAD = 20;
const GAP = 12;

type Ion = React.ComponentProps<typeof Ionicons>['name'];

function GameCard({
  game,
  width,
  cardBackground,
  textColor,
  secondaryColor,
  locked,
  onPlay,
}: {
  game: SocialGameDef;
  width: number;
  cardBackground: string;
  textColor: string;
  secondaryColor: string;
  locked: boolean;
  onPlay: () => void;
}) {
  const scale = useSharedValue(1);
  const animatedCard = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPlay}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 16, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 280 });
      }}
      android_ripple={{ color: 'rgba(52,224,111,0.12)', borderless: false }}
      style={{ width }}
    >
      <Animated.View
        style={[
          styles.card,
          {
            width,
            backgroundColor: cardBackground,
            borderColor: 'rgba(52,224,111,0.18)',
            flexDirection: 'column',
          },
          animatedCard,
        ]}
      >
        <View pointerEvents="none" style={styles.cardGlowTop} />
        <View style={styles.iconWrap}>
          <View style={[styles.iconRing, { shadowColor: ACCENT }]}>
            <Ionicons name={game.icon as Ion} size={22} color={ACCENT} />
          </View>
        </View>
        <Text style={[styles.cardTitle, { color: textColor }]} numberOfLines={2}>
          {game.title}
        </Text>
        <Text style={[styles.cardDesc, { color: secondaryColor }]} numberOfLines={4}>
          {game.description}
        </Text>
        <View
          style={[
            styles.playBtn,
            { backgroundColor: locked ? 'rgba(255,255,255,0.12)' : ACCENT, marginTop: 'auto' },
          ]}
        >
          {locked ? (
            <Ionicons name="lock-closed" size={13} color="rgba(255,255,255,0.7)" />
          ) : null}
          <Text style={[styles.playBtnText, locked && styles.playBtnTextLocked]}>
            {locked ? 'Pro' : 'Play'}
          </Text>
          {!locked ? <Ionicons name="arrow-forward" size={14} color="#0A0A0A" /> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

function CategoryChip({
  label,
  icon,
  active,
  themeMode,
  colors,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  themeMode: 'light' | 'dark';
  colors: ReturnType<typeof useAppColors>;
  onPress: () => void;
}) {
  const inactiveBg =
    themeMode === 'dark' ? 'rgba(255,255,255,0.045)' : colors.surfaceAlt;
  const inactiveBorder = themeMode === 'dark' ? 'rgba(255,255,255,0.08)' : colors.border;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.catChip,
        {
          backgroundColor: active ? ACCENT_SOFT : inactiveBg,
          borderColor: active ? 'rgba(52,224,111,0.55)' : inactiveBorder,
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        active && styles.catChipActive,
      ]}
    >
      <View style={[styles.catChipIconWrap, active && styles.catChipIconWrapActive]}>
        <Ionicons name={icon as Ion} size={15} color={active ? ACCENT : colors.textMuted} />
      </View>
      <Text
        style={[styles.catChipLabel, { color: active ? ACCENT : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SocialGamesTab({
  themeMode,
  isPro,
  onRequirePro,
}: {
  themeMode: 'light' | 'dark';
  isPro: boolean;
  onRequirePro: () => void;
}) {
  const router = useRouter();
  const colors = useAppColors();
  const { width: screenW } = useWindowDimensions();
  const [filter, setFilter] = useState<SocialGameFilterKey>('all');

  const innerW = screenW - H_PAD * 2;
  const colW = Math.floor((innerW - GAP) / 2);

  const cardBackground =
    themeMode === 'dark' ? 'rgba(22, 24, 22, 0.94)' : colors.surface;

  const filtered = useMemo(() => {
    if (filter === 'all') return SOCIAL_GAMES;
    return SOCIAL_GAMES.filter((g) => g.category === filter);
  }, [filter]);

  function onPlay(game: SocialGameDef) {
    if (!isPro && requiresProForGame(game.id)) {
      onRequirePro();
      return;
    }
    router.push({ pathname: '/(tabs)/friends/game/[id]', params: { id: game.id } });
  }

  return (
    <View style={{ paddingHorizontal: H_PAD, paddingBottom: 8 }}>
      <View style={styles.gamesHeader}>
        <Text style={[styles.gamesTitle, { color: colors.text }]}>All Games</Text>
        <Text style={[styles.gamesSubtitle, { color: colors.textSecondary }]}>
          Play, compete, and win with friends.
        </Text>
        {!isPro ? (
          <Text style={[styles.gamesProHint, { color: colors.textMuted }]}>
            3 free games · Pro unlocks every format
          </Text>
        ) : null}
      </View>

      <View style={styles.catSection}>
        <Text style={[styles.catSectionLabel, { color: colors.textMuted }]}>Browse by category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {SOCIAL_GAME_FILTER_OPTIONS.map((opt) => (
            <CategoryChip
              key={opt.key}
              label={opt.label}
              icon={opt.icon}
              active={filter === opt.key}
              themeMode={themeMode}
              colors={colors}
              onPress={() => setFilter(opt.key)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={[styles.grid, { gap: GAP, marginTop: 18 }]}>
        {filtered.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            width={colW}
            cardBackground={cardBackground}
            textColor={colors.text}
            secondaryColor={colors.textSecondary}
            locked={!isPro && requiresProForGame(game.id)}
            onPlay={() => onPlay(game)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gamesHeader: {
    marginBottom: 4,
  },
  gamesTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  gamesSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 6,
    lineHeight: 20,
    maxWidth: 340,
  },
  catSection: {
    marginTop: 18,
  },
  catSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  catScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 8,
    paddingVertical: 2,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  catChipActive: {
    borderWidth: 1.5,
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.28,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
    }),
  },
  catChipIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  catChipIconWrapActive: {
    backgroundColor: 'rgba(52, 224, 111, 0.18)',
  },
  catChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.15,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    paddingBottom: 12,
    minHeight: 212,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4 },
    }),
  },
  cardGlowTop: {
    position: 'absolute',
    top: -40,
    left: '15%',
    right: '15%',
    height: 72,
    borderRadius: 999,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.45,
  },
  iconWrap: { marginBottom: 10 },
  iconRing: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
    }),
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.25,
    marginBottom: 6,
    lineHeight: 19,
  },
  cardDesc: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    marginBottom: 12,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 12,
  },
  playBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
  playBtnTextLocked: {
    color: 'rgba(255,255,255,0.75)',
  },
  gamesProHint: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
