import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { usePreferences, GoalFocus } from '@/hooks/usePreferences';
import { DEV_MODE } from '@/lib/devMode';
import { useAppColors } from '@/lib/theme';
import { ProfileAvatar } from '@/components/ProfileAvatar';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type PreferenceSection = 'swingGoals' | 'notifications' | 'privacy' | 'help';

function MenuRow({
  icon,
  label,
  onPress,
  colors,
  danger,
  chevron = true,
  expanded = false,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useAppColors>;
  danger?: boolean;
  chevron?: boolean;
  expanded?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.menuRow}>
      <View style={[styles.menuIconWrap, danger && styles.menuIconWrapDanger, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.textMuted} />
      </View>
      <Text style={[styles.menuLabel, { color: colors.text }, danger && { color: colors.danger }]}>{label}</Text>
      {chevron && (
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const colors = useAppColors();
  const { user, signOut, updateAvatar } = useAuth();
  const { prefs, setGoalFocus, setProfilePrivate, setFriendsOnly } = usePreferences();

  const [openSection, setOpenSection] = useState<PreferenceSection | null>(null);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const isDark = theme === 'dark';
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'U';

  const switchTrack = useMemo(
    () => ({ false: isDark ? '#3A3A3A' : '#B6C3D1', true: colors.success }),
    [colors.success, isDark],
  );

  function toggleSection(section: PreferenceSection) {
    setOpenSection((c) => (c === section ? null : section));
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
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not update profile image.');
    } finally {
      setAvatarLoading(false);
    }
  }

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
            Alert.alert('Error', err instanceof Error ? err.message : 'Sign out failed.');
          }
        },
      },
    ]);
  }

  if (!user) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={[styles.miniProfile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity onPress={handleAvatarPress} style={styles.avatarTap} activeOpacity={0.85}>
            <ProfileAvatar size="lg" imageUri={user.avatar_url} initials={initials} />
            <View style={[styles.camBadge, { borderColor: colors.background, backgroundColor: '#34E06F' }]}>
              {avatarLoading ? (
                <ActivityIndicator size="small" color="#0A0A0A" />
              ) : (
                <Ionicons name="camera" size={12} color="#0A0A0A" />
              )}
            </View>
          </TouchableOpacity>
          <Text style={[styles.miniName, { color: colors.text }]}>{user.username}</Text>
          <Text style={[styles.miniHint, { color: colors.textMuted }]}>Tap photo to update</Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Preferences</Text>
        <View style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MenuRow
            icon="golf-outline"
            label="Swing goals"
            onPress={() => toggleSection('swingGoals')}
            expanded={openSection === 'swingGoals'}
            colors={colors}
          />
          {openSection === 'swingGoals' && (
            <View style={[styles.panel, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.panelTitle, { color: colors.textSecondary }]}>Primary focus</Text>
              <View style={styles.chipRow}>
                {(['Consistency', 'Distance', 'Accuracy'] as GoalFocus[]).map((goal) => {
                  const active = prefs.goalFocus === goal;
                  return (
                    <TouchableOpacity
                      key={goal}
                      onPress={() => setGoalFocus(goal)}
                      style={[
                        styles.chip,
                        { borderColor: colors.border, backgroundColor: colors.background },
                        active && { borderColor: '#34E06F', backgroundColor: 'rgba(52,224,111,0.12)' },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: colors.textSecondary }, active && { color: '#34E06F' }]}>
                        {goal}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MenuRow
            icon="notifications-outline"
            label="Notifications"
            onPress={() => toggleSection('notifications')}
            expanded={openSection === 'notifications'}
            colors={colors}
          />
          {openSection === 'notifications' && (
            <View style={[styles.panel, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>Push reminders</Text>
                <Switch value={pushEnabled} onValueChange={setPushEnabled} trackColor={switchTrack} thumbColor="#FFF" />
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>Email updates</Text>
                <Switch value={emailEnabled} onValueChange={setEmailEnabled} trackColor={switchTrack} thumbColor="#FFF" />
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>Dark mode</Text>
                <Switch
                  value={theme === 'dark'}
                  onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
                  trackColor={switchTrack}
                  thumbColor="#FFF"
                />
              </View>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MenuRow
            icon="shield-outline"
            label="Privacy"
            onPress={() => toggleSection('privacy')}
            expanded={openSection === 'privacy'}
            colors={colors}
          />
          {openSection === 'privacy' && (
            <View style={[styles.panel, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>Private profile</Text>
                <Switch
                  value={prefs.profilePrivate}
                  onValueChange={setProfilePrivate}
                  trackColor={switchTrack}
                  thumbColor="#FFF"
                />
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>Friends-only sharing</Text>
                <Switch
                  value={prefs.friendsOnly}
                  onValueChange={setFriendsOnly}
                  trackColor={switchTrack}
                  thumbColor="#FFF"
                />
              </View>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MenuRow
            icon="help-circle-outline"
            label="Help & Support"
            onPress={() => toggleSection('help')}
            expanded={openSection === 'help'}
            colors={colors}
          />
          {openSection === 'help' && (
            <View style={[styles.panel, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => Alert.alert('FAQ', 'FAQ screen coming soon.')}
                style={styles.helpRow}
              >
                <Text style={[styles.helpText, { color: colors.text }]}>View FAQ</Text>
                <Ionicons name="open-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                onPress={() => Alert.alert('Contact support', 'Email us at support@impactai.app')}
                style={styles.helpRow}
              >
                <Text style={[styles.helpText, { color: colors.text }]}>Contact Support</Text>
                <Ionicons name="mail-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                onPress={() => Alert.alert('Terms & Privacy', 'Terms and Privacy screen coming soon.')}
                style={styles.helpRow}
              >
                <Text style={[styles.helpText, { color: colors.text }]}>Terms & Privacy</Text>
                <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Account</Text>
        <View style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MenuRow icon="log-out-outline" label="Sign out" onPress={handleSignOut} danger colors={colors} />
        </View>

        <Text style={[styles.version, { color: colors.textMuted }]}>ImpactAI v{appVersion}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  miniProfile: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  avatarTap: { marginBottom: 10, position: 'relative' },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniName: { fontSize: 18, fontWeight: '800' },
  miniHint: { fontSize: 12, marginTop: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 22,
    marginTop: 20,
    marginBottom: 8,
  },
  menuCard: {
    marginHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconWrapDanger: { backgroundColor: 'rgba(255,69,58,0.12)' },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },
  panel: { marginHorizontal: 12, marginBottom: 12, borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  panelTitle: { fontSize: 12, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  helpText: { fontSize: 14, fontWeight: '500' },
  version: { textAlign: 'center', fontSize: 12, marginTop: 24 },
});
