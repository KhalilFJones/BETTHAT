// Currency formatting
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Fantasy points formatting
export function formatFP(pts: number | null | undefined): string {
  if (pts == null) return '-';
  return pts.toFixed(1);
}

// Stat line formatting (e.g., "28.4 / 9.2 / 7.1")
export function formatStatLine(
  pts: number | null | undefined,
  reb: number | null | undefined,
  ast: number | null | undefined
): string {
  const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(1) : '-');
  return `${fmt(pts)} / ${fmt(reb)} / ${fmt(ast)}`;
}

// Percentage formatting
export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return '-';
  return `${(pct * 100).toFixed(1)}%`;
}

// Time formatting for game clock
export function formatGameTime(isoString: string | null): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Salary cap remaining color
export function salaryColor(remaining: number, cap: number): string {
  const pct = remaining / cap;
  if (pct > 0.3) return '#22C55E';  // green — plenty of room
  if (pct > 0.1) return '#F59E0B';  // amber — tight
  return '#EF4444';                  // red — almost over
}

// Tier color mapping
export const TIER_COLORS: Record<string, string> = {
  budget:    '#6B7280',
  mid:       '#3B82F6',
  star:      '#A855F7',
  superstar: '#F59E0B',
};

// Entry tier to salary cap mapping
export const TIER_CAPS: Record<string, number> = {
  '$1':  45,
  '$5':  75,
  '$10': 105,
  '$20': 135,
  '$50': 180,
};

// Win/loss color
export function resultColor(won: boolean | null): string {
  if (won === null) return '#71717A';
  return won ? '#22C55E' : '#EF4444';
}

// Rank tier colors
export const RANK_COLORS: Record<string, string> = {
  Bronze:   '#CD7F32',
  Silver:   '#C0C0C0',
  Gold:     '#FFD700',
  Platinum: '#E5E4E2',
  Diamond:  '#B9F2FF',
};

// Truncate long name
export function truncateName(name: string, maxLen = 16): string {
  if (name.length <= maxLen) return name;
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0]}. ${parts[parts.length - 1]}`;
  }
  return name.slice(0, maxLen - 1) + '…';
}

// Over/under label with color
export function propSideLabel(side: 'over' | 'under'): { label: string; color: string } {
  return side === 'over'
    ? { label: 'OVER', color: '#22C55E' }
    : { label: 'UNDER', color: '#EF4444' };
}
