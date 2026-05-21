// =============================================================================
// BETTHAT Holy Grail V2 — design tokens + shared formatters
// Importable from any RN screen / component as plain JS values.
// CSS class names live in tailwind.config.js. These are the same colors as
// hex literals for use in StyleSheet, Animated values, SVG fill/stroke, etc.
// =============================================================================

export const HG = {
  // Surfaces
  jet:         '#0A0A0C',
  surface:     '#141416',
  surfaceRaised: '#1B1C20',
  inputBg:     '#0D0D10',
  hairline:    'rgba(255, 255, 255, 0.08)',
  hairline2:   'rgba(255, 255, 255, 0.14)',
  navy:        '#1B2A4A',
  navySoft:    'rgba(27, 42, 74, 0.32)',

  // Ink
  ink:         '#E8EDF2',
  ink2:        '#C2C8D0',
  muted:       '#8A93A6',
  muted2:      '#5C6473',
  quiet:       'rgba(232, 237, 242, 0.32)',

  // Accent — sky blue is the only accent color in BETTHAT
  sky:         '#5B9BD5',
  skySoft:     'rgba(91, 155, 213, 0.12)',
  skyEdge:     'rgba(91, 155, 213, 0.28)',
  steel:       '#3A5F8A',

  // PRICE-DIRECTION ONLY. Never UI chrome, never WIN/LOSS, never buttons.
  up:          '#26D782',
  upSoft:      'rgba(38, 215, 130, 0.12)',
  down:        '#F24236',
  downSoft:    'rgba(242, 66, 54, 0.12)',

  // For LOSS hero (Game Result): muted gray, not red. "Absence of color is the punishment."
  loss:        '#3a3a3c',
} as const;

export const FONT = {
  sans:        'DMSans_400Regular',
  sansLight:   'DMSans_300Light',
  sansMedium:  'DMSans_500Medium',
  sansBold:    'DMSans_600SemiBold',
  serif:       'DMSerifDisplay_400Regular',
  serifItalic: 'DMSerifDisplay_400Regular_Italic',
  mono:        'IBMPlexMono_400Regular',
  monoMedium:  'IBMPlexMono_500Medium',
  monoBold:    'IBMPlexMono_600SemiBold',

  // ─── HERO FONT (V2.1 Amendment 1) ─────────────────────────────────────
  // VT323 is the closest LED-dot-matrix typeface on Google Fonts and stands
  // in for DSEG7 Classic. Reserve for hero resolution moments only:
  //   ✅ Splash drifting tickers   ✅ Live Game Board score banner
  //   ✅ Match Found wager hero    ✅ Game Result WIN/LOSS + final scores
  //   ❌ Anywhere else (Plex Mono handles working numerics)
  // The contrast between Plex Mono (working) and VT323 (resolution) is the point.
  hero:        'VT323_400Regular',
} as const;

// =============================================================================
// FORMATTERS — Holy Grail register: Plex Mono numbers, period-separated decimals
// =============================================================================

export function fmtPrice(n: number | string | null | undefined): string {
  if (n == null) return '$—';
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '$—';
  return '$' + v.toFixed(2);
}

export function fmtPriceShort(n: number | string | null | undefined): string {
  if (n == null) return '$—';
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '$—';
  return '$' + v.toFixed(0);
}

export function fmtPct(n: number | string | null | undefined, withArrow = true): string {
  if (n == null) return '—';
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '—';
  if (!withArrow) return v.toFixed(1) + '%';
  return (v >= 0 ? '↑ ' : '↓ ') + Math.abs(v).toFixed(1) + '%';
}

export function fmtFP(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(1);
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const now = new Date();
  const sec = (now.getTime() - date.getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h';
  return Math.floor(sec / 86400) + 'd';
}

export function priceDirection(deltaPct: number | string | null | undefined): 'up' | 'down' | 'flat' {
  if (deltaPct == null) return 'flat';
  const v = typeof deltaPct === 'number' ? deltaPct : Number(deltaPct);
  if (!Number.isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

export function priceDirectionColor(deltaPct: number | string | null | undefined): string {
  const d = priceDirection(deltaPct);
  if (d === 'up') return HG.up;
  if (d === 'down') return HG.down;
  return HG.muted;
}

// =============================================================================
// PLAYER UTILS
// =============================================================================

export function playerInitials(p: { first_name?: string | null; last_name?: string | null; full_name?: string | null }): string {
  const first = p.first_name || (p.full_name?.split(' ')[0] ?? '?');
  const last  = p.last_name  || (p.full_name?.split(' ').slice(-1)[0] ?? '?');
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function playerLastName(p: { last_name?: string | null; full_name?: string | null }): string {
  return p.last_name || p.full_name?.split(' ').slice(-1)[0] || '';
}

// Convert Holy Grail fantasy formula or rely on DB column.
// Standard: pts + reb*1.2 + ast*1.5 + stl*3 + blk*3 - to*1
export function calcFantasyPoints(s: {
  points?: number | null; rebounds?: number | null; assists?: number | null;
  steals?: number | null; blocks?: number | null; turnovers?: number | null;
}): number {
  return (
    (s.points ?? 0) +
    (s.rebounds ?? 0) * 1.2 +
    (s.assists ?? 0) * 1.5 +
    (s.steals ?? 0) * 3 +
    (s.blocks ?? 0) * 3 -
    (s.turnovers ?? 0) * 1
  );
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const SALARY_CAP = 500;
export const LINEUP_SIZE = 3;
export const MIN_WAGER = 5;
/** Today's date in YYYY-MM-DD local time. Re-evaluated on each module load. */
export const SLATE_DATE_FALLBACK = new Date().toISOString().slice(0, 10);

// =============================================================================
// OPPONENT COLOR SYSTEM (V2.1 Amendment 2)
// Deterministic hash of username → palette index. Same opponent always gets
// the same color across every screen they appear on.
// =============================================================================

// Locked 8-color palette. NEVER add sky (#5B9BD5 = current user),
// up green (#26D782), or down red (#F24236 — price direction only).
export const OPPONENT_PALETTE = [
  '#3A5F8A', // Steel
  '#1B2A4A', // Navy
  '#6B5B95', // Deep Purple
  '#A0522D', // Terracotta
  '#5C6B3F', // Olive
  '#7B2D26', // Burgundy
  '#2A3B4D', // Slate
  '#3D2E5C', // Ink Purple
] as const;

/**
 * Deterministic opponent accent color from username. Same input → same color,
 * forever. djb2 hash keeps it stable across runtimes / languages so a Postgres
 * port would yield the same index if ever needed.
 */
export function opponentColor(username: string | null | undefined): string {
  if (!username) return OPPONENT_PALETTE[0];
  let hash = 5381;
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) + hash) + username.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  const idx = Math.abs(hash) % OPPONENT_PALETTE.length;
  return OPPONENT_PALETTE[idx];
}
