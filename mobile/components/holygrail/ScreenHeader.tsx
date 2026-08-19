import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';

interface Props {
  /** Override balance shown in the wallet pill. If omitted, pill shows '$—'. */
  walletBalance?: number | string | null;
  /** Click handler for wallet pill. Defaults to opening /wallet modal route. */
  onWalletPress?: () => void;
  /** Click handler for friends button. Defaults to /friends. */
  onFriendsPress?: () => void;
  /** Center wordmark. Defaults to BETTHAT. */
  brand?: string;
  /** When true, replaces the friends icon with a ← back arrow that calls router.back(). */
  showBack?: boolean;
  /**
   * Which affordance sits in the left slot. 'notifications' renders a bell
   * with an unread dot — the Social Feed took over the centre nav slot that
   * used to open notifications, so Home carries that entry point now.
   */
  leftAction?: 'friends' | 'notifications';
}

// Holy Grail Top Bar — used on Home, Market, Matchups, Profile.
// Friends icon left, BETTHAT wordmark center, wallet pill right.
export function ScreenHeader({ walletBalance, onWalletPress, onFriendsPress, brand = 'BETTHAT', showBack, leftAction = 'friends' }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const { profile } = useAuthStore();

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
    enabled: !!profile?.id && leftAction === 'notifications',
    refetchInterval: 30_000,
  });

  return (
    <View
      style={{
        height: 48,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {showBack ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          hitSlop={8}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
      ) : leftAction === 'notifications' ? (
        <Pressable
          onPress={() => router.push('/notifications' as any)}
          accessibilityLabel="Notifications"
          hitSlop={8}
          style={{ width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </Svg>
          {hasUnread ? (
            <View style={{ position: 'absolute', top: 5, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', borderWidth: 1.5, borderColor: theme.bg }} />
          ) : null}
        </Pressable>
      ) : (
        <Pressable
          onPress={onFriendsPress ?? (() => router.push('/social/connections' as any))}
          accessibilityLabel="Friends"
          hitSlop={8}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <Circle cx={9} cy={7} r={4} />
            <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </Svg>
        </Pressable>
      )}

      <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, letterSpacing: 2.6, color: theme.ink }}>
        {brand}
      </Text>

      <Pressable
        onPress={onWalletPress ?? (() => router.push('/wallet'))}
        accessibilityLabel="Open wallet"
        hitSlop={8}
        style={{
          height: 32,
          paddingHorizontal: 13,
          backgroundColor: theme.surface,
          borderColor: theme.hairline,
          borderWidth: 1,
          borderRadius: 999,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: theme.accent }} />
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: theme.ink }}>
          {fmtPrice(walletBalance ?? null)}
        </Text>
      </Pressable>
    </View>
  );
}
