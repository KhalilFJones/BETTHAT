import { View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { teamLogoUrl } from '@/lib/media';

// =============================================================================
// Matchup backdrop — the art behind a game card.
//
// The sportsbook convention: the two clubs' crests blown up and bled off the
// left and right edges at low opacity, sitting on a diagonal wash of their
// primary colours, with a bottom scrim so white type stays legible over
// whatever the crests happen to be. Purely decorative — it renders behind
// content and never intercepts touches.
// =============================================================================

export function TeamBackdrop({
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  /** Unique per card — SVG gradient ids are global within a document. */
  id,
  height,
  /** 0 = flat colour, 1 = crests at full strength. */
  intensity = 1,
  scrim = true,
}: {
  homeAbbr: string | null | undefined;
  awayAbbr: string | null | undefined;
  homeColor?: string | null;
  awayColor?: string | null;
  id: string;
  height: number;
  intensity?: number;
  scrim?: boolean;
}) {
  const away = teamLogoUrl(awayAbbr);
  const home = teamLogoUrl(homeAbbr);
  const crest = Math.round(height * 0.92);

  return (
    <View pointerEvents="none" style={{ ...StyleSheetAbsolute, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" style={StyleSheetAbsolute}>
        <Defs>
          <LinearGradient id={`bd-wash-${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={awayColor || '#1F2937'} />
            <Stop offset="1" stopColor={homeColor || '#111827'} />
          </LinearGradient>
          <LinearGradient id={`bd-scrim-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B0B0C" stopOpacity={0} />
            <Stop offset="1" stopColor="#0B0B0C" stopOpacity={0.92} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#bd-wash-${id})`} />
      </Svg>

      {/* Crests bleed past the edges so they read as texture, not as logos. */}
      {away ? (
        <Image
          source={{ uri: away }}
          style={{
            position: 'absolute',
            left: -crest * 0.3,
            top: -crest * 0.12,
            width: crest,
            height: crest,
            opacity: 0.22 * intensity,
            transform: [{ rotate: '-8deg' }],
          }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : null}
      {home ? (
        <Image
          source={{ uri: home }}
          style={{
            position: 'absolute',
            right: -crest * 0.3,
            bottom: -crest * 0.12,
            width: crest,
            height: crest,
            opacity: 0.22 * intensity,
            transform: [{ rotate: '8deg' }],
          }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : null}

      {scrim ? (
        <Svg width="100%" height="100%" style={StyleSheetAbsolute}>
          <Defs>
            <LinearGradient id={`bd-s2-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#0B0B0C" stopOpacity={0.05} />
              <Stop offset="0.45" stopColor="#0B0B0C" stopOpacity={0.35} />
              <Stop offset="1" stopColor="#0B0B0C" stopOpacity={0.92} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#bd-s2-${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

const StyleSheetAbsolute = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};
