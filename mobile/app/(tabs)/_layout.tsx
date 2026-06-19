import { Tabs } from 'expo-router';
import { View, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

// Holy Grail V2 tab bar — Home · Market · Matchups · Profile.
// Sky blue active, muted gray inactive. Plex Mono labels.
// Underlying file `lineup.tsx` retained as Market route to avoid breaking
// existing deep-link references; label and icon present as Market.

const SKY = '#5B9BD5';
const MUTED = '#8A93A6';
const JET = '#0A0A0C';
const HAIRLINE = 'rgba(255,255,255,0.08)';

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
  label,
  badge = false,
}: {
  iconName: string;
  focused: boolean;
  label: string;
  badge?: boolean;
}) {
  const color = focused ? SKY : MUTED;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 6, gap: 3 }}>
      <View style={{ position: 'relative' }}>
        <Icon name={iconName} color={color} />
        {badge && (
          <View style={{
            position: 'absolute', top: -2, right: -4,
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: '#FF3B30',
            borderWidth: 1.5, borderColor: JET,
          }} />
        )}
      </View>
      <Text
        style={{
          fontSize: 10,
          color,
          letterSpacing: 0.4,
          fontFamily: Platform.select({ ios: 'DMSans_500Medium', default: 'DMSans_500Medium' }),
          fontWeight: focused ? '600' : '500',
        }}
      >
        {label}
      </Text>
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
        tabBarStyle: {
          backgroundColor: JET,
          borderTopColor: HAIRLINE,
          borderTopWidth: 1,
          height: 68 + insets.bottom,
          paddingBottom: insets.bottom + 4,
          paddingTop: 6,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon iconName="home" focused={focused} label="Home" />,
        }}
      />
      <Tabs.Screen
        name="lineup"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon iconName="market" focused={focused} label="Market" />,
        }}
      />
      <Tabs.Screen
        name="matchups"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon iconName="matchups" focused={focused} label="Matchups" badge={!!hasLive} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon iconName="profile" focused={focused} label="Profile" />,
        }}
      />
    </Tabs>
  );
}
