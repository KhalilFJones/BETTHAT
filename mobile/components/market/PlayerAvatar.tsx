import { View, Text } from 'react-native';
import { FONT } from '@/lib/holygrail';
import { playerInitials } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';

// Theme-aware player monogram tile — used across the redesigned Draft Market
// and Game Setup screens. Jersey badge uses the brand accent (yellow) instead
// of the old Holy Grail sky-blue, matching lib/theme.ts.

interface Props {
  player: { first_name?: string | null; last_name?: string | null; full_name?: string | null; jersey_number?: string | null };
  theme: Theme;
  size?: number;
}

export function PlayerAvatar({ player, theme, size = 44 }: Props) {
  const initials = playerInitials(player);
  return (
    <View
      style={{
        width: size, height: size, borderRadius: Math.max(8, size * 0.24),
        backgroundColor: theme.surfaceSunken, borderWidth: 1, borderColor: theme.hairline,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: FONT.sansBold, fontSize: Math.round(size * 0.32), color: theme.ink, letterSpacing: -0.3 }}>
        {initials}
      </Text>
      {player.jersey_number ? (
        <View
          style={{
            position: 'absolute', right: -4, bottom: -4, backgroundColor: theme.accent,
            borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1, minWidth: 16, alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: FONT.monoBold, fontSize: Math.max(7, Math.round(size * 0.16)), color: theme.onAccent }}>
            {player.jersey_number}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
