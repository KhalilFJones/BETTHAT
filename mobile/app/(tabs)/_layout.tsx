import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({
  name, focused, label,
}: { name: IconName; focused: boolean; label: string }) {
  return (
    <View className="items-center justify-center pt-1">
      <Ionicons
        name={focused ? name : `${name}-outline` as IconName}
        size={24}
        color={focused ? '#F59E0B' : '#71717A'}
      />
      <Text
        className="text-[10px] mt-0.5"
        style={{ color: focused ? '#F59E0B' : '#71717A' }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#1E1E1E',
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home" focused={focused} label="Home" />
          ),
        }}
      />
      <Tabs.Screen
        name="lineup"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="basketball" focused={focused} label="Lineup" />
          ),
        }}
      />
      <Tabs.Screen
        name="matchups"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="flash" focused={focused} label="Matchups" />
          ),
        }}
      />
      <Tabs.Screen
        name="sidebets"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="stats-chart" focused={focused} label="Sidebets" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="person" focused={focused} label="Profile" />
          ),
        }}
      />
    </Tabs>
  );
}
