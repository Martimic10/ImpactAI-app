import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Switch,
  Image,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { hasProAccess, isAdmin, PLAN_LIMITS } from '@/lib/plans';
import { DEV_MODE } from '@/lib/devMode';
import { useTheme } from '@/hooks/useTheme';
import { PaywallModal } from '@/components/PaywallModal';
import { getSwingScore } from '@/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type PreferenceSection = 'swingGoals' | 'notifications' | 'privacy' | 'help';
type GoalFocus = 'Consistency' | 'Distance' | 'Accuracy';

type ThemeColors = {
  bg: string;
  title: string;
  sectionLabel: string;
  card: string;
  cardBorder: string;
  cardBorderSoft: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  iconMuted: string;
  success: string;
  successBg: string;
  successBorder: string;
  pillBg: string;
  pillBorder: string;
  inputBg: string;
  dropdownBg: string;
  dropdownBorder: string;
  divider: string;
  danger: string;
  dangerBg: string;
  accent: string;
  accentText: string;
  badgeBorder: string;
  cameraBadgeBg: string;
  cameraBadgeIcon: string;
  switchTrackOff: string;
  switchTrackOn: string;
};

const DARK: ThemeColors = {
  bg: '#0D0D0D',
  title: '#FFFFFF',
  sectionLabel: '#555555',
  card: '#161616',
  cardBorder: '#282828',
  cardBorderSoft: '#242424',
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textMuted: '#666666',
  iconMuted: '#888888',
  success: '#4CAF50',
  successBg: '#1B2E1B',
  successBorder: '#2E7D32',
  pillBg: '#242424',
  pillBorder: '#333333',
  inputBg: '#1E1E1E',
  dropdownBg: '#131313',
  dropdownBorder: '#232323',
  divider: '#242424',
  danger: '#FF453A',
  dangerBg: '#2A0A0A',
  accent: '#B6FF2F',
  accentText: '#0D0D0D',
  badgeBorder: '#0D0D0D',
  cameraBadgeBg: '#B6FF2F',
  cameraBadgeIcon: '#0D0D0D',
  switchTrackOff: '#3A3A3A',
  switchTrackOn: '#4CAF50',
};

const LIGHT: ThemeColors = {
  bg: '#F3F6F9',
  title: '#0E1924',
  sectionLabel: '#6A7682',
  card: '#FFFFFF',
  cardBorder: '#D6DEE7',
  cardBorderSoft: '#E2E8EF',
  textPrimary: '#111B26',
  textSecondary: '#556270',
  textMuted: '#758292',
  iconMuted: '#5E6B78',
  success: '#2E9E48',
  successBg: '#EBF8EF',
  successBorder: '#9ED8AE',
  pillBg: '#EEF3F8',
  pillBorder: '#D4DEE8',
  inputBg: '#F6F9FC',
  dropdownBg: '#F9FBFD',
  dropdownBorder: '#DCE5EE',
  divider: '#E1E8EF',
  danger: '#D5362D',
  dangerBg: '#FFE9E8',
  accent: '#B0F33A',
  accentText: '#111B26',
  badgeBorder: '#FFFFFF',
  cameraBadgeBg: '#B0F33A',
  cameraBadgeIcon: '#111B26',
  switchTrackOff: '#B6C3D1',
  switchTrackOn: '#45B65A',
};

