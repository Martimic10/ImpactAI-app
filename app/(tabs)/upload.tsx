import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  Platform,
  Dimensions,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { getPlanLimits } from '@/lib/plans';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { usePaywall } from '@/hooks/usePaywall';
import { SwingThumbnail } from '@/components/SwingThumbnail';
import { getSwingScore } from '@/types';
import { getShareMode, saveShareMode } from '@/lib/preferences';
import {
  type ShareMode,
  VISIBILITY_PREVIEW,
  getVisibilityAudience,
  setPendingShareMode,
} from '@/lib/shareVisibility';
import { encodeVideoUriForRoute } from '@/lib/analysisUri';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.35)';
const H_PAD = 22;
const { width: SCREEN_W } = Dimensions.get('window');

const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|heic)$/i;

const CLUB_FAMILIES = [
  { id: 'driver', label: 'Driver', club: 'Driver' },
  { id: 'woods', label: 'Woods', club: '3 Wood' },
  { id: 'irons', label: 'Irons', club: '7 Iron' },
  { id: 'wedges', label: 'Wedges', club: '56°' },
] as const;

type ClubFamilyId = (typeof CLUB_FAMILIES)[number]['id'];
const COACH_PROMPTS = ['What should I improve?', 'What drills should I try?', 'How does my tempo look?'];

