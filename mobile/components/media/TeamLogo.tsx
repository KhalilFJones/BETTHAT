import { View, Text } from 'react-native';
import { Image } from 'expo-image';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { teamLogoUrl } from '@/lib/media';

// Team crest. Falls back to the abbreviation set in the same footprint so a
// row never collapses when a logo fails to load.
export function TeamLogo({
  abbreviation,
  size = 24,
  theme,
  tint,
}: {
  abbreviation: string | null | undefined;
  size?: number;
  theme?: Theme;
  /** Colour for the text fallback; defaults to the theme's muted ink. */
  tint?: string;
}) {
  const uri = teamLogoUrl(abbreviation);
  if (!uri) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: FONT.sansBold,
            fontSize: Math.round(size * 0.36),
            color: tint ?? theme?.muted ?? '#AAAAAC',
          }}
        >
          {(abbreviation ?? '—').toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      transition={120}
      cachePolicy="memory-disk"
      accessibilityLabel={abbreviation ?? undefined}
    />
  );
}
