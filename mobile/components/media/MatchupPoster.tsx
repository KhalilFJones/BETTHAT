import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Rect, Stop, RadialGradient, Circle } from 'react-native-svg';

import { FONT } from '@/lib/holygrail';
import { resolvePosterImage, teamLogoUrl } from '@/lib/media';

// =============================================================================
// Matchup poster — the broadcast graphic sportsbooks and league accounts run:
// each club's biggest name faced inward, team colours meeting on the seam,
// crests and a VS on the join.
//
// LAYOUT CONTRACT: the card is split into two bands that never overlap. The
// top `TEXT_BAND` is reserved for the headline and is kept clear of figures;
// the figures live entirely in the band below it, anchored to the bottom edge.
// That is why the poster owns the VS and the crests but NOT the headline — the
// caller renders text into the reserved band, so the two can't collide.
//
// The figures are usually head-and-shoulders cutouts (ESPN's public CDN is the
// only free, predictable source). They're composed like poster subjects rather
// than avatars: oversized, bottom-anchored so the crop falls at the chest, and
// backed by a team-coloured glow that separates them from the colour field.
// A player with `action_photo_url` set gets that instead, no code change.
// =============================================================================

const FILL = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

/** Fraction of the card height reserved for the caller's headline. */
export const TEXT_BAND = 0.42;

export interface PosterStar {
  full_name?: string | null;
  headshot_url?: string | null;
  action_photo_url?: string | null;
}

export function MatchupPoster({
  id,
  height,
  width,
  awayAbbr,
  homeAbbr,
  awayColor,
  homeColor,
  awayStar,
  homeStar,
}: {
  /** Unique per card — SVG gradient ids are global within a document. */
  id: string;
  height: number;
  width: number;
  awayAbbr: string | null | undefined;
  homeAbbr: string | null | undefined;
  awayColor?: string | null;
  homeColor?: string | null;
  awayStar?: PosterStar | null;
  homeStar?: PosterStar | null;
}) {
  const away = awayColor || '#1F2937';
  const home = homeColor || '#111827';

  // Figures occupy the band below the text and are anchored to the bottom.
  const figureBand = height * (1 - TEXT_BAND);
  const figureH = Math.round(figureBand * 1.34);
  const figureW = Math.round(figureH * 0.86);
  const crest = Math.round(height * 0.17);

  const awayUri = resolvePosterImage(awayStar);
  const homeUri = resolvePosterImage(homeStar);

  return (
    <View pointerEvents="none" style={{ ...FILL, overflow: 'hidden' }}>
      {/* Colour fields meeting on the seam. */}
      <Svg width="100%" height="100%" style={FILL}>
        <Defs>
          <LinearGradient id={`mp-a-${id}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={away} stopOpacity={0.95} />
            <Stop offset="1" stopColor={away} stopOpacity={0.2} />
          </LinearGradient>
          <LinearGradient id={`mp-h-${id}`} x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0" stopColor={home} stopOpacity={0.95} />
            <Stop offset="1" stopColor={home} stopOpacity={0.2} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="50%" height="100%" fill={`url(#mp-a-${id})`} />
        <Rect x="50%" y="0" width="50%" height="100%" fill={`url(#mp-h-${id})`} />
      </Svg>

      {/* Spotlight behind each figure — lifts the cutout off the flat field
          and reads as arena lighting rather than a sticker on a gradient. */}
      <Svg width="100%" height="100%" style={FILL}>
        <Defs>
          <RadialGradient id={`mp-ga-${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.26} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`mp-gh-${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.26} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={width * 0.23} cy={height * 0.78} r={height * 0.4} fill={`url(#mp-ga-${id})`} />
        <Circle cx={width * 0.77} cy={height * 0.78} r={height * 0.4} fill={`url(#mp-gh-${id})`} />
      </Svg>

      {/* Away figure, bottom-left, facing right. */}
      {awayUri ? (
        <Image
          source={{ uri: awayUri }}
          style={{
            position: 'absolute',
            left: -figureW * 0.16,
            bottom: -figureH * 0.06,
            width: figureW,
            height: figureH,
          }}
          contentFit="contain"
          contentPosition="bottom center"
          cachePolicy="memory-disk"
          transition={180}
        />
      ) : null}

      {/* Home figure, bottom-right, mirrored so they face each other. */}
      {homeUri ? (
        <Image
          source={{ uri: homeUri }}
          style={{
            position: 'absolute',
            right: -figureW * 0.16,
            bottom: -figureH * 0.06,
            width: figureW,
            height: figureH,
            transform: [{ scaleX: -1 }],
          }}
          contentFit="contain"
          contentPosition="bottom center"
          cachePolicy="memory-disk"
          transition={180}
        />
      ) : null}

      {/* VS lockup on the seam, between the two figures. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: height * (TEXT_BAND + 0.06),
          alignItems: 'center',
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Crest uri={teamLogoUrl(awayAbbr)} size={crest} />
          <Text
            style={{
              fontFamily: FONT.sansBold,
              fontSize: Math.round(height * 0.13),
              color: '#FFFFFF',
              letterSpacing: -0.5,
              textShadowColor: 'rgba(0,0,0,0.55)',
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 8,
            }}
          >
            VS
          </Text>
          <Crest uri={teamLogoUrl(homeAbbr)} size={crest} />
        </View>
      </View>

      {/* Scrim weighted to the TOP, where the headline sits. The bottom stays
          clear so the figures aren't washed out by their own legibility aid. */}
      <Svg width="100%" height="100%" style={FILL}>
        <Defs>
          <LinearGradient id={`mp-s-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#08080A" stopOpacity={0.88} />
            <Stop offset={String(TEXT_BAND)} stopColor="#08080A" stopOpacity={0.34} />
            <Stop offset="0.72" stopColor="#08080A" stopOpacity={0.1} />
            <Stop offset="1" stopColor="#08080A" stopOpacity={0.55} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#mp-s-${id})`} />
      </Svg>
    </View>
  );
}

function Crest({ uri, size }: { uri: string | null; size: number }) {
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      cachePolicy="memory-disk"
    />
  );
}
