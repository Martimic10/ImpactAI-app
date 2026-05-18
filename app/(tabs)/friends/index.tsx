import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Animated, {
  FadeIn,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { SwingThumbnail } from '@/components/SwingThumbnail';
import type { Swing } from '@/types';
import { FriendCard, FriendCardData } from '@/components/friends/FriendCard';
import { RequestCard, RequestCardData } from '@/components/friends/RequestCard';
import { LeaderboardItem, LeaderboardRowData, LeaderboardMode } from '@/components/friends/LeaderboardItem';
import { SocialGamesTab } from '@/components/friends/SocialGamesTab';
import { useAuth } from '@/hooks/useAuth';
import { UserProfile } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { canUseLeaderboardScope } from '@/lib/plans';
import { usePaywall } from '@/hooks/usePaywall';
import {
  acceptFriendRequest,
  buildLeaderboard,
  declineFriendRequest,
  fetchFriends,
  fetchIncomingRequests,
  fetchFriendProfiles,
  getSocialExcludeIds,
  searchGolfers,
  sendFriendRequest,
} from '@/lib/friends';
import { fetchFeedActivities } from '@/lib/socialFeed';
import { useFeedLikes } from '@/hooks/useFeedLikes';
import { subscribeSwingDataUpdates } from '@/lib/swingDataUpdates';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.14)';
const H_PAD = 20;

const LEADERBOARD_LABELS: Record<LeaderboardMode, string> = {
  score: 'Points',
  streak: 'Streak',
  swings: 'Uploads',
};

type SocialSegment = 'feed' | 'leaderboards' | 'games';
type LeaderboardScope = 'weekly' | 'monthly' | 'friends' | 'global';

type FeedActivity = {
  id: string;
  swingId: string;
  initials: string;
  name: string;
  text: string;
  time: string;
  kind: 'upload' | 'streak' | 'improve' | 'challenge';
  avatarUrl?: string;
  thumbnailUrl?: string;
  videoUrl: string;
};

function feedThumbSwing(item: FeedActivity): Swing {
  return {
    id: item.swingId,
    user_id: '',
    video_url: item.videoUrl,
    status: 'completed',
    result_json: {} as Swing['result_json'],
    privacy: 'friends',
    created_at: '',
    thumbnail_url: item.thumbnailUrl,
  };
}

