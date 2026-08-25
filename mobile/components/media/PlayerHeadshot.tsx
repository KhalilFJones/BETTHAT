import { useState } from 'react';
import { View, Text, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { initialsFor, resolveHeadshot, teamLogoUrl } from '@/lib/media';

// =============================================================================
// Player headshot — the sportsbook treatment.
//
// ESPN cuts these out on transparency with the player's head near the top, so
// they're laid over a soft team-tinted disc rather than shown on bare surface.
// A failed load or a player with no ESPN id degrades to the monogram, which is
// why the fallback lives here rather than at each call site.
// =============================================================================

export interface HeadshotPlayer {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  headshot_url?: string | null;
  external_id?: string | null;
  jersey_number?: string | null;
  team_abbreviation?: string | null;
}

export function PlayerHeadshot({
  player,
  theme,
  size = 44,
  shape = 'circle',
  showJersey = false,
  showTeamCrest = false,
  style,
}: {
  player: HeadshotPlayer | null | undefined;
  theme: Theme;
  size?: number;
  /** Circle for list rows and avatars; 'rounded' for grid tiles. */
  shape?: 'circle' | 'rounded';
  showJersey?: boolean;
  /** Small team crest tucked into the corner, as on a betting-slip row. */
  showTeamCrest?: boolean;
  style?: ViewStyle;
}) {
  const [failed, setFailed] = useState(false);

  const uri = failed ? null : resolveHeadshot(player);
  const name =
    player?.full_name ??
    [player?.first_name, player?.last_name].filter(Boolean).join(' ');
  const radius = shape === 'circle' ? size / 2 : Math.max(8, size * 0.24);
  const crest = showTeamCrest ? teamLogoUrl(player?.team_abbreviation) : null;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: theme.surfaceSunken,
          borderWidth: 1,
          borderColor: theme.hairline,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            onError={() => setFailed(true)}
            // ESPN frames the cutout with headroom; nudging it down and
            // oversizing crops to the face the way a betting app would.
            style={{ width: size * 1.28, height: size * 1.28, marginTop: size * 0.16 }}
            contentFit="cover"
            transition={140}
            cachePolicy="memory-disk"
          />
        ) : (
          <Text
            style={{
              fontFamily: FONT.sansBold,
              fontSize: Math.round(size * 0.34),
              color: theme.muted,
              letterSpacing: -0.3,
            }}
          >
            {initialsFor(name)}
          </Text>
        )}
      </View>

      {crest ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: Math.round(size * 0.4),
            height: Math.round(size * 0.4),
            borderRadius: Math.round(size * 0.2),
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.hairline,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Image
            source={{ uri: crest }}
            style={{ width: Math.round(size * 0.28), height: Math.round(size * 0.28) }}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        </View>
      ) : showJersey && player?.jersey_number ? (
        <View
          style={{
            position: 'absolute',
            right: -4,
            bottom: -4,
            backgroundColor: theme.accent,
            borderRadius: 6,
            paddingHorizontal: 4,
            paddingVertical: 1,
            minWidth: 16,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: FONT.monoBold,
              fontSize: Math.max(7, Math.round(size * 0.16)),
              color: theme.onAccent,
            }}
          >
            {player.jersey_number}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
