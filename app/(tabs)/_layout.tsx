import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: {
  name: string;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
}[] = [
  { name: 'analyze',  label: 'Home',     icon: 'home-outline',          iconActive: 'home'           },
  { name: 'progress', label: 'Progress', icon: 'trending-up-outline',   iconActive: 'trending-up'    },
  { name: 'compare',  label: 'Compare',  icon: 'git-compare-outline',   iconActive: 'git-compare'    },
  { name: 'friends',  label: 'Friends',  icon: 'people-outline',        iconActive: 'people'         },
  { name: 'profile',  label: 'Profile',  icon: 'person-circle-outline', iconActive: 'person-circle'  },
];

function TabIcon({
  icon, iconActive, label, focused, activeColor, inactiveColor,
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
        size={26}
        color={focused ? activeColor : inactiveColor}
      />
      <Text style={[styles.tabLabel, { color: focused ? activeColor : inactiveColor }]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const activeColor = '#4CAF50';
  const inactiveColor = isLight ? '#66727F' : '#666666';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: [styles.tabBar, { borderTopColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }],
        tabBarItemStyle: styles.tabBarItem,
        tabBarBackground: () => (
          <View
            style={[
              styles.tabBarBg,
              { backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(10,10,10,0.88)' },
            ]}
          />
        ),
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon
                icon={tab.icon}
                iconActive={tab.iconActive}
                label={tab.label}
                focused={focused}
                activeColor={activeColor}
                inactiveColor={inactiveColor}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    height: Platform.OS === 'ios' ? 96 : 72,
    elevation: 0,
    position: 'absolute',
  },
  tabBarBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.88)',
  },
  tabBarItem: {
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: 0,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    width: 62,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