function StatCard({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  colors,
  styles,
  danger,
  chevron = true,
  expanded = false,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  danger?: boolean;
  chevron?: boolean;
  expanded?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.menuRow}>
      <View style={[styles.menuIconWrap, danger && styles.menuIconWrapDanger]}>
        <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.iconMuted} />
      </View>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {chevron && (
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { user, signOut, updateAvatar } = useAuth();
  const { swings } = useSwings(user?.id);
  const { theme, setTheme } = useTheme();

  const isDark = theme === 'dark';
  const colors = isDark ? DARK : LIGHT;
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [showPaywall, setShowPaywall] = useState(false);
  const [openSection, setOpenSection] = useState<PreferenceSection | null>(null);
  const [goalFocus, setGoalFocus] = useState<GoalFocus>('Consistency');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [profilePrivate, setProfilePrivate] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(true);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const isPro = hasProAccess(user);
  const admin = isAdmin(user);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const dailyLimit = PLAN_LIMITS[user?.plan ?? 'free'].swingsPerDay;
  const todayUsed = swings.filter((s) => {
    return new Date(s.created_at).toDateString() === new Date().toDateString();
  }).length;

  const avgScore =
    swings.length > 0
      ? Math.round(swings.reduce((s, sw) => s + getSwingScore(sw.result_json), 0) / swings.length)
      : 0;

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'U';

  async function handleSignOut() {
    if (DEV_MODE) {
      Alert.alert('Dev Mode', 'Sign out is disabled in dev mode.');
      return;
    }
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Sign out failed.';
            Alert.alert('Error', message);
          }
        },
      },
    ]);
  }

  function handleUpgrade() {
    setShowPaywall(true);
  }

  function toggleSection(section: PreferenceSection) {
    setOpenSection((current) => (current === section ? null : section));
  }

  async function handleAvatarPress() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to change your profile image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      setAvatarLoading(true);
      await updateAvatar(result.assets[0].uri);
      Alert.alert('Updated', 'Your profile image was updated.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not update profile image.';
      Alert.alert('Error', message);
    } finally {
      setAvatarLoading(false);
    }
  }

  if (!user) return null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
        <Text style={styles.pageTitle}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.profileRow}>
            <TouchableOpacity style={styles.avatar} onPress={handleAvatarPress} activeOpacity={0.85}>
              {user.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
              <View style={styles.avatarEditBadge}>
                {avatarLoading ? (
                  <ActivityIndicator size="small" color={colors.cameraBadgeIcon} />
                ) : (
                  <Ionicons name="camera" size={12} color={colors.cameraBadgeIcon} />
                )}
              </View>
            </TouchableOpacity>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user.username}</Text>
              <Text style={styles.profileSub}>
                {admin ? 'Admin account' : `${swings.length} swings · ${isPro ? 'Pro member' : 'Free plan'}`}
              </Text>
            </View>
            <View style={[styles.planPill, isPro && styles.planPillPro]}>
              <Ionicons name="flash" size={11} color={isPro ? colors.success : colors.iconMuted} />
              <Text style={[styles.planPillText, isPro && styles.planPillTextPro]}>
                {admin ? 'ADMIN' : isPro ? 'PRO' : 'FREE'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="SWINGS" value={swings.length.toString()} styles={styles} />
          <StatCard label="AVG" value={avgScore > 0 ? avgScore.toString() : '—'} styles={styles} />
          <StatCard
            label="USED"
            value={dailyLimit === Infinity ? `${todayUsed}/∞` : `${todayUsed}/${dailyLimit}`}
            styles={styles}
          />
        </View>

        {!isPro && (
          <TouchableOpacity style={styles.upgradeCard} onPress={handleUpgrade} activeOpacity={0.85}>
            <View style={styles.upgradeIconWrap}>
              <Ionicons name="sparkles" size={18} color={colors.success} />
            </View>
            <View style={styles.upgradeText}>
              <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
              <Text style={styles.upgradeSub}>Unlimited analyses · drills · pro comparisons</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>Preferences</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon="golf-outline"
            label="Swing goals"
            onPress={() => toggleSection('swingGoals')}
            expanded={openSection === 'swingGoals'}
            styles={styles}
            colors={colors}
          />
          {openSection === 'swingGoals' && (
            <View style={styles.dropdownPanel}>
              <Text style={styles.dropdownTitle}>Primary focus</Text>
              <View style={styles.goalChips}>
                {(['Consistency', 'Distance', 'Accuracy'] as GoalFocus[]).map((goal) => {
                  const active = goalFocus === goal;
                  return (
                    <TouchableOpacity
                      key={goal}
                      onPress={() => setGoalFocus(goal)}
                      activeOpacity={0.8}
                      style={[styles.goalChip, active && styles.goalChipActive]}
                    >
                      <Text style={[styles.goalChipText, active && styles.goalChipTextActive]}>{goal}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.menuDivider} />
          <MenuRow
            icon="notifications-outline"
            label="Notifications"
            onPress={() => toggleSection('notifications')}
            expanded={openSection === 'notifications'}
            styles={styles}
            colors={colors}
          />
          {openSection === 'notifications' && (
            <View style={styles.dropdownPanel}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Push reminders</Text>
                  <Text style={styles.toggleSubtitle}>Daily swing practice nudges</Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={setPushEnabled}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.dropdownInnerDivider} />
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Email updates</Text>
                  <Text style={styles.toggleSubtitle}>Weekly progress and tips</Text>
                </View>
                <Switch
                  value={emailEnabled}
                  onValueChange={setEmailEnabled}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.dropdownInnerDivider} />
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Dark mode</Text>
                  <Text style={styles.toggleSubtitle}>Switch between light and dark appearance</Text>
                </View>
                <Switch
                  value={theme === 'dark'}
                  onValueChange={(value) => setTheme(value ? 'dark' : 'light')}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          )}

          <View style={styles.menuDivider} />
          <MenuRow
            icon="shield-outline"
            label="Privacy"
            onPress={() => toggleSection('privacy')}
            expanded={openSection === 'privacy'}
            styles={styles}
            colors={colors}
          />
          {openSection === 'privacy' && (
            <View style={styles.dropdownPanel}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Private profile</Text>
                  <Text style={styles.toggleSubtitle}>Hide your stats from public view</Text>
                </View>
                <Switch
                  value={profilePrivate}
                  onValueChange={setProfilePrivate}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.dropdownInnerDivider} />
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Friends-only sharing</Text>
                  <Text style={styles.toggleSubtitle}>Restrict shared swings to friends</Text>
                </View>
                <Switch
                  value={friendsOnly}
                  onValueChange={setFriendsOnly}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          )}

          <View style={styles.menuDivider} />
          <MenuRow
            icon="help-circle-outline"
            label="Help & Support"
            onPress={() => toggleSection('help')}
            expanded={openSection === 'help'}
            styles={styles}
            colors={colors}
          />
          {openSection === 'help' && (
            <View style={styles.dropdownPanel}>
              <TouchableOpacity
                onPress={() => Alert.alert('FAQ', 'FAQ screen coming next.')}
                style={styles.helpAction}
                activeOpacity={0.8}
              >
                <Text style={styles.helpActionText}>View FAQ</Text>
                <Ionicons name="open-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={styles.dropdownInnerDivider} />
              <TouchableOpacity
                onPress={() => Alert.alert('Contact support', 'Email us at support@impactai.app')}
                style={styles.helpAction}
                activeOpacity={0.8}
              >
                <Text style={styles.helpActionText}>Contact Support</Text>
                <Ionicons name="mail-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={styles.dropdownInnerDivider} />
              <TouchableOpacity
                onPress={() => Alert.alert('Terms & Privacy', 'Terms and Privacy screen coming next.')}
                style={styles.helpAction}
                activeOpacity={0.8}
              >
                <Text style={styles.helpActionText}>Terms & Privacy</Text>
                <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon="trash-outline"
            label="Delete all swings"
            onPress={() =>
              Alert.alert('Delete all swings?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive' },
              ])
            }
            danger
            styles={styles}
            colors={colors}
          />
          <View style={styles.menuDivider} />
          <MenuRow icon="log-out-outline" label="Sign out" onPress={handleSignOut} styles={styles} colors={colors} />
        </View>

        <Text style={styles.version}>ImpactAI v{appVersion}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    pageTitle: {
      fontSize: 32,
      fontWeight: '800',
      color: colors.title,
      letterSpacing: -0.5,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 20,
    },

    card: {
      marginHorizontal: 16,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 16,
      marginBottom: 12,
    },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.successBg,
      borderWidth: 2,
      borderColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
    },
    avatarImage: {
      width: '100%',
      height: '100%',
      borderRadius: 26,
    },
    avatarText: { fontSize: 18, fontWeight: '800', color: colors.success },
    avatarEditBadge: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.cameraBadgeBg,
      borderWidth: 1,
      borderColor: colors.badgeBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileInfo: { flex: 1 },
    profileName: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    profileSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    planPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      backgroundColor: colors.pillBg,
      borderWidth: 1,
      borderColor: colors.pillBorder,
    },
    planPillPro: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
    planPillText: { fontSize: 11, fontWeight: '700', color: colors.iconMuted, letterSpacing: 0.5 },
    planPillTextPro: { color: colors.success },

    statsRow: {
      flexDirection: 'row',
      marginHorizontal: 16,
      gap: 10,
      marginBottom: 12,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 14,
      paddingHorizontal: 14,
      gap: 6,
    },
    statLabel: { fontSize: 10, fontWeight: '700', color: colors.sectionLabel, letterSpacing: 1 },
    statValue: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },

    upgradeCard: {
      marginHorizontal: 16,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 28,
    },
    upgradeIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.successBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    upgradeText: { flex: 1 },
    upgradeTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    upgradeSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

    sectionLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.sectionLabel,
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      marginBottom: 8,
    },

    menuCard: {
      marginHorizontal: 16,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      overflow: 'hidden',
      marginBottom: 28,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 15,
    },
    menuIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.inputBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    menuIconWrapDanger: { backgroundColor: colors.dangerBg },
    menuLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    menuLabelDanger: { color: colors.danger },
    menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: 62 },

    dropdownPanel: {
      backgroundColor: colors.dropdownBg,
      marginHorizontal: 12,
      marginBottom: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dropdownBorder,
      padding: 12,
      gap: 10,
    },
    dropdownTitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
    goalChips: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    goalChip: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.pillBorder,
      backgroundColor: colors.pillBg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    goalChipActive: {
      borderColor: colors.successBorder,
      backgroundColor: colors.successBg,
    },
    goalChipText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    goalChipTextActive: {
      color: colors.success,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    toggleCopy: {
      flex: 1,
      gap: 2,
    },
    toggleTitle: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    toggleSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    dropdownInnerDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
    helpAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    helpActionText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '500',
    },

    version: {
      textAlign: 'center',
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
    },
  });
}
