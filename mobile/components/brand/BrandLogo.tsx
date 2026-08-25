import { View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import type { Theme } from '@/lib/theme';

// =============================================================================
// BETTHAT identity.
//
// The mark ships as PNG: this is the supplied logo artwork itself, cut off the
// logo-pack sheet by scripts/extract_logo_pack.py, so what renders is the real
// logo rather than a re-drawing of it. Typesetting it at runtime is not an
// option — the pack is set in a face the app cannot bundle, and React Native
// would fall back to a different one per platform.
//
// Two colourways per part: the light half is white on dark grounds and near
// -black on light ones, with the accent shifted to #A8460D on light so the
// second half stays readable (the raw brand orange is only 4.1:1 on white).
//
//   variant="mark"     BT alone (nav, tab bar, compact headers)
//   variant="wordmark" BET THAT alone (tight rows)
//   variant="full"     monogram over the wordmark (splash, login)
//
// `onDark` pins it to the dark-ground colourway for placement on artwork or a
// permanently dark surface, instead of following the theme.
//
// To change the mark: replace the source sheet and re-run
// scripts/extract_logo_pack.py, then scripts/generate_icons.py for the
// launcher icons. Never hand-edit the PNGs.
// =============================================================================

type Variant = 'mark' | 'wordmark' | 'full';

/* eslint-disable @typescript-eslint/no-require-imports */
const ART = {
  mark: {
    dark: require('../../assets/logo-mark-dark.png'),
    light: require('../../assets/logo-mark-light.png'),
  },
  wordmark: {
    dark: require('../../assets/logo-word-dark.png'),
    light: require('../../assets/logo-word-light.png'),
  },
  full: {
    dark: require('../../assets/logo-full-dark.png'),
    light: require('../../assets/logo-full-light.png'),
  },
} as const;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Intrinsic width / height per asset, so `size` can drive height alone.
 * Kept per colourway: the two crops came off different panels of the sheet and
 * their ratios differ slightly, so sharing one number would stretch the mark.
 */
const ASPECT: Record<Variant, { dark: number; light: number }> = {
  mark: { dark: 257 / 134, light: 231 / 121 },
  wordmark: { dark: 341 / 44, light: 341 / 44 },
  full: { dark: 364 / 226, light: 260 / 156 },
};

export function BrandLogo({
  theme,
  size = 40,
  variant = 'mark',
  onDark = false,
  style,
}: {
  theme: Theme;
  /** Rendered height. Width follows the artwork's own aspect ratio. */
  size?: number;
  variant?: Variant;
  onDark?: boolean;
  style?: ViewStyle;
}) {
  const colourway = onDark || theme.mode === 'dark' ? 'dark' : 'light';

  return (
    <View style={style}>
      <Image
        source={ART[variant][colourway]}
        style={{ height: size, width: size * ASPECT[variant][colourway] }}
        contentFit="contain"
        accessibilityLabel="BETTHAT"
      />
    </View>
  );
}