function formatPickTime(d: Date) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatSwingDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function UploadTabScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const footerPad =
    (tabBarH > 0 ? tabBarH : Platform.OS === 'ios' ? 100 : 76) + (tabBarH > 0 ? 12 : insets.bottom + 12);

  const { swings, refetch, deleteSwing } = useSwings(user?.id);
  const scrollRef = useRef<ScrollView>(null);
  const recentSectionY = useRef(0);

  const { isPro, openPaywall, Paywall } = usePaywall();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [pickedAt, setPickedAt] = useState<Date | null>(null);
  const [clubFamily, setClubFamily] = useState<ClubFamilyId>('driver');
  const [notes, setNotes] = useState('');
  const [shareMode, setShareMode] = useState<ShareMode>('private');

  const selectedClub = useMemo(
    () => CLUB_FAMILIES.find((c) => c.id === clubFamily)?.club ?? 'Driver',
    [clubFamily]
  );

  const isImage = pendingUri ? IMAGE_EXTS.test(pendingUri) : false;

  const player = useVideoPlayer(isImage ? null : pendingUri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const [isPlaying, setIsPlaying] = useState(true);

  useFocusEffect(
    useCallback(() => {
      refetch();
      getShareMode().then((mode) => {
        setShareMode(mode);
        setPendingShareMode(mode);
      });
    }, [refetch])
  );

  const visibilityPreview = VISIBILITY_PREVIEW[shareMode];
  const visibilityAudience = useMemo(() => getVisibilityAudience(shareMode), [shareMode]);

  useEffect(() => {
    if (!player || isImage) return;
    setIsPlaying(true);
    player.play();
  }, [pendingUri, player, isImage]);

  const dailyLimit = getPlanLimits(user).swingsPerDay;
  const todaySwings = swings.filter((s) => {
    const d = new Date(s.created_at);
    return d.toDateString() === new Date().toDateString();
  }).length;

  function assertCanAnalyze(): boolean {
    if (!isPro && todaySwings >= dailyLimit) {
      openPaywall();
      return false;
    }
    return true;
  }

  function onRecord() {
    if (!assertCanAnalyze()) return;
    router.push('/(tabs)/analyze/record');
  }

  async function onPickFromLibrary() {
    if (!assertCanAnalyze()) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setPendingUri(result.assets[0].uri);
    setPickedAt(new Date());
  }

  function togglePlayPause() {
    if (!player || isImage) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setIsPlaying((v) => !v);
  }

  function clearPick() {
    setPendingUri(null);
    setPickedAt(null);
    setNotes('');
  }

  async function onSaveSwing() {
    if (!pendingUri || !assertCanAnalyze()) return;
    const uri = pendingUri;
    const club = selectedClub;
    await saveShareMode(shareMode);
    setPendingShareMode(shareMode);
    router.push({
      pathname: '/(tabs)/analyze/processing',
      params: { uri: encodeVideoUriForRoute(uri), club },
    });
    // Tab stays mounted; clear so returning here is a clean slate (not the old clip).
    clearPick();
  }

  function scrollToRecent() {
    scrollRef.current?.scrollTo({ y: Math.max(0, recentSectionY.current - 12), animated: true });
  }

  function handleDeleteRecent(swing: (typeof swings)[number]) {
    Alert.alert(
      'Delete swing',
      'Remove this swing from your account? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(swing.id);
            try {
              await deleteSwing(swing.id);
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Delete failed.';
              Alert.alert('Error', msg);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  }

  const primaryCta =
    shareMode === 'feed'
      ? 'Save & share'
      : shareMode === 'friends'
        ? 'Save & share with friends'
        : isImage
          ? 'Save Swing'
          : 'Analyze swing';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollInner, { paddingBottom: footerPad + (pendingUri ? 80 : 28) }]}
      >
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: H_PAD }]}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>Upload Swing</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Track your progress and improve your game.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.headerIcon, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            onPress={scrollToRecent}
            hitSlop={10}
            accessibilityLabel="Recent uploads"
          >
            <Ionicons name="time-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Hero upload card */}
        <View style={[styles.heroWrap, { paddingHorizontal: H_PAD }]}>
          <View
            style={[
              styles.heroCard,
              {
                borderColor: 'rgba(52,224,111,0.22)',
                backgroundColor: theme === 'dark' ? 'rgba(20, 22, 20, 0.96)' : colors.surface,
              },
            ]}
          >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={[styles.heroGlow, { width: SCREEN_W * 0.5 }]} />
              <View style={styles.heroGlowBR} />
            </View>

            <View style={styles.heroIconRing}>
              <Ionicons name="golf" size={32} color={ACCENT} />
            </View>
            <Text style={[styles.heroTitle, { color: colors.text }]}>Upload or record your swing</Text>
            <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
              Get lightweight AI feedback and track your progress.
            </Text>

            <View style={styles.heroBtns}>
              <TouchableOpacity
                style={[styles.heroBtnPrimary, { shadowColor: ACCENT }]}
                onPress={onRecord}
                activeOpacity={0.9}
              >
                <Ionicons name="videocam" size={20} color="#0A0A0A" />
                <Text style={styles.heroBtnPrimaryText}>Record Swing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.heroBtnSecondary, { borderColor: 'rgba(52,224,111,0.35)', backgroundColor: ACCENT_SOFT }]}
                onPress={onPickFromLibrary}
                activeOpacity={0.88}
              >
                <Ionicons name="cloud-upload-outline" size={20} color={ACCENT} />
                <Text style={styles.heroBtnSecondaryText}>Upload Video</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Preview */}
        {pendingUri ? (
          <View style={[styles.section, { paddingHorizontal: H_PAD }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Preview</Text>
            <View style={[styles.previewCard, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
              <Pressable style={styles.previewMedia} onPress={isImage ? undefined : togglePlayPause}>
                {isImage ? (
                  <Image source={{ uri: pendingUri }} style={styles.previewFill} resizeMode="cover" />
                ) : (
                  <>
                    <VideoView player={player} style={styles.previewFill} contentFit="cover" nativeControls={false} />
                    <View style={styles.previewOverlay} pointerEvents="none">
                      {!isPlaying && (
                        <View style={styles.playCircle}>
                          <Ionicons name="play" size={28} color="#FFF" />
                        </View>
                      )}
                    </View>
                  </>
                )}
                <View style={styles.sloMoChip}>
                  <Ionicons name="speedometer-outline" size={12} color={ACCENT} />
                  <Text style={styles.sloMoText}>Review</Text>
                </View>
              </Pressable>
              <View style={styles.previewMeta}>
                <Text style={[styles.previewTime, { color: colors.textMuted }]}>
                  {pickedAt ? formatPickTime(pickedAt) : ''}
                </Text>
                <View style={[styles.clubMetaPill, { backgroundColor: ACCENT_SOFT, borderColor: 'rgba(52,224,111,0.25)' }]}>
                  <Text style={[styles.clubMetaText, { color: ACCENT }]}>{selectedClub}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={clearPick} style={styles.changeClip}>
                <Text style={[styles.changeClipText, { color: colors.textSecondary }]}>Choose different clip</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Club family */}
        <View style={[styles.section, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Club</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {CLUB_FAMILIES.map((f) => {
              const on = clubFamily === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setClubFamily(f.id)}
                  style={[
                    styles.clubPill,
                    {
                      borderColor: on ? ACCENT : colors.border,
                      backgroundColor: on ? ACCENT_SOFT : colors.surfaceAlt,
                      shadowColor: on ? ACCENT : 'transparent',
                      shadowOpacity: on ? 0.35 : 0,
                      shadowRadius: on ? 10 : 0,
                      shadowOffset: { width: 0, height: 0 },
                    },
                  ]}
                >
                  <Text style={[styles.clubPillLabel, { color: on ? ACCENT : colors.text }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Notes */}
        <View style={[styles.section, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Notes (optional)</Text>
          <TextInput
            style={[
              styles.notesField,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
            ]}
            placeholder="What were you working on during this swing?"
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={280}
          />
        </View>

        {/* Coach AI */}
        {pendingUri ? (
          <View style={[styles.section, { paddingHorizontal: H_PAD }]}>
            <View style={[styles.coachCard, { borderColor: 'rgba(52,224,111,0.25)', backgroundColor: colors.surfaceAlt }]}>
              <View style={styles.coachHeader}>
                <Ionicons name="sparkles" size={18} color={ACCENT} />
                <Text style={[styles.coachTitle, { color: colors.text }]}>Ask Coach AI about this swing</Text>
              </View>
              <View style={styles.coachChips}>
                {COACH_PROMPTS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.coachChip, { borderColor: colors.border, backgroundColor: colors.background }]}
                    onPress={() => router.push('/(tabs)/coach')}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.coachChipText, { color: colors.textSecondary }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.openCoachBtn} onPress={() => router.push('/(tabs)/coach')} activeOpacity={0.9}>
                <Text style={styles.openCoachBtnText}>Open Coach AI</Text>
                <Ionicons name="arrow-forward" size={16} color="#0A0A0A" />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Share */}
        <View style={[styles.section, { paddingHorizontal: H_PAD }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Visibility</Text>
          <View style={[styles.segment, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            {(
              [
                { mode: 'private' as const, label: 'Private', icon: 'lock-closed-outline' as const },
                { mode: 'friends' as const, label: 'Friends', icon: 'people-outline' as const },
                { mode: 'feed' as const, label: 'Feed', icon: 'globe-outline' as const },
              ] as const
            ).map(({ mode, label, icon }) => {
              const on = shareMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.segmentCell,
                    on && { backgroundColor: ACCENT_SOFT, borderColor: ACCENT },
                    { borderColor: on ? ACCENT : 'transparent' },
                  ]}
                  onPress={() => {
                    setShareMode(mode);
                    setPendingShareMode(mode);
                    void saveShareMode(mode);
                  }}
                  activeOpacity={0.88}
                >
                  <Ionicons name={icon} size={16} color={on ? ACCENT : colors.textMuted} />
                  <Text style={[styles.segmentLabel, { color: on ? ACCENT : colors.textSecondary }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View
            style={[
              styles.visibilityCard,
              {
                borderColor: theme === 'dark' ? 'rgba(52,224,111,0.2)' : colors.border,
                backgroundColor: theme === 'dark' ? 'rgba(52,224,111,0.06)' : ACCENT_SOFT,
              },
            ]}
          >
            <Text style={[styles.visibilityTitle, { color: colors.text }]}>{visibilityPreview.title}</Text>
            <Text style={[styles.visibilitySummary, { color: colors.textSecondary }]}>
              {visibilityPreview.summary}
            </Text>
            <View style={styles.visibilityBullets}>
              {visibilityPreview.bullets.map((line) => (
                <View key={line} style={styles.visibilityBulletRow}>
                  <Ionicons name="checkmark-circle" size={14} color={ACCENT} />
                  <Text style={[styles.visibilityBulletTxt, { color: colors.textSecondary }]}>{line}</Text>
                </View>
              ))}
            </View>
            <View style={styles.visibilityAudienceRow}>
              <Text style={[styles.visibilityAudienceLbl, { color: colors.textMuted }]}>Who can see this</Text>
              <View style={styles.visibilityAudienceChips}>
                {visibilityAudience.map((who) => (
                  <View
                    key={who}
                    style={[
                      styles.visibilityAudienceChip,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceAlt,
                      },
                    ]}
                  >
                    <Text style={[styles.visibilityAudienceChipTxt, { color: colors.text }]}>{who}</Text>
                  </View>
                ))}
              </View>
            </View>
            {visibilityPreview.socialHint && shareMode !== 'private' ? (
              <TouchableOpacity
                style={styles.visibilitySocialLink}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/friends',
                    params: { segment: 'feed' },
                  })
                }
                activeOpacity={0.88}
              >
                <Text style={[styles.visibilitySocialLinkTxt, { color: ACCENT }]}>
                  {visibilityPreview.socialHint}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={ACCENT} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Recent */}
        <View
          onLayout={(e) => {
            recentSectionY.current = e.nativeEvent.layout.y;
          }}
          style={[styles.section, { paddingHorizontal: H_PAD }]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Uploads</Text>
          {swings.length === 0 ? (
            <Text style={[styles.emptyRecent, { color: colors.textMuted }]}>
              Your analyzed swings will show up here.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
              {swings.slice(0, 10).map((swing) => {
                const score = getSwingScore(swing.result_json);
                const busy = deletingId === swing.id;
                return (
                  <View
                    key={swing.id}
                    style={[styles.recentCard, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                  >
                    <TouchableOpacity
                      style={styles.recentCardInner}
                      onPress={() =>
                        router.push({ pathname: '/(tabs)/analyze/swing/[id]', params: { id: swing.id } })
                      }
                      activeOpacity={0.88}
                      disabled={busy}
                    >
                      <SwingThumbnail swing={swing} size="md" />
                      <Text style={[styles.recentDate, { color: colors.textMuted }]}>{formatSwingDate(swing.created_at)}</Text>
                      <View style={[styles.scoreDot, { backgroundColor: ACCENT_SOFT }]}>
                        <Text style={[styles.scoreTxt, { color: ACCENT }]}>{score}</Text>
                      </View>
                      <View style={styles.replayRow}>
                        <Ionicons name="play-circle-outline" size={18} color={colors.text} />
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.recentTrash, { backgroundColor: colors.background }]}
                      onPress={() => handleDeleteRecent(swing)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={deletingId !== null}
                      accessibilityLabel="Delete swing"
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color="#FF453A" />
                      ) : (
                        <Ionicons name="trash-outline" size={16} color="#FF453A" />
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </ScrollView>

      {pendingUri ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: footerPad,
              backgroundColor: colors.background,
              borderTopColor: 'rgba(255,255,255,0.07)',
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.cta,
              { shadowColor: ACCENT, shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
            ]}
            onPress={onSaveSwing}
            activeOpacity={0.92}
          >
            <Text style={styles.ctaText}>{primaryCta}</Text>
            <Ionicons name="arrow-forward" size={20} color="#0A0A0A" />
          </TouchableOpacity>
        </View>
      ) : null}

      <Paywall />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollInner: { paddingTop: 4 },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 18,
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 20, fontWeight: '500', marginTop: 6 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroWrap: { marginBottom: 22 },
  heroCard: {
    borderRadius: 26,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 22,
    overflow: 'hidden',
    shadowColor: ACCENT_GLOW,
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  heroGlow: {
    position: 'absolute',
    top: -60,
    left: -40,
    height: 180,
    borderRadius: 90,
    backgroundColor: ACCENT_GLOW,
    opacity: 0.18,
  },
  heroGlowBR: {
    position: 'absolute',
    bottom: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  heroIconRing: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroSub: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  heroBtns: { gap: 12 },
  heroBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 16,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  heroBtnPrimaryText: { fontSize: 17, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.2 },
  heroBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 15,
  },
  heroBtnSecondaryText: { fontSize: 16, fontWeight: '800', color: ACCENT, letterSpacing: -0.1 },

  section: { marginBottom: 22 },
  sectionTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, marginBottom: 12 },

  previewCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  previewMedia: {
    borderRadius: 16,
    overflow: 'hidden',
    height: 200,
    backgroundColor: '#0A0A0A',
  },
  previewFill: { width: '100%', height: '100%' },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  sloMoChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(52,224,111,0.35)',
  },
  sloMoText: { fontSize: 11, fontWeight: '800', color: '#FFF', letterSpacing: 0.3 },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewTime: { fontSize: 12, fontWeight: '600' },
  clubMetaPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clubMetaText: { fontSize: 12, fontWeight: '800' },
  changeClip: { alignSelf: 'center', paddingVertical: 4 },
  changeClipText: { fontSize: 13, fontWeight: '600' },

  pillRow: { gap: 10, paddingRight: 8 },
  clubPill: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 4,
  },
  clubPillLabel: { fontSize: 14, fontWeight: '800' },

  notesField: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },

  coachCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  coachHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coachTitle: { flex: 1, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  coachChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  coachChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coachChipText: { fontSize: 12, fontWeight: '700' },
  openCoachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 12,
  },
  openCoachBtnText: { fontSize: 15, fontWeight: '800', color: '#0A0A0A' },

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
    paddingHorizontal: 6,
  },
  segmentLabel: { fontSize: 12, fontWeight: '800' },

  visibilityCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  visibilityMockPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 2,
  },
  visibilityMockPillTxt: { fontSize: 10, fontWeight: '800', color: ACCENT, letterSpacing: 0.6 },
  visibilityTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.25 },
  visibilitySummary: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  visibilityBullets: { gap: 8, marginTop: 2 },
  visibilityBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  visibilityBulletTxt: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  visibilityAudienceRow: { gap: 8, marginTop: 4 },
  visibilityAudienceLbl: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  visibilityAudienceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  visibilityAudienceChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  visibilityAudienceChipTxt: { fontSize: 12, fontWeight: '700' },
  visibilitySocialLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 4,
  },
  visibilitySocialLinkTxt: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },

  emptyRecent: { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  recentRow: { gap: 12, paddingBottom: 4 },
  recentCard: {
    width: 128,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  recentCardInner: {
    padding: 10,
    gap: 8,
    alignItems: 'center',
  },
  recentTrash: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,69,58,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentDate: { fontSize: 11, fontWeight: '600' },
  scoreDot: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  scoreTxt: { fontSize: 13, fontWeight: '800' },
  replayRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: H_PAD,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 16,
    elevation: 6,
  },
  ctaText: { fontSize: 17, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.2 },
});
