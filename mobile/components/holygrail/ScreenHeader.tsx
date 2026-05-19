import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { HG, FONT, fmtPrice } from '@/lib/holygrail';

interface Props {
  /** Override balance shown in the wallet pill. If omitted, pill shows '$—'. */
  walletBalance?: number | string | null;
  /** Click handler for wallet pill. Defaults to opening /wallet modal route. */
  onWalletPress?: () => void;
  /** Click handler for friends button. Defaults to /friends. */
  onFriendsPress?: () => void;
  /** Center wordmark. Defaults to BETTHAT. */
  brand?: string;
}

// Holy Grail Top Bar — used on Home, Market, Matchups, Sidebets, Profile.
// Friends icon left, BETTHAT wordmark center, wallet pill right.
export function ScreenHeader({ walletBalance, onWalletPress, onFriendsPress, brand = 'BETTHAT' }: Props) {
  const router = useRouter();

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
      <Pressable
        onPress={onFriendsPress ?? (() => router.push('/friends'))}
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
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle cx={9} cy={7} r={4} />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
      </Pressable>

      <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, letterSpacing: 2.6, color: HG.ink }}>
        {brand}
      </Text>

      <Pressable
        onPress={onWalletPress ?? (() => router.push('/wallet'))}
        accessibilityLabel="Open wallet"
        hitSlop={8}
        style={{
          height: 32,
          paddingHorizontal: 13,
          backgroundColor: HG.surface,
          borderColor: HG.hairline,
          borderWidth: 1,
          borderRadius: 999,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: HG.sky }} />
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: HG.ink }}>
          {fmtPrice(walletBalance ?? null)}
        </Text>
      </Pressable>
    </View>
  );
}
