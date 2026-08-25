import { View, Text, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FONT, fmtPrice } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { PriceGraph } from '@/components/market/PriceGraph';
import { PlayerHeadshot } from '@/components/media/PlayerHeadshot';

// Figma "Stock" component, shared by the Game Setup lineup review and the
// Draft Market's "Your lineup" sheet:
//   [flex:1 group: 40px headshot · gap 12 · info] · gap 12 ·
// The info column carries the player's FULL name — ticker handles are never
// shown anywhere in the app.
//   80x40 graph · gap 12 · 89px price + change
// Only the secondary line differs (position vs team), hence `secondary`.
//
// Passing `onRemove` switches to the export's "Watchlist" variant, which adds
// a 28x28 close button. The reference frame frees that space by dropping the
// graph; here the graph stays and the row compresses instead (72px graph,
// 10px gaps, 24px button), which keeps every element of the design present
// and still leaves the info column ~96px — the same width the export's own
// close-button row gives it.

interface Props {
  theme: Theme;
  player: {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    ticker_handle?: string | null;
    position?: string | null;
    team_abbreviation?: string | null;
    headshot_url?: string | null;
    external_id?: string | null;
    player_prices?: { price_change_pct_24h?: number | string | null } | null;
  };
  price: number | string;
  prices: number[];
  /** Trailing emphasised token on the secondary line — position or team. */
  secondary?: string | null;
  pctChange?: number | null;
  onPress?: () => void;
  /** Supply to render the Watchlist variant's close button. */
  onRemove?: () => void;
  removeDisabled?: boolean;
}

export function StockRow({ theme, player, price, prices, secondary, pctChange, onPress, onRemove, removeDisabled }: Props) {
  const pct = Number(pctChange ?? player.player_prices?.price_change_pct_24h ?? 0);
  const color = pct === 0 ? theme.muted : pct > 0 ? theme.gain : theme.danger;
  const tail = secondary ?? player.position ?? '';
  const gap = onRemove ? 10 : 12;
  const graphW = onRemove ? 72 : 80;

  const body = (
    <>
      {/* Logo and Information Container */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap }}>
        <PlayerHeadshot player={player} theme={theme} size={40} showTeamCrest />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
            {player.full_name}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: theme.muted2 }}>
            {player.team_abbreviation}{'  '}
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: theme.muted2 }}>{tail}</Text>
          </Text>
        </View>
      </View>

      <PriceGraph prices={prices} theme={theme} width={graphW} height={40} />

      {/* Price and Change Container */}
      <View style={{ width: 89, alignItems: 'flex-end', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink, textAlign: 'right' }}>
          {fmtPrice(price)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
          <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={12} height={10} viewBox="0 0 12 10">
              <Path d={pct >= 0 ? 'M6 0 L12 10 L0 10 Z' : 'M0 0 L12 0 L6 10 Z'} fill={color} />
            </Svg>
          </View>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color, textAlign: 'right' }}>
            {Math.abs(pct).toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* close-line — Watchlist variant only */}
      {onRemove ? (
        <Pressable
          onPress={(e) => { e.stopPropagation(); if (!removeDisabled) onRemove(); }}
          disabled={removeDisabled}
          hitSlop={10}
          accessibilityLabel={`Remove ${player.full_name} from lineup`}
          style={{
            width: 24, height: 24, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
            opacity: removeDisabled ? 0.5 : 1,
          }}
        >
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round">
            <Path d="M18 6 6 18M6 6l12 12" />
          </Svg>
        </Pressable>
      ) : null}
    </>
  );

  const style = { flexDirection: 'row', alignItems: 'center', gap } as const;
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityLabel={`View ${player.full_name}`} style={style}>
      {body}
    </Pressable>
  );
}
