import { Tabs, useRouter } from 'expo-router';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

// BETTHAT tab bar — matches the Figma "Nav" component exactly:
// 248x56 dark pill (#151517), 5 buttons @ 48x48, no gap (4px outer padding
// only: 4 + 5*48 + 4 = 248). Icons swap to the filled Ionicons variant + a
// yellow (#F0F600) circle when focused; inactive icons are the outline
// variant in Greyscale/500 (#8A8A8E).
//
// Order per Figma: Home · Market (globe) · Notifications (bell) ·
// Matchups (pie-chart) · Profile (user). Notifications isn't a tab content
// screen — it's a stacked push (app/notifications.tsx) — so it's rendered
// as a plain nav button rather than a Tabs.Screen.
//
// Underlying file `lineup.tsx` is the Market route, kept to avoid breaking
// existing deep links.

const ACCENT = '#F0F600';   // Primary/400 - Base
const ON_ACCENT = '#151517'; // Greyscale/800
const PILL = '#151517';
const INACTIVE = '#8A8A8E'; // Greyscale/500
const NOTIF_BADGE = '#FF3B30';

const BUTTON = 48;
const NAV_WIDTH = 248; // 4 (pad) + 5*48 + 4 (pad)

function NavIcon({
  outlineName,
  filledName,
  focused,
  badge,
}: {
  outlineName: keyof typeof Ionicons.glyphMap;
  filledName: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  badge?: boolean;
}) {
  return (
    <View
      style={{
        width: BUTTON,
        height: BUTTON,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? ACCENT : 'transparent',
      }}
    >
      <Ionicons name={focused ? filledName : outlineName} size={20} color={focused ? ON_ACCENT : INACTIVE} />
      {badge ? (
        <View
          style={{
            position: 'absolute', top: 9, right: 9,
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: NOTIF_BADGE,
            borderWidth: 1.5, borderColor: focused ? ACCENT : PILL,
          }}
        />
      ) : null}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuthStore();

  // Live badge on Matchups tab when the user has an active/in-progress matchup.
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

  // Unread badge on the Notifications button.
  const { data: hasUnread } = useQuery({
    queryKey: ['has-unread-notifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return false;
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
      return (count ?? 0) > 0;
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  return (
    <Tabs
      // NOTE: tabBarStyle/tabBarShowLabel/etc are irrelevant here — supplying
      // a custom `tabBar` render prop below bypasses React Navigation's
      // default bar entirely, so the only screenOption that still applies is
      // headerShown.
      screenOptions={{ headerShown: false }}
      // Custom tab bar: same 4 real tabs, but with a 5th non-tab Notifications
      // button spliced in at its Figma position (3rd of 5).
      tabBar={(props) => {
        const { state, descriptors, navigation } = props;
        const routesByName = Object.fromEntries(state.routes.map((r) => [r.name, r]));

        function renderTab(name: string, icon: { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }, badge?: boolean) {
          const route = routesByName[name];
          const routeIndex = state.routes.findIndex((r) => r.name === name);
          const focused = state.index === routeIndex;
          const { options } = descriptors[route.key];
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.title ?? name}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={{ width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' }}
            >
              <NavIcon outlineName={icon.outline} filledName={icon.filled} focused={focused} badge={badge} />
            </Pressable>
          );
        }

        return (
          <View
            style={{
              position: 'absolute',
              width: NAV_WIDTH,
              left: '50%',
              marginLeft: -NAV_WIDTH / 2,
              bottom: insets.bottom + 8,
              height: 56,
              borderRadius: 999,
              backgroundColor: PILL,
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.08)',
              paddingHorizontal: 4,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 12,
            }}
          >
            {renderTab('home', { outline: 'home-outline', filled: 'home' })}
            {renderTab('lineup', { outline: 'globe-outline', filled: 'globe' })}
            <Pressable
              key="notifications"
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => router.push('/notifications' as any)}
              style={{ width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' }}
            >
              <NavIcon outlineName="notifications-outline" filledName="notifications" focused={false} badge={!!hasUnread} />
            </Pressable>
            {renderTab('matchups', { outline: 'pie-chart-outline', filled: 'pie-chart' }, !!hasLive)}
            {renderTab('profile', { outline: 'person-outline', filled: 'person' })}
          </View>
        );
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="lineup" options={{ title: 'Market' }} />
      <Tabs.Screen name="matchups" options={{ title: 'Matchups' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
