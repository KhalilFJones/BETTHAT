// =============================================================================
// BETTHAT — Theme system (light + dark, deep-orange accent)
// -----------------------------------------------------------------------------
// The original "Holy Grail V2" tokens in lib/holygrail.ts are dark-only and
// sky-blue. This module introduces a mode-aware token set (LIGHT / DARK) with a
// DEEP ORANGE primary accent, consumed via the useTheme() hook. Screens migrated to
// the new design read from here; screens still on the old dark-only look keep
// importing `HG`. Price-direction green/red is preserved unchanged in both
// modes (never repurposed for UI chrome).
//
// Light-mode values are taken verbatim from the Figma greyscale ramp:
//   Greyscale 0/50/100/200/500/600/700/800/900 + Primary/400-Base (#CE5A12).
// =============================================================================

import { useColorScheme } from 'react-native';
import { useThemeStore } from '@/stores/theme.store';

export type Mode = 'light' | 'dark';

export interface Theme {
  mode: Mode;

  // Surfaces
  bg: string;            // screen background
  surface: string;       // card surface
  surfaceSunken: string; // grouped/inset track (segment control, nested wells)
  surfaceRaised: string; // elevated element
  hairline: string;      // card / row borders (Greyscale/100)
  hairline2: string;     // stronger separators (Greyscale/200 dashed grid)

  // Ink ramp
  ink: string;    // primary text        (Greyscale/800 #151517)
  ink2: string;   // section headers      (Greyscale/700 #3F3F43)
  muted: string;  // secondary text       (Greyscale/600 #67676A)
  muted2: string; // faint / axis labels  (Greyscale/500 #8A8A8E)
  faint: string;  // de-emphasized labels + disabled field text (Greyscale/300 #C4C4C5)

  // Inline accent-coloured text (social-feed tickers / prices). The raw accent
  // is mid-luminance, so it only reaches 4.1:1 on white and 4.8:1 on the dark
  // ground — fine for a fill, marginal for body copy. Each mode therefore gets
  // a shifted accent for TEXT: darker on light (5.9:1), lighter on dark
  // (6.5:1). Fills always use `accent` itself so the brand colour is exact.
  accentInk: string;

  // Accent — DEEP ORANGE is the single brand accent in both modes.
  accent: string;     // fills: active nav, W badges, progress, chart line
  accentSoft: string; // low-alpha wash
  accentEdge: string; // accent-tinted border
  onAccent: string;   // text/icon sitting on an accent fill

  // Chart equity-curve area fill (indigo, per Figma) — line uses `accent`.
  chartArea: string;

  // Pastel avatar-chip backgrounds for stacked initials (Top Wins).
  chipPastels: string[];

  // Money gain (net-winnings up) + destructive/danger + selected-row wash.
  //
  // `danger` is mode-aware and it has to be: oxblood #960200 reads 9.1:1 on
  // white but only 2.17:1 on the near-black app ground, where it is genuinely
  // unreadable. Dark mode therefore lifts it to #D6453C (4.5:1) — still a deep
  // blood red, not a neon one. Use `dangerFill` when you want the exact
  // oxblood as a solid behind white text.
  gain: string;
  gainSoft: string;
  danger: string;
  dangerFill: string;
  accentWash: string; // very light accent tint for the highlighted row

  // Price-direction ONLY (unchanged across modes). Never UI chrome.
  up: string;
  down: string;

  // Win/Loss semantics. Green and red are RESERVED for meaning — up, good,
  // won is green; down, bad, lost is red. The brand orange is never used to
  // signal an outcome, only for chrome and identity.
  win: string;
  loss: string;
}

const ACCENT = '#CE5A12';    // Primary/400 - Base (deep orange)
// Near-black beats white on this hue: 4.80:1 vs 4.12:1. Measured, not assumed.
const ACCENT_ON = '#0A0A0C';
const OXBLOOD = '#960200';   // the brand red, exact
// Price direction. `DOWN` sits in the oxblood family but lifted enough to stay
// legible on BOTH grounds (4.9:1 on dark, 4.0:1 on white) — a single value is
// used in both modes, so it cannot be the raw oxblood.
const UP = '#2FAE60';
const DOWN = '#D6453C';
const CHART_INDIGO = 'rgb(94, 97, 185)';

export const LIGHT: Theme = {
  mode: 'light',

  bg: '#F4F4F4',            // Greyscale/50
  surface: '#FFFFFF',       // Greyscale/0
  surfaceSunken: '#F4F4F4', // Greyscale/50
  surfaceRaised: '#FFFFFF',
  hairline: '#EAEAEA',      // Greyscale/100
  hairline2: '#D9D9DA',     // Greyscale/200

  ink: '#151517',
  ink2: '#3F3F43',
  muted: '#67676A',
  muted2: '#8A8A8E',
  faint: '#C4C4C5',
  accentInk: '#A8460D',

  accent: ACCENT,
  accentSoft: 'rgba(206, 90, 18, 0.14)',
  accentEdge: 'rgba(206, 90, 18, 0.32)',
  onAccent: ACCENT_ON,

  chartArea: CHART_INDIGO,
  chipPastels: ['#FFF3BA', '#FBFCB8', '#EDBABA', '#BAE0FF'],

  gain: '#36A34C',
  gainSoft: 'rgba(54, 163, 76, 0.12)',
  danger: OXBLOOD,
  dangerFill: OXBLOOD,
  accentWash: 'rgba(206, 90, 18, 0.07)',

  up: UP,
  down: DOWN,
  win: '#2A7F3B',   // deeper than `gain` so it holds up as large display type
  loss: OXBLOOD,
};

export const DARK: Theme = {
  mode: 'dark',

  bg: '#0A0A0C',
  surface: '#141416',
  surfaceSunken: '#0E0E10',
  surfaceRaised: '#1B1C20',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairline2: 'rgba(255, 255, 255, 0.14)',

  ink: '#E8EDF2',
  ink2: '#C2C8D0',
  muted: '#8A93A6',
  muted2: '#5C6473',
  faint: '#464C57', // one step below muted2 — same role as light's Greyscale/300
  accentInk: '#E8721F',

  accent: ACCENT,
  accentSoft: 'rgba(206, 90, 18, 0.18)',
  accentEdge: 'rgba(206, 90, 18, 0.38)',
  onAccent: ACCENT_ON,

  chartArea: CHART_INDIGO,
  chipPastels: ['#FFF3BA', '#FBFCB8', '#EDBABA', '#BAE0FF'],

  gain: '#3FBE59',
  gainSoft: 'rgba(63, 190, 89, 0.16)',
  // Lifted oxblood: the exact #960200 is 2.17:1 here and unreadable.
  danger: '#D6453C',
  dangerFill: OXBLOOD,
  accentWash: 'rgba(206, 90, 18, 0.10)',

  up: UP,
  down: DOWN,
  win: '#3FBE59',
  loss: '#D6453C',
};

export const THEME: Record<Mode, Theme> = { light: LIGHT, dark: DARK };

/**
 * Resolve the active theme. Honors the user's manual Settings > Appearance
 * override (light/dark) when set; otherwise follows the OS color scheme,
 * defaulting to dark when that's unavailable (matches the app's historical
 * dark-only baseline).
 */
export function useTheme(): Theme {
  const preference = useThemeStore((s) => s.preference);
  const scheme = useColorScheme();
  if (preference === 'light') return LIGHT;
  if (preference === 'dark') return DARK;
  return scheme === 'light' ? LIGHT : DARK;
}
