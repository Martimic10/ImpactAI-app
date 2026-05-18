import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ACTIVE = '#34E06F';
const UPLOAD_FAB_SIZE = 56;

const TABS: {
  name: string;
  label: string;
  icon?: IoniconName;
  iconActive?: IoniconName;
  isUploadFab?: boolean;
}[] = [
  { name: 'analyze', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  {
    name: 'coach',
    label: 'Coach',
    icon: 'chatbubble-ellipses-outline',
    iconActive: 'chatbubble-ellipses',
  },
  { name: 'upload', label: 'Upload', isUploadFab: true },
  { name: 'friends', label: 'Social', icon: 'people-outline', iconActive: 'people' },
  {
    name: 'profile',
    label: 'Profile',
    icon: 'person-circle-outline',
    iconActive: 'person-circle',
  },
];

function UploadTabIcon({ ringColor }: { ringColor: string }) {
  return (
    <View style={styles.uploadWrap}>
      <View style={[styles.uploadFab, { borderColor: ringColor }]}>
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </View>
    </View>
  );
}

function TabIcon({
  icon,
  iconActive,
  label,
  focused,
  activeColor,
  inactiveColor,
}: {
  icon: IoniconName;
  iconActive: IoniconName;
  label: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <View style={styles.tabItem}>
      <Ionicons
        name={focused ? iconActive : icon}
        size={24}
        color={focused ? activeColor : inactiveColor}
      />
      <Text
        style={[styles.tabLabel, { color: focused ? activeColor : inactiveColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.55}
        allowFontScaling
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const isLight = theme === 'light';
  const inactiveColor = isLight ? '#66727F' : '#666666';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        lazy: false,
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ],
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={
            tab.isUploadFab
              ? {
                  tabBarIcon: () => <UploadTabIcon ringColor={colors.background} />,
                  tabBarLabel: () => null,
                }
              : {
                  tabBarIcon: ({ focused }) => (
                    <TabIcon
                      icon={tab.icon!}
                      iconActive={tab.iconActive!}
                      label={tab.label}
                      focused={focused}
                      activeColor={ACTIVE}
                      inactiveColor={inactiveColor}
                    />
                  ),
                }
          }
        />
      ))}
      <Tabs.Screen
        name="progress"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    height: Platform.OS === 'ios' ? 100 : 76,
    elevation: 12,
    position: 'absolute',
  },
  tabBarItem: {
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: 0,
  },
  tabItem: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 0,
    paddingHorizontal: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.02,
    width: '100%',
    textAlign: 'center',
  },
  uploadWrap: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: UPLOAD_FAB_SIZE,
    marginTop: Platform.OS === 'ios' ? -22 : -18,
  },
  uploadFab: {
    width: UPLOAD_FAB_SIZE,
    height: UPLOAD_FAB_SIZE,
    borderRadius: UPLOAD_FAB_SIZE / 2,
    backgroundColor: ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
      },
      android: {
        elevation: 10,
      },
    }),
  },
});
