import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { useFocusEffect } from 'expo-router';
import { getSwingScore } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { sendCoachChatMessage, type CoachStructuredReply, type CoachChatContext } from '@/lib/coachChat';
import {
  canSendCoachMessage,
  coachMessagesRemaining,
  getCoachMessagesUsedToday,
  incrementCoachMessagesUsed,
} from '@/lib/coachUsage';
import { FREE_LIMITS } from '@/lib/plans';
import { usePaywall } from '@/hooks/usePaywall';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.14)';
const H_PAD = 20;

const QUICK_PROMPTS = [
  'Why am I slicing?',
  'What should I practice today?',
  'How do I improve consistency?',
  'Best driver drills?',
  'How do I stop chunking irons?',
];

type ChatRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  drill?: CoachStructuredReply['drill'];
  tip?: string | null;
  pending?: boolean;
};

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function firstName(user: { username?: string; email?: string } | null) {
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

export default function CoachScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const footerBottomPad =
    (tabBarHeight > 0 ? tabBarHeight : Platform.OS === 'ios' ? 100 : 76) +
    (tabBarHeight > 0 ? 12 : insets.bottom + 12);

  const { swings, refetch } = useSwings(user?.id);
  const { isPro, requirePro, openPaywall, Paywall } = usePaywall();
  const scrollRef = useRef<ScrollView>(null);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [coachUsedToday, setCoachUsedToday] = useState(0);

  useFocusEffect(
    useCallback(() => {
      refetch();
      getCoachMessagesUsedToday().then(setCoachUsedToday);
    }, [refetch])
  );

  const coachRemaining = coachMessagesRemaining(isPro, coachUsedToday);

  const coachContext: CoachChatContext = useMemo(() => {
    const displayName = firstName(user ?? null);
    const swingCount = swings.length;
    const scores = swings.map((s) => getSwingScore(s.result_json));
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const latestIssue = swings[0]?.result_json?.primaryIssue ?? null;
    let lastSwingSummary: string | null = null;
    if (swings[0]) {
      const days = Math.floor((Date.now() - new Date(swings[0].created_at).getTime()) / 86400000);
      const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      lastSwingSummary = `Last swing ${when} — theme: ${swings[0].result_json?.primaryIssue ?? 'analysis'}`;
    }
    return { displayName, swingCount, avgScore, latestIssue, lastSwingSummary };
  }, [swings, user]);

  const seedWelcome = useCallback(() => {
    const n = coachContext.displayName;
    let content = `Hey ${n} — I’m Coach AI. Ask anything or tap a prompt below.`;
    if (coachContext.swingCount > 0 && coachContext.latestIssue) {
      content += ` Latest swing flagged “${coachContext.latestIssue}”—say if you want drills or a feel.`;
    } else if (coachContext.swingCount === 0) {
      content += ` Upload a swing when you can and I’ll tailor tips to your move.`;
    }
    setMessages([
      {
        id: id(),
        role: 'assistant',
        content,
        drill: null,
        tip: 'Small focus, big clarity.',
      },
    ]);
  }, [coachContext]);

  const welcomeOnce = useRef(false);
  useEffect(() => {
    if (welcomeOnce.current) return;
    welcomeOnce.current = true;
    seedWelcome();
  }, [seedWelcome]);

  useEffect(() => {
    const t = setTimeout(() => {
      const last = messages[messages.length - 1];
      const onlyWelcome =
        messages.length === 1 && last?.role === 'assistant' && !last?.pending;
      if (onlyWelcome) {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        return;
      }
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [messages, sending]);

  async function runSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!canSendCoachMessage(isPro, coachUsedToday)) {
      openPaywall();
      return;
    }
    Keyboard.dismiss();
    setInput('');

    const priorForApi = messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content }));
    const apiHistory = [...priorForApi, { role: 'user' as const, content: trimmed }].slice(-12);

    const userRow: ChatRow = { id: id(), role: 'user', content: trimmed };
    const pendingId = id();
    setMessages((prev) => [...prev, userRow, { id: pendingId, role: 'assistant', content: '', pending: true }]);
    setSending(true);

    try {
      const structured = await sendCoachChatMessage({
        messages: apiHistory,
        context: coachContext,
      });
      const used = await incrementCoachMessagesUsed();
      setCoachUsedToday(used);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                id: pendingId,
                role: 'assistant',
                content: structured.reply,
                drill: structured.drill,
                tip: structured.tip,
                pending: false,
              }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                id: pendingId,
                role: 'assistant',
                content: 'Something went wrong fetching a reply. Check your connection and try again.',
                pending: false,
              }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  const canSend = input.trim().length > 0 && !sending;

  function clearChat() {
    Alert.alert('Clear conversation?', 'This removes messages until you leave the tab.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          setMessages([]);
          seedWelcome();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: H_PAD }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.title, { color: colors.text }]}>Coach AI</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Your personal AI golf coach.</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={clearChat}
              style={[styles.headerIconBtn, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              hitSlop={10}
              accessibilityLabel="Chat history"
            >
              <Ionicons name="time-outline" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8}>
              <ProfileAvatar
                size="sm"
                imageUri={user?.avatar_url}
                initials={(user?.username ?? user?.email ?? '?').slice(0, 2).toUpperCase()}
              />
            </TouchableOpacity>
          </View>
        </View>

        {!isPro ? (
          <TouchableOpacity
            style={[styles.limitBanner, { marginHorizontal: H_PAD, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            onPress={openPaywall}
            activeOpacity={0.88}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={ACCENT} />
            <Text style={[styles.limitBannerText, { color: colors.textSecondary }]}>
              {coachRemaining > 0
                ? `${coachRemaining} of ${FREE_LIMITS.coachMessagesPerDay} free questions left today · Go Pro for unlimited`
                : 'Daily limit reached — unlock unlimited Coach AI with Pro'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Quick prompts */}
        <View style={styles.quickRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickScroll}
          keyboardShouldPersistTaps="handled"
        >
          {QUICK_PROMPTS.map((q) => (
            <Pressable
              key={q}
              onPress={() => {
                if (!canSendCoachMessage(isPro, coachUsedToday)) {
                  openPaywall();
                  return;
                }
                setInput(q);
              }}
              style={({ pressed }) => [
                styles.quickCard,
                {
                  borderColor: 'rgba(52,224,111,0.28)',
                  backgroundColor: pressed ? ACCENT_SOFT : colors.surfaceAlt,
                },
              ]}
            >
              <Text style={[styles.quickText, { color: colors.text }]}>{q}</Text>
            </Pressable>
          ))}
        </ScrollView>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={[
            styles.threadContent,
            { paddingHorizontal: H_PAD, flexGrow: 1 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) => (
            <View key={m.id} style={[styles.msgBlock, m.role === 'user' ? styles.alignEnd : styles.alignStart]}>
              {m.role === 'assistant' && (
                <View style={styles.aiLabelRow}>
                  <View style={styles.aiBadge}>
                    <Ionicons name="sparkles" size={12} color={ACCENT} />
                  </View>
                  <Text style={[styles.aiLabel, { color: colors.textMuted }]}>Coach AI</Text>
                </View>
              )}
              <View
                style={[
                  styles.bubble,
                  m.role === 'user'
                    ? [styles.userBubble, { backgroundColor: '#1E1E22' }]
                    : [
                        styles.aiBubble,
                        {
                          backgroundColor: theme === 'dark' ? 'rgba(24, 32, 26, 0.95)' : colors.surfaceAlt,
                          borderColor: 'rgba(52,224,111,0.18)',
                        },
                      ],
                ]}
              >
                {m.pending ? (
                  <View style={styles.typingRow}>
                    <ActivityIndicator size="small" color={ACCENT} />
                    <Text style={[styles.typingText, { color: colors.textSecondary }]}>Thinking…</Text>
                  </View>
                ) : (
                  <Text style={[styles.bubbleText, { color: colors.text }]}>{m.content}</Text>
                )}
              </View>
              {m.role === 'assistant' && !m.pending && m.drill && (
                <View style={[styles.drillCard, { borderColor: 'rgba(52,224,111,0.28)', backgroundColor: colors.surfaceAlt }]}>
                  <View style={styles.drillHeader}>
                    <Ionicons name="golf-outline" size={16} color={ACCENT} />
                    <Text style={[styles.drillTitle, { color: colors.text }]}>{m.drill.name}</Text>
                  </View>
                  <Text style={[styles.drillCue, { color: colors.textSecondary }]}>{m.drill.cue}</Text>
                </View>
              )}
              {m.role === 'assistant' && !m.pending && m.tip ? (
                <View style={[styles.tipPill, { backgroundColor: ACCENT_SOFT, borderColor: 'rgba(52,224,111,0.25)' }]}>
                  <Ionicons name="leaf-outline" size={14} color={ACCENT} />
                  <Text style={[styles.tipText, { color: colors.text }]}>{m.tip}</Text>
                </View>
              ) : null}
            </View>
          ))}
          <View style={{ height: 8 }} />
        </ScrollView>

        {/* Composer dock — sits above the floating tab bar */}
        <View
          style={[
            styles.composerDock,
            {
              paddingBottom: footerBottomPad,
              backgroundColor: colors.background,
              borderTopColor: 'rgba(255,255,255,0.07)',
              shadowColor: '#000',
              shadowOpacity: 0.35,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: -4 },
              elevation: 12,
            },
          ]}
        >
          <View style={[styles.inputWrap, { paddingHorizontal: H_PAD, paddingTop: 10 }]}>
            <View style={[styles.inputField, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
              <TextInput
                style={[styles.textInput, { color: colors.text }]}
                placeholder="Ask Coach AI anything about your golf game…"
                placeholderTextColor={colors.textMuted}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={2000}
                editable={!sending}
                returnKeyType="default"
              />
            </View>
            <TouchableOpacity
              style={[
                styles.sendBtn,
                canSend ? styles.sendActive : styles.sendIdle,
                canSend && {
                  shadowColor: ACCENT,
                  shadowOpacity: 0.45,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                },
              ]}
              onPress={() => runSend(input)}
              disabled={!canSend}
              activeOpacity={0.9}
              accessibilityLabel="Send"
            >
              <Ionicons name="arrow-up" size={22} color={canSend ? '#0A0A0A' : colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      <Paywall />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  limitBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 14, fontWeight: '500', marginTop: 4, lineHeight: 20 },
  quickRow: { flexShrink: 0 },
  quickScroll: { paddingHorizontal: H_PAD, gap: 10, paddingBottom: 8 },
  quickCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 4,
  },
  quickText: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },

  thread: { flex: 1, minHeight: 0 },
  threadContent: { paddingTop: 4, paddingBottom: 12, gap: 14 },
  msgBlock: { maxWidth: '100%', gap: 6 },
  alignEnd: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  alignStart: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  aiLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  aiBadge: {
    width: 22,
    height: 22,
    borderRadius: 8,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  bubble: {
    maxWidth: '92%',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  bubbleText: { fontSize: 15, lineHeight: 22, fontWeight: '500', letterSpacing: -0.1 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  typingText: { fontSize: 14, fontWeight: '600' },

  drillCard: {
    maxWidth: '92%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  drillHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drillTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, flex: 1 },
  drillCue: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  tipPill: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  composerDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  inputField: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    minHeight: 44,
    maxHeight: 120,
  },
  textInput: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    maxHeight: 100,
    paddingTop: 0,
    paddingBottom: 0,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendActive: { backgroundColor: ACCENT },
  sendIdle: { backgroundColor: '#2A2A2A' },
});
