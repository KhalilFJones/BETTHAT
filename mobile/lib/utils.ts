// ─────────────────────────────────────────────────────────────────────────────
// Utility formatters + color helpers.
//
// Color reservation rules (per locked spec, see Phase 5 design system pass):
//
//   priceUp   = #26D782    ← reserved for player-price *direction* UI only
//   priceDown = #F24236    ← reserved for player-price *direction* UI only
//
// Win/loss results, salary warnings, transaction direction, prop sides, and
// any other "good/bad" UI use the win/loss/warning/info tokens defined in
// tailwind.config.js — NOT the price-direction palette.
// ─────────────────────────────────────────────────────────────────────────────

// Hex constants mirror the design tokens. Use the className tokens in JSX
// (bg-win, text-loss, etc.) wherever possible — these are for the rare cases
// where you must pass a hex via `style` (e.g. ActivityIndicator, charts).
export const COLORS = {
  bg:        '#0A0A0C',
  surface:   '#141416',
  border:    '#2A2A2E',
  text:      '#FFFFFF',
  textMuted: '#71717A',
  brand:     '#F5A524',
  // Reserved — price direction ONLY.
  priceUp:   '#2FAE60',
  priceDown: '#D6453C',
  // Semantic — everything else.
  win:       '#0E8C44',
  loss:      '#B23A2E',
  warning:   '#E0A227',
  info:      '#3B82F6',
} as const;

export function formatCurrency(amount: number | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

export function formatFP(pts: number | string | null | undefined): string {
  if (pts == null) return '-';
  const n = typeof pts === 'number' ? pts : Number(pts);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(1);
}

export function formatStatLine(
  pts: number | string | null | undefined,
  reb: number | string | null | undefined,
  ast: number | string | null | undefined,
): string {
  const fmt = (v: number | string | null | undefined) => {
    if (v == null) return '-';
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n.toFixed(1) : '-';
  };
  return `${fmt(pts)} / ${fmt(reb)} / ${fmt(ast)}`;
}

export function formatPct(pct: number | string | null | undefined): string {
  if (pct == null) return '-';
  const n = typeof pct === 'number' ? pct : Number(pct);
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(1)}%`;
}

export function formatGameTime(isoString: string | null): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  // Device locale decides 12- vs 24-hour and the timezone.
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Salary remaining: uses semantic warning/loss tokens — never the reserved
// price-direction palette.
export function salaryColor(remaining: number, cap: number): string {
  if (cap <= 0) return COLORS.textMuted;
  const pct = remaining / cap;
  if (pct > 0.3) return COLORS.win;
  if (pct > 0.1) return COLORS.warning;
  return COLORS.loss;
}

// Tier color mapping. The superstar gold is intentionally different from brand
// gold to avoid the visual collision the audit flagged (M-19).
export const TIER_COLORS: Record<string, string> = {
  budget:    '#6B7280',
  mid:       '#3B82F6',
  star:      '#A855F7',
  superstar: '#EAB308',
};

// Entry tier → salary cap. Authoritative source is the `entry_tier_caps` DB
// table; this is a fallback only when caps haven't loaded yet.
// As of the $500-unified-cap migration, all tiers share the same cap.
export const SALARY_CAP_MAX = 500;
export const SALARY_CAP_MIN = 250;
export const TIER_CAPS: Record<string, number> = {
  '$1':  SALARY_CAP_MAX,
  '$5':  SALARY_CAP_MAX,
  '$10': SALARY_CAP_MAX,
  '$20': SALARY_CAP_MAX,
  '$50': SALARY_CAP_MAX,
};

// Result indicator (win/loss/push) — uses semantic tokens, never priceUp/Down.
export function resultColor(won: boolean | null): string {
  if (won === null) return COLORS.textMuted;
  return won ? COLORS.win : COLORS.loss;
}

export const RANK_COLORS: Record<string, string> = {
  Bronze:   '#CD7F32',
  Silver:   '#C0C0C0',
  Gold:     '#FFD700',
  Platinum: '#E5E4E2',
  Diamond:  '#B9F2FF',
};

export function truncateName(name: string, maxLen = 16): string {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0]}. ${parts[parts.length - 1]}`;
  }
  return name.slice(0, maxLen - 1) + '…';
}

// Over/under label colors are semantic win/loss tokens, not priceUp/priceDown.
export function propSideLabel(side: 'over' | 'under' | 'OVER' | 'UNDER'): { label: string; color: string } {
  const upper = side.toUpperCase();
  return upper === 'OVER'
    ? { label: 'OVER',  color: COLORS.win  }
    : { label: 'UNDER', color: COLORS.loss };
}

// Price-direction color — the ONLY function allowed to return priceUp/priceDown.
// Use only for player-price tickers, price-change indicators, sparkline trends.
export function priceDirectionColor(delta: number): string {
  if (delta > 0) return COLORS.priceUp;
  if (delta < 0) return COLORS.priceDown;
  return COLORS.textMuted;
}
