import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

// BETTHAT tab bar — floating dark pill, yellow active indicator.
// Home · Market · Matchups · Profile. The pill stays dark in both light and
// dark mode (matching the Figma). Underlying file `lineup.tsx` is the Market
// route, kept to avoid breaking existing deep links.

const ACCENT = '#F0F600';   // Primary/400 (active)
const ON_ACCENT = '#151517';
const PILL = '#151517';     // Greyscale/800 pill surface
const INACTIVE = '#8A8A8E'; // Greyscale/500 icons

function Icon({ name, color }: { name: string; color: string }) {
  const stroke = color;
  const sw = 1.5;
  switch (name) {
    case 'home':
      return (
        <Svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m3 12 9-9 9 9" />
          <Path d="M5 10v10h14V10" />
        </Svg>
      );
    case 'market':
      return (
        <Svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M3 17l6-6 4 4 8-8" />
          <Path d="M14 7h7v7" />
        </Svg>
      );
    case 'matchups':
      return (
        <Svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={12} r={9} />
          <Path d="M12 3v18M3 12h18" />
        </Svg>
      );
    case 'profile':
      return (
        <Svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <Circle cx={12} cy={7} r={4} />
        </Svg>
      );
    default:
      return null;
  }
}

function TabIcon({
  iconName,
  focused,
  badge = false,
}: {
  iconName: string;
  focused: boolean;
  badge?: boolean;
}) {
  return (
    <View
      style={{
        width: 46,
        height: 46,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? ACCENT : 'transparent',
      }}
    >
      <Icon name={iconName} color={focused ? ON_ACCENT : INACTIVE} />
      {badge && (
        <View style={{
          position: 'absolute', top: 6, right: 6,
          width: 8, height: 8, borderRadius: 4,
          backgroundColor: '#FF3B30',
          borderWidth: 1.5, borderColor: focused ? ACCENT : PILL,
        }} />
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();

  // SCRUM-198: Live badge on Matchups tab when user has an active/in-progress matchup
  const { data: hasLive } = useQuery({
    queryKey: ['has-live-matchup', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return false;
      const { count } = await supabase
        .from('matchups')
        .select('id', { count: 'exact', head: true })
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .in('status', ['matched', 'in_progress', 'live']);
      return (count ?? 0) > 0;
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarItemStyle: { height: 56 },
        tabBarStyle: {
          position: 'absolute',
          width: 260,
          left: '50%',
          marginLeft: -130,
          bottom: insets.bottom + 12,
          height: 56,
          borderRadius: 999,
          backgroundColor: PILL,
          borderTopWidth: 0,
          paddingTop: 4,
          paddingBottom: 0,
          paddingHorizontal: 4,
          // floating shadow
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 16,
          elevation: 12,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ tabBarIcon: ({ focused }) => <TabIcon iconName="home" focused={focused} /> }}
      />
      <Tabs.Screen
        name="lineup"
        options={{ tabBarIcon: ({ focused }) => <TabIcon iconName="market" focused={focused} /> }}
      />
      <Tabs.Screen
        name="matchups"
        options={{ tabBarIcon: ({ focused }) => <TabIcon iconName="matchups" focused={focused} badge={!!hasLive} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ tabBarIcon: ({ focused }) => <TabIcon iconName="profile" focused={focused} /> }}
      />
    </Tabs>
  );
}
