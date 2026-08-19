// =============================================================================
// BETTHAT — Theme system (light + dark, yellow accent)
// -----------------------------------------------------------------------------
// The original "Holy Grail V2" tokens in lib/holygrail.ts are dark-only and
// sky-blue. This module introduces a mode-aware token set (LIGHT / DARK) with a
// YELLOW primary accent, consumed via the useTheme() hook. Screens migrated to
// the new design read from here; screens still on the old dark-only look keep
// importing `HG`. Price-direction green/red is preserved unchanged in both
// modes (never repurposed for UI chrome).
//
// Light-mode values are taken verbatim from the Figma greyscale ramp:
//   Greyscale 0/50/100/200/500/600/700/800/900 + Primary/400-Base (#F0F600).
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

  // Inline accent-coloured text (social-feed tickers / prices). NOT the raw
  // accent in light mode: #F0F600 on white is ~1.5:1 and unreadable as body
  // copy, so light gets a darkened accent that still reads as the brand.
  accentInk: string;

  // Accent — YELLOW is the single brand accent in both modes (Primary/400).
  accent: string;     // fills: active nav, W badges, progress, chart line
  accentSoft: string; // low-alpha wash
  accentEdge: string; // accent-tinted border
  onAccent: string;   // text/icon sitting on an accent fill

  // Chart equity-curve area fill (indigo, per Figma) — line uses `accent`.
  chartArea: string;

  // Pastel avatar-chip backgrounds for stacked initials (Top Wins).
  chipPastels: string[];

  // Money gain (net-winnings up) + destructive/danger + selected-row wash.
  // Figma uses a deeper green (#36A34C) for positive money change and a red
  // (#F05D5D) for destructive actions like log out.
  gain: string;
  gainSoft: string;
  danger: string;
  accentWash: string; // very light accent tint for the highlighted row

  // Price-direction ONLY (unchanged across modes). Never UI chrome.
  up: string;
  down: string;

  // Win/Loss semantics (WIN uses accent, LOSS is a quiet gray).
  win: string;
  loss: string;
}

const ACCENT = '#F0F600';    // Primary/400 - Base
const ACCENT_ON = '#151517'; // Greyscale/800 text on yellow
const UP = '#26D782';
const DOWN = '#F24236';
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
  accentInk: '#7C8100',

  accent: ACCENT,
  accentSoft: 'rgba(240, 246, 0, 0.16)',
  accentEdge: '#EAEAEA',
  onAccent: ACCENT_ON,

  chartArea: CHART_INDIGO,
  chipPastels: ['#FFF3BA', '#FBFCB8', '#EDBABA', '#BAE0FF'],

  gain: '#36A34C',
  gainSoft: 'rgba(54, 163, 76, 0.12)',
  danger: '#F05D5D',
  accentWash: '#FEFFE6',

  up: UP,
  down: DOWN,
  win: ACCENT,
  loss: '#F4F4F4',
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
  accentInk: ACCENT,

  accent: ACCENT,
  accentSoft: 'rgba(240, 246, 0, 0.14)',
  accentEdge: 'rgba(240, 246, 0, 0.30)',
  onAccent: ACCENT_ON,

  chartArea: CHART_INDIGO,
  chipPastels: ['#FFF3BA', '#FBFCB8', '#EDBABA', '#BAE0FF'],

  gain: '#3FBE59',
  gainSoft: 'rgba(63, 190, 89, 0.16)',
  danger: '#F05D5D',
  accentWash: 'rgba(240, 246, 0, 0.08)',

  up: UP,
  down: DOWN,
  win: ACCENT,
  loss: '#2A2A2C',
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