function FeedCard({
  item,
  colors,
  liked,
  likeCount,
  onToggleLike,
}: {
  item: FeedActivity;
  colors: ReturnType<typeof useAppColors>;
  liked: boolean;
  likeCount: number;
  onToggleLike: (postId: string) => void;
}) {
  const thumbSwing = useMemo(() => feedThumbSwing(item), [item]);

  return (
    <View style={[styles.feedCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <View style={styles.feedHeader}>
        <Text style={[styles.feedName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.feedTime, { color: colors.textMuted }]}>{item.time}</Text>
      </View>

      <View style={styles.feedFrame}>
        <SwingThumbnail swing={thumbSwing} fill style={styles.feedFrameThumb} />
        <View style={styles.feedFrameAvatar}>
          <ProfileAvatar
            size={40}
            imageUri={item.avatarUrl}
            initials={item.initials}
            backgroundColor="rgba(52,224,111,0.12)"
          />
        </View>
      </View>

      <Text style={[styles.feedText, { color: colors.textSecondary }]}>{item.text}</Text>

      <View style={styles.feedActions}>
        <TouchableOpacity
          hitSlop={8}
          style={styles.reactionChip}
          onPress={() => onToggleLike(item.id)}
          accessibilityRole="button"
          accessibilityLabel={liked ? 'Unlike post' : 'Like post'}
          accessibilityState={{ selected: liked }}
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={18}
            color={liked ? ACCENT : colors.textMuted}
          />
          {likeCount > 0 ? (
            <Text style={[styles.likeCount, { color: liked ? ACCENT : colors.textMuted }]}>
              {likeCount}
            </Text>
          ) : null}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SegmentTab({
  active,
  label,
  icon,
  iconMuted,
  labelMuted,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
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
        style={[
          styles.segmentCell,
          {
            shadowColor: ACCENT,
            borderWidth: 1.5,
          },
          shell,
        ]}
      >
        <Ionicons name={icon} size={16} color={active ? ACCENT : iconMuted} />
        <Text
          style={[styles.segmentLabel, { color: active ? ACCENT : labelMuted }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function PodiumBlock({
  row,
  rank,
  height,
  highlight,
  colors,
  mode,
}: {
  row: LeaderboardRowData;
  rank: 1 | 2 | 3;
  height: number;
  highlight?: boolean;
  colors: ReturnType<typeof useAppColors>;
  mode: LeaderboardMode;
}) {
  const primary = mode === 'streak' ? row.streak : mode === 'swings' ? row.totalSwings : row.score;
  const sub = mode === 'streak' ? 'streak' : mode === 'swings' ? 'swings' : 'pts';
  const isThird = rank === 3;
  const avatarSize = rank === 1 ? 'sm' : rank === 2 ? 44 : 42;

  return (
    <View
      style={[
        styles.podiumSlot,
        { height, borderColor: highlight ? 'rgba(52,224,111,0.45)' : colors.border, backgroundColor: colors.surfaceAlt },
        highlight && styles.podiumGlow,
        isThird && styles.podiumSlotCompact,
      ]}
    >
      <Text
        style={[
          styles.podiumRank,
          isThird && styles.podiumRankThird,
          { color: highlight ? ACCENT : isThird ? colors.textSecondary : colors.textMuted },
        ]}
      >
        #{rank}
      </Text>
      <View style={[styles.podiumBody, isThird && styles.podiumBodyThird]}>
        <ProfileAvatar size={avatarSize} imageUri={row.avatarUrl} initials={row.avatarInitials} />
        <Text
          style={[styles.podiumName, isThird && styles.podiumNameCompact, { color: colors.text }]}
          numberOfLines={1}
        >
          {row.displayName}
        </Text>
        <View style={styles.podiumStatRow}>
          <Text
            style={[
              styles.podiumStatNum,
              isThird && styles.podiumStatNumCompact,
              { color: highlight ? ACCENT : colors.text },
            ]}
          >
            {primary}
          </Text>
          <Text
            style={[
              styles.podiumStatLabel,
              isThird && styles.podiumStatLabelCompact,
              { color: highlight ? ACCENT : colors.textSecondary },
            ]}
          >
            {sub}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function FriendsScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ segment?: string | string[] }>();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const bottomPad = (tabBarH > 0 ? tabBarH : Platform.OS === 'ios' ? 100 : 76) + (tabBarH > 0 ? 16 : insets.bottom + 16) + 56;
  const { isPro, openPaywall, Paywall } = usePaywall();

  const [friends, setFriends] = useState<FriendCardData[]>([]);
  const [requests, setRequests] = useState<RequestCardData[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRowData[]>([]);
  const [feedActivities, setFeedActivities] = useState<FeedActivity[]>([]);
  const [socialLoading, setSocialLoading] = useState(true);
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>('score');
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>('weekly');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [segment, setSegment] = useState<SocialSegment>('feed');
  const [searchOpen, setSearchOpen] = useState(false);
  const { isLiked, likeCount, toggleLike } = useFeedLikes();

  const handleToggleFeedLike = useCallback(
    (postId: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      void toggleLike(postId);
    },
    [toggleLike],
  );

  const fetchData = useCallback(async () => {
    if (!user) {
      setFriends([]);
      setRequests([]);
      setLeaderboard([]);
      setFeedActivities([]);
      setSocialLoading(false);
      return;
    }

    setSocialLoading(true);
    try {
      const [friendList, requestList, profiles] = await Promise.all([
        fetchFriends(user.id),
        fetchIncomingRequests(user.id),
        fetchFriendProfiles(user.id),
      ]);

      setFriends(friendList);
      setRequests(requestList);

      const [lb, feed] = await Promise.all([
        buildLeaderboard(user.id, profiles),
        fetchFeedActivities(
          user.id,
          profiles.map((p) => p.id),
        ),
      ]);

      setLeaderboard(lb);
      setFeedActivities(feed);
    } finally {
      setSocialLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  useEffect(() => {
    if (!user) return undefined;
    return subscribeSwingDataUpdates(() => {
      void fetchData();
    });
  }, [user, fetchData]);

  useEffect(() => {
    if (isPro) return;
    if (leaderboardScope !== 'weekly') setLeaderboardScope('weekly');
  }, [isPro, leaderboardScope]);

  useEffect(() => {
    const raw = routeParams.segment;
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (s === 'feed' || s === 'leaderboards' || s === 'games') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSegment(s);
    }
  }, [routeParams.segment]);

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (!user) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const exclude = await getSocialExcludeIds(user.id);
    for (const id of sentRequests) exclude.add(id);
    const results = await searchGolfers(query.trim(), user.id, exclude);
    setSearchResults(results);
    setSearching(false);
  }

  async function sendRequest(toUserId: string) {
    if (!user) return;
    setSentRequests((prev) => new Set([...prev, toUserId]));
    const result = await sendFriendRequest(user.id, toUserId);
    if (!result.ok) {
      setSentRequests((prev) => {
        const n = new Set(prev);
        n.delete(toUserId);
        return n;
      });
      Alert.alert('Could not invite', result.message ?? 'Please try again.');
    }
  }

  async function handleAccept(requestId: string) {
    const req = requests.find((r) => r.id === requestId);
    if (!req || !user) return;
    const result = await acceptFriendRequest(requestId, req.senderId, user.id);
    if (!result.ok) {
      Alert.alert('Error', result.message ?? 'Could not accept request.');
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    await fetchData();
  }

  async function handleDecline(requestId: string) {
    await declineFriendRequest(requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  const showMetricPicker = useCallback(() => {
    Alert.alert('Rank by', 'How should players be ordered?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: LEADERBOARD_LABELS.score,
        onPress: () => setLeaderboardMode('score'),
      },
      {
        text: LEADERBOARD_LABELS.streak,
        onPress: () => setLeaderboardMode('streak'),
      },
      {
        text: LEADERBOARD_LABELS.swings,
        onPress: () => setLeaderboardMode('swings'),
      },
    ]);
  }, []);

  function sortedLeaderboard(): LeaderboardRowData[] {
    return [...leaderboard].sort((a, b) => {
      if (leaderboardMode === 'streak') return b.streak - a.streak;
      if (leaderboardMode === 'swings') return b.totalSwings - a.totalSwings;
      return b.score - a.score;
    });
  }

  function setSeg(next: SocialSegment) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSegment(next);
  }

  const sorted = sortedLeaderboard();
  const top3: [LeaderboardRowData, LeaderboardRowData, LeaderboardRowData] | null =
    sorted.length >= 3 ? ([sorted[0], sorted[1], sorted[2]] as const) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await fetchData();
              setRefreshing(false);
            }}
            tintColor={ACCENT}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: H_PAD }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Social</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Compete, connect, and improve together.</Text>
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity
              style={[styles.hIcon, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setSearchOpen((o) => !o);
              }}
            >
              <Ionicons name="search-outline" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.hIcon, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              onPress={() => Alert.alert('Notifications', "You're all caught up.")}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {searchOpen && (
          <View style={[styles.searchBlock, { paddingHorizontal: H_PAD }]}>
            <View style={[styles.searchBar, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Find golfers…"
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={handleSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searching ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : searchQuery.length > 0 ? (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
            {searchQuery.length >= 2 && (
              <View style={[styles.dropdown, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                {searching ? (
                  <View style={styles.dropdownRow}>
                    <ActivityIndicator color={ACCENT} />
                    <Text style={{ color: colors.textSecondary }}>Searching…</Text>
                  </View>
                ) : searchResults.length === 0 ? (
                  <Text style={{ color: colors.textMuted, padding: 14 }}>No golfers found.</Text>
                ) : (
                  searchResults.map((result, i) => {
                    const sent = sentRequests.has(result.id);
                    const initials = result.username.slice(0, 2).toUpperCase();
                    return (
                      <View
                        key={result.id}
                        style={[
                          styles.dropdownRow,
                          i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                        ]}
                      >
                        <View style={[styles.ddAv, { borderColor: 'rgba(52,224,111,0.35)' }]}>
                          <Text style={[styles.ddAvTxt, { color: ACCENT }]}>{initials}</Text>
                        </View>
                        <Text style={[styles.ddUser, { color: colors.text }]}>@{result.username}</Text>
                        <TouchableOpacity
                          style={[styles.ddAdd, !sent && { backgroundColor: ACCENT }]}
                          onPress={() => !sent && sendRequest(result.id)}
                          disabled={sent}
                        >
                          <Text style={[styles.ddAddTxt, { color: sent ? colors.textMuted : '#0A0A0A' }]}>
                            {sent ? 'Sent' : 'Invite'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}

        {/* Segmented nav — same pattern as Upload visibility */}
        <View style={[styles.segmentWrap, { paddingHorizontal: H_PAD }]}>
          <View style={[styles.segment, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            {(
              [
                { key: 'feed' as const, label: 'Feed', icon: 'newspaper-outline' as const },
                { key: 'leaderboards' as const, label: 'Leaderboards', icon: 'trophy-outline' as const },
                { key: 'games' as const, label: 'Games', icon: 'flag-outline' as const },
              ] as const
            ).map(({ key, label, icon }) => (
              <SegmentTab
                key={key}
                active={segment === key}
                label={label}
                icon={icon}
                iconMuted={colors.textMuted}
                labelMuted={colors.textSecondary}
                onPress={() => setSeg(key)}
              />
            ))}
          </View>
        </View>

        {/* —— Feed —— */}
        {segment === 'feed' && (
          <View style={{ paddingHorizontal: H_PAD, gap: 18 }}>
            {requests.length > 0 && (
              <View style={{ gap: 10 }}>
                <Text style={[styles.sectionHead, { color: colors.textMuted }]}>Requests</Text>
                {requests.map((req) => (
                  <RequestCard
                    key={req.id}
                    data={req}
                    onAccept={() => handleAccept(req.id)}
                    onDecline={() => handleDecline(req.id)}
                  />
                ))}
              </View>
            )}

            <Text style={[styles.sectionHead, { color: colors.textMuted }]}>Activity</Text>
            {socialLoading && feedActivities.length === 0 ? (
              <View style={styles.feedLoading}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : feedActivities.length === 0 ? (
              <View style={[styles.feedEmpty, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="newspaper-outline" size={28} color={colors.textMuted} />
                <Text style={[styles.feedEmptyTitle, { color: colors.text }]}>No feed activity yet</Text>
                <Text style={[styles.feedEmptySub, { color: colors.textSecondary }]}>
                  Upload a swing and choose Friends or Feed to share it here.
                </Text>
              </View>
            ) : null}
            {feedActivities.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                colors={colors}
                liked={isLiked(item.id)}
                likeCount={likeCount(item.id, 0)}
                onToggleLike={handleToggleFeedLike}
              />
            ))}

            <Text style={[styles.sectionHead, { color: colors.textMuted, marginTop: 8 }]}>Your crew</Text>
            {friends.length === 0 ? (
              <Text style={{ color: colors.textMuted }}>Add friends to see them here.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {friends.map((f) => (
                  <FriendCard
                    key={f.id}
                    data={f}
                    onGames={() => setSeg('games')}
                    onViewSwing={() =>
                      router.push({
                        pathname: '/(tabs)/friends/[id]',
                        params: { id: f.id, username: f.username, avatarInitials: f.avatarInitials },
                      })
                    }
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* —— Leaderboards —— */}
        {segment === 'leaderboards' && (
          <View style={{ paddingHorizontal: H_PAD, gap: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.lbToolbar}
              keyboardShouldPersistTaps="handled"
            >
              {(
                [
                  { id: 'weekly', label: 'Weekly' },
                  { id: 'monthly', label: 'Monthly' },
                  { id: 'friends', label: 'Friends' },
                  { id: 'global', label: 'Global' },
                ] as const
              ).map((s) => {
                const on = leaderboardScope === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => {
                      if (!canUseLeaderboardScope(isPro, s.id)) {
                        openPaywall();
                        return;
                      }
                      setLeaderboardScope(s.id);
                    }}
                    style={[
                      styles.lbScopeChip,
                      { borderColor: on ? ACCENT : colors.border, backgroundColor: on ? ACCENT_SOFT : colors.surfaceAlt },
                    ]}
                    activeOpacity={0.88}
                  >
                    <Text style={[styles.lbScopeChipTxt, { color: on ? ACCENT : colors.textSecondary }]}>{s.label}</Text>
                    {!isPro && s.id !== 'weekly' ? (
                      <Ionicons name="lock-closed" size={9} color={colors.textMuted} style={{ marginLeft: 2 }} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}

              <View style={[styles.lbToolbarDivider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                onPress={showMetricPicker}
                activeOpacity={0.88}
                style={[
                  styles.lbMetricChip,
                  {
                    borderColor: ACCENT,
                    backgroundColor: ACCENT_SOFT,
                  },
                ]}
              >
                <Text style={[styles.lbMetricChipTxt, { color: ACCENT }]}>{LEADERBOARD_LABELS[leaderboardMode]}</Text>
                <Ionicons name="chevron-down" size={15} color={ACCENT} />
              </TouchableOpacity>
            </ScrollView>

            {top3 && (
              <View style={styles.podiumRow}>
                <PodiumBlock row={top3[1]} rank={2} height={132} colors={colors} mode={leaderboardMode} />
                <PodiumBlock row={top3[0]} rank={1} height={158} highlight colors={colors} mode={leaderboardMode} />
                <PodiumBlock row={top3[2]} rank={3} height={124} colors={colors} mode={leaderboardMode} />
              </View>
            )}

            {leaderboard.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="trophy-outline" size={36} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No leaderboard yet</Text>
                <Text style={[styles.emptySub, { color: colors.textSecondary }]}>Invite friends to compete.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {sorted.map((entry, i) => (
                  <LeaderboardItem key={entry.id} data={entry} rank={i + 1} mode={leaderboardMode} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* —— Games —— */}
        {segment === 'games' && (
          <Animated.View entering={FadeIn.duration(240)} style={{ marginTop: 4 }}>
            <SocialGamesTab themeMode={theme} isPro={isPro} onRequirePro={openPaywall} />
          </Animated.View>
        )}
      </ScrollView>

      <Paywall />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 14, fontWeight: '500', marginTop: 6, lineHeight: 20, maxWidth: 220 },
  headerIcons: { flexDirection: 'row', gap: 8 },
  hIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  previewPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },

  searchBlock: { marginBottom: 14, zIndex: 20 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500' },
  dropdown: { marginTop: 8, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  ddAv: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ddAvTxt: { fontSize: 12, fontWeight: '800' },
  ddUser: { flex: 1, fontWeight: '700' },
  ddAdd: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  ddAddTxt: { fontSize: 12, fontWeight: '800' },

  segmentWrap: { marginBottom: 18 },
  segment: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    gap: 4,
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

  sectionHead: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  feedCard: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  feedFrame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#141414',
  },
  feedFrameThumb: {
    borderRadius: 14,
  },
  feedFrameAvatar: {
    position: 'absolute',
    left: 10,
    bottom: 10,
  },
  feedLoading: { paddingVertical: 24, alignItems: 'center' },
  feedEmpty: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
  },
  feedEmptyTitle: { fontSize: 16, fontWeight: '800' },
  feedEmptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  feedName: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, flex: 1 },
  feedText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  feedActions: { flexDirection: 'row', gap: 14 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
  },
  likeCount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  feedTime: { fontSize: 11, fontWeight: '700', flexShrink: 0 },

  lbToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingRight: 4,
  },
  lbScopeChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  lbScopeChipTxt: { fontSize: 12, fontWeight: '800', letterSpacing: -0.1 },
  lbToolbarDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    alignSelf: 'center',
    marginHorizontal: 2,
    opacity: 0.9,
  },
  lbMetricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  lbMetricChipTxt: { fontSize: 12, fontWeight: '800', letterSpacing: -0.1 },

  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 8,
  },
  podiumSlot: {
    flex: 1,
    maxWidth: 118,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  podiumSlotCompact: {
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 11,
  },
  podiumBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
  },
  podiumRankThird: { marginBottom: 6 },
  podiumBodyThird: {
    justifyContent: 'flex-start',
    paddingTop: 2,
    gap: 5,
  },
  podiumGlow: {
    shadowColor: ACCENT,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  podiumRank: { fontSize: 11, fontWeight: '800' },
  podiumName: { fontSize: 13, fontWeight: '800', textAlign: 'center', maxWidth: '100%' },
  podiumNameCompact: { fontSize: 12 },
  podiumStatRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 3,
    flexWrap: 'nowrap',
  },
  podiumStatNum: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  podiumStatNumCompact: { fontSize: 15 },
  podiumStatLabel: { fontSize: 11, fontWeight: '600', textTransform: 'lowercase', opacity: 0.92 },
  podiumStatLabelCompact: { fontSize: 10, fontWeight: '600' },

  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800' },
  emptySub: { fontSize: 14, textAlign: 'center' },
});
