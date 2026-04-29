import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FriendCard } from '@/components/friends/FriendCard';
import { RequestCard } from '@/components/friends/RequestCard';
import { LeaderboardItem } from '@/components/friends/LeaderboardItem';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { UserProfile, FriendRequest, LeaderboardEntry } from '@/types';
import { DEV_MODE, MOCK_FRIENDS } from '@/lib/devMode';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { hasProAccess } from '@/lib/plans';
import { PaywallModal } from '@/components/PaywallModal';

type LeaderboardMode = 'score' | 'streak' | 'swings';

const LEADERBOARD_LABELS: Record<LeaderboardMode, string> = {
  score: 'Highest Score',
  streak: 'Practice Streak',
  swings: 'Total Swings',
};

const MOCK_LEADERBOARD: LeaderboardEntry[] = MOCK_FRIENDS.map((f) => ({
  user: f,
  score: f.improvement_score,
  streak: f.streak,
  total_swings: f.total_swings,
}));

export default function FriendsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const [friends, setFriends] = useState<UserProfile[]>(DEV_MODE ? MOCK_FRIENDS : []);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(DEV_MODE ? MOCK_LEADERBOARD : []);
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>('score');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'friends' | 'leaderboard'>('friends');
  const [showPaywall, setShowPaywall] = useState(false);
  const isPro = hasProAccess(user);

  const fetchData = useCallback(async () => {
    if (DEV_MODE || !user) return;
    
    const [friendsRes, requestsRes] = await Promise.all([
      supabase
        .from('friends')
        .select('friend_id, users!friends_friend_id_fkey(id, username, plan, last_active, streak, total_swings)')
        .eq('user_id', user.id),
      supabase
        .from('requests')
        .select('id, sender_id, receiver_id, users!requests_sender_id_fkey(id, username, plan)')
        .eq('receiver_id', user.id),
    ]);

    if (friendsRes.data) {
      const profiles = friendsRes.data
        .map((f: Record<string, unknown>) => f.users)
        .filter(Boolean) as UserProfile[];
      setFriends(profiles);
      const entries: LeaderboardEntry[] = profiles.map((p) => ({
        user: p,
        score: Math.floor(Math.random() * 50) + 10,
        streak: p.streak ?? 0,
        total_swings: p.total_swings ?? 0,
      }));
      setLeaderboard(entries.sort((a, b) => b.score - a.score));
    }

    if (requestsRes.data) {
      setRequests(
        requestsRes.data.map((r: Record<string, unknown>) => ({
          ...r,
          sender: r.users as UserProfile,
        })) as FriendRequest[]
      );
    }

      }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.trim().length < 2) { setSearchResults([]); return; }
    if (DEV_MODE) {
      setSearchResults(MOCK_FRIENDS.filter((f) => f.username.toLowerCase().includes(query.toLowerCase())));
      return;
    }
    const { data } = await supabase
      .from('users')
      .select('id, username, plan')
      .ilike('username', `%${query}%`)
      .neq('id', user?.id)
      .limit(8);
    setSearchResults((data as UserProfile[]) ?? []);
  }

  async function sendRequest(toUserId: string) {
    if (DEV_MODE) {
      Alert.alert('Sent!', 'Friend request sent. (Dev mode)');
      setSearchQuery(''); setSearchResults([]);
      return;
    }
    if (!user) return;
    const { error } = await supabase.from('requests').insert({ sender_id: user.id, receiver_id: toUserId });
    if (error) Alert.alert('Error', 'Could not send request.');
    else { Alert.alert('Sent!', 'Friend request sent.'); setSearchQuery(''); setSearchResults([]); }
  }

  async function handleAccept(requestId: string, senderId: string) {
    if (!user) return;
    await Promise.all([
      supabase.from('friends').insert({ user_id: user.id, friend_id: senderId }),
      supabase.from('friends').insert({ user_id: senderId, friend_id: user.id }),
      supabase.from('requests').delete().eq('id', requestId),
    ]);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    fetchData();
  }

  async function handleDecline(requestId: string) {
    await supabase.from('requests').delete().eq('id', requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  function sortedLeaderboard(): LeaderboardEntry[] {
    return [...leaderboard].sort((a, b) => {
      if (leaderboardMode === 'streak') return b.streak - a.streak;
      if (leaderboardMode === 'swings') return b.total_swings - a.total_swings;
      return b.score - a.score; // 'score' = Highest Score
    });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }}
            tintColor="#4CAF50"
          />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Friends</Text>
          <Text style={styles.subtitle}>
            {friends.length} golf {friends.length === 1 ? 'buddy' : 'buddies'}
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchArea}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={16} color="#48484A" />
              <TextInput
              style={[styles.searchInput, { color: '#FFFFFF' }]}
              placeholder="Find golfers by username…"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                <Ionicons name="close-circle" size={18} color="#48484A" />
              </TouchableOpacity>
            )}
          </View>

          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((result, i) => (
                <TouchableOpacity
                  key={result.id}
                  onPress={() => sendRequest(result.id)}
                  style={[styles.searchResultRow, i > 0 && styles.searchResultBorder]}
                >
                  <View style={styles.searchAvatar}>
                    <Ionicons name="person-outline" size={16} color="#4CAF50" />
                  </View>
                  <Text style={[styles.searchUsername, { color: colors.text }]}>{result.username}</Text>
                  <Text style={styles.addText}>Add +</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Tab switcher */}
        <View style={styles.tabSwitcher}>
          {(['friends', 'leaderboard'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive, activeTab === tab && { color: colors.text }]}>
                {tab === 'friends' ? 'Friends' : 'Leaderboard'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'friends' ? (
          <View style={styles.content}>
            {requests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Friend Requests ({requests.length})</Text>
                <View style={styles.list}>
                  {requests.map((req) => (
                    <RequestCard
                      key={req.id}
                      request={req}
                      onAccept={() => handleAccept(req.id, req.sender_id)}
                      onDecline={() => handleDecline(req.id)}
                    />
                  ))}
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Your Golf Buddies</Text>
              {friends.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={42} color="#333333" style={{ marginBottom: 12 }} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No friends yet</Text>
                  <Text style={styles.emptySubtitle}>Search for golfers above to add them</Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {friends.map((friend) => (
                    <FriendCard
                      key={friend.id}
                      friend={friend}
                      onViewSwing={() =>
                        router.push({
                          pathname: '/(tabs)/friends/[id]',
                          params: { id: friend.id, username: friend.username },
                        })
                      }
                    />
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.content}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modeScroll}>
              <View style={styles.modeRow}>
                {(Object.keys(LEADERBOARD_LABELS) as LeaderboardMode[]).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => {
                      if (mode !== 'score' && !isPro) { setShowPaywall(true); return; }
                      setLeaderboardMode(mode);
                    }}
                    style={[styles.modeBtn, leaderboardMode === mode && styles.modeBtnActive]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={[styles.modeBtnText, leaderboardMode === mode && styles.modeBtnTextActive, leaderboardMode === mode && { color: colors.text }]}>
                        {LEADERBOARD_LABELS[mode]}
                      </Text>
                      {mode !== 'score' && !isPro && (
                        <Ionicons name="lock-closed" size={11} color="#8E8E93" />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {leaderboard.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="trophy-outline" size={42} color="#333333" style={{ marginBottom: 12 }} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No data yet</Text>
                <Text style={styles.emptySubtitle}>Add friends to see the leaderboard</Text>
              </View>
            ) : (
              <View style={[styles.list, { paddingHorizontal: 24 }]}>
                {sortedLeaderboard().map((entry, i) => (
                  <LeaderboardItem
                    key={entry.user.id}
                    entry={entry}
                    rank={i + 1}
                    onViewSwing={() =>
                      router.push({
                        pathname: '/(tabs)/friends/[id]',
                        params: { id: entry.user.id, username: entry.user.username },
                      })
                    }
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#8E8E93', marginTop: 4 },
  searchArea: { marginHorizontal: 24, marginBottom: 16 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#FFFFFF' },
  searchResults: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  searchResultBorder: { borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  searchAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1B2E1B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchUsername: { flex: 1, fontSize: 14, fontWeight: '500', color: '#FFFFFF' },
  addText: { fontSize: 12, color: '#4CAF50', fontWeight: '600' },
  tabSwitcher: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 20,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#2E7D32' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  tabTextActive: { color: '#FFFFFF' },
  content: { gap: 24 },
  section: { paddingHorizontal: 24 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  list: { gap: 10 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  emptySubtitle: { fontSize: 13, color: '#8E8E93', marginTop: 4, textAlign: 'center' },
  modeScroll: { marginBottom: 16, paddingHorizontal: 24 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  modeBtnActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  modeBtnTextActive: { color: '#FFFFFF' },
});
