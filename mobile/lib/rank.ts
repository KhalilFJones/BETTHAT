// =============================================================================
// BETTHAT — rank ladder (display-only derivation)
// -----------------------------------------------------------------------------
// The Match Result screen shows a "Gold III → Gold IV, +245" progression bar,
// but the schema has no ladder behind it: profiles.rank_tier stores a bare
// tier name (Bronze…Diamond) with no divisions and no points column, and
// nothing awards points on settlement.
//
// Rather than invent a stored column, everything here is DERIVED from figures
// the profile already tracks, so the bar is consistent and explainable:
//   • the tier NAME always comes from profiles.rank_tier, so this screen can
//     never contradict the rest of the app;
//   • the division and fill come from the user's own record;
//   • the "+N" delta is what this specific matchup contributed.
//
// Swap `rankProgress` for real queries once an actual ladder exists — it is
// the single place any of this is computed.
// =============================================================================

const DIVISIONS = ['I', 'II', 'III', 'IV'] as const;
const POINTS_PER_DIVISION = 500;
const POINTS_PER_TIER = POINTS_PER_DIVISION * DIVISIONS.length;

/** Lifetime points: a win is worth more than the money, but money still counts. */
export function lifetimePoints(totalWins: number, totalEarnings: number): number {
  return Math.max(0, Math.round(totalWins * 120 + Math.max(0, totalEarnings)));
}

/** Points this single matchup contributed — a win pays out, a loss still shows up. */
export function matchPoints(won: boolean, payout: number, entry: number): number {
  return won ? 150 + Math.max(0, Math.round(payout - entry)) : 25;
}

export interface RankProgress {
  tier: string;        // "Gold"
  division: string;    // "III"
  label: string;       // "Gold III"
  nextLabel: string;   // "Gold IV"
  /** 0..1 fill of the bar toward the next division. */
  progress: number;
  delta: number;       // "+245"
}

export function rankProgress(
  tier: string | null | undefined,
  totalWins: number,
  totalEarnings: number,
  delta: number,
): RankProgress {
  const safeTier = tier?.trim() || 'Bronze';
  const points = lifetimePoints(totalWins, totalEarnings);
  const withinTier = points % POINTS_PER_TIER;
  const divIndex = Math.min(DIVISIONS.length - 1, Math.floor(withinTier / POINTS_PER_DIVISION));
  const withinDivision = withinTier - divIndex * POINTS_PER_DIVISION;

  const division = DIVISIONS[divIndex];
  const nextLabel =
    divIndex < DIVISIONS.length - 1
      ? `${safeTier} ${DIVISIONS[divIndex + 1]}`
      : `${nextTier(safeTier)} I`;

  return {
    tier: safeTier,
    division,
    label: `${safeTier} ${division}`,
    nextLabel,
    progress: Math.max(0, Math.min(1, withinDivision / POINTS_PER_DIVISION)),
    delta,
  };
}

const LADDER = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
function nextTier(tier: string): string {
  const i = LADDER.findIndex((t) => t.toLowerCase() === tier.toLowerCase());
  if (i < 0 || i === LADDER.length - 1) return tier;
  return LADDER[i + 1];
}
