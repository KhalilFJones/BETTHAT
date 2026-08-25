import { View, Text, Pressable } from 'react-native';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { PlayerHeadshot } from '@/components/media/PlayerHeadshot';
import { TeamLogo } from '@/components/media/TeamLogo';

// =============================================================================
// Figma player stat card — shared by the live board (matchup/[id]) and the
// settled result screen (matchup/result/[id]), which specify it identically:
// a Greyscale/50 header carrying the name, the opponent caption and the FP in
// an accent-ringed pill, over a white PTS/REB/AST/STL/TO strip.
// =============================================================================

export const STAT_KEYS = ['PTS', 'REB', 'AST', 'STL', 'TO'] as const;

export interface PlayerStatLine {
  id?: string;
  name: string;
  headshot_url?: string | null;
  team?: string | null;
  /** "Memphis Grizzlies" — rendered as "vs. Memphis Grizzlies". */
  vs?: string;
  fp: number;
  PTS: number;
  REB: number;
  AST: number;
  STL: number;
  TO: number;
}

export function PlayerStatCard({
  player, theme, onPress,
}: {
  player: PlayerStatLine; theme: Theme; onPress?: () => void;
}) {
  const body = (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surfaceSunken, overflow: 'hidden' }}>
      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <PlayerHeadshot
          theme={theme}
          size={36}
          player={{ full_name: player.name, headshot_url: player.headshot_url, team_abbreviation: player.team }}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansBold, fontSize: 16, lineHeight: 24, color: theme.ink }}>
            {player.name}
          </Text>
          {player.vs ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TeamLogo abbreviation={player.team} size={12} theme={theme} />
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: '#AAAAAC' }}>
                vs. {player.vs}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 100, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.accent }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, lineHeight: 21, color: theme.ink }}>
            {Number(player.fp ?? 0).toFixed(1)}
          </Text>
        </View>
      </View>

      <View style={{ padding: 12, backgroundColor: theme.surface, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {STAT_KEYS.map((k) => (
            <Text key={k} style={{ flex: 1, textAlign: 'center', fontFamily: FONT.sans, fontSize: 10, lineHeight: 15, color: theme.ink }}>
              {k}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {STAT_KEYS.map((k) => (
            <Text key={k} style={{ flex: 1, textAlign: 'center', fontFamily: FONT.sansBold, fontSize: 10, lineHeight: 15, color: theme.ink }}>
              {player[k] ?? 0}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityLabel={`View ${player.name}`}>
      {body}
    </Pressable>
  );
}
