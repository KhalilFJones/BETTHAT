// BETTHAT pricing engine — TypeScript reference implementation.
//
// The authoritative implementation runs server-side in the
// `recalibrate_player_prices`, `sync_price_windows`, `tick_player_prices`, and
// `lock_prices_for_live_games` SECURITY DEFINER RPCs
// (supabase/migrations/20260524000100_dynamic_pricing_v2.sql). This module
// mirrors that math so we can:
//   - unit-test it (Vitest)
//   - run client-side "what-if" previews off the same constants
//
// Model:  fair value (fundamentals anchor) + market drift (during a pre-game
// window only). Prices only move between market_open_at and tip-off; at tip-off
// the price locks. See computeFairPrice + applyPriceTick below.

// ── Fair-value (fundamentals) constants ──────────────────────────────────────
export const SEASON_WEIGHT = 0.35;
export const LAST5_WEIGHT = 0.65;
export const MIN_PRICE = 5;
export const MAX_PRICE = 200;
export const TARGET_TOP_PRICE = 200;
export const MIN_MINUTES_FACTOR = 0.7;
export const MAX_MINUTES_FACTOR = 1.3;
export const HOME_FACTOR = 1.02;
export const AWAY_FACTOR = 0.98;
// Resting price floors for players with no usable stats (rookies / returnees),
// so a no-data superstar isn't priced like a benchwarmer.
export const TIER_BASE: Record<string, number> = {
  superstar: 110,
  star: 70,
  mid: 30,
  budget: 10,
};

// ── Market-drift (per-tick) constants ────────────────────────────────────────
export const DEMAND_COEF = 0.9; // weight on ln(1 + demand)
export const GRAVITY_COEF = 0.05; // pull toward fair value per tick
export const VELOCITY_COEF = 0.25; // mild momentum
export const COLDSTART_CAP = 8; // demand force ceiling = CAP * sqrt(activeUsers)
export const NOISE_PCT = 0.015; // ±1.5% of fair, scaled by time-decay
export const PRICE_FLOOR_MULT = 0.6;
export const PRICE_CEILING_MULT = 1.8;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

export type Venue = 'home' | 'away' | null;

export interface FairFptsInput {
  seasonAvgFpts: number;
  last5AvgFpts: number;
  last5GamesPlayed: number;
  seasonAvgMin?: number;
  last5AvgMin?: number;
  venue?: Venue;
}

/**
 * Projected fantasy output for a player: recent-form-weighted blend, adjusted
 * for a minutes/role trend and home/away. Falls back season → 0 when no recent
 * games. All inputs are floored at 0 to guard against bad data.
 */
export function computeFairFpts(i: FairFptsInput): number {
  const base =
    i.last5GamesPlayed > 0 && i.last5AvgFpts > 0
      ? SEASON_WEIGHT * Math.max(0, i.seasonAvgFpts) + LAST5_WEIGHT * Math.max(0, i.last5AvgFpts)
      : i.seasonAvgFpts > 0
        ? Math.max(0, i.seasonAvgFpts)
        : 0;

  const minutesFactor =
    i.seasonAvgMin && i.seasonAvgMin > 0
      ? clamp((i.last5AvgMin ?? i.seasonAvgMin) / i.seasonAvgMin, MIN_MINUTES_FACTOR, MAX_MINUTES_FACTOR)
      : 1.0;

  const venueFactor = i.venue === 'home' ? HOME_FACTOR : i.venue === 'away' ? AWAY_FACTOR : 1.0;

  return Math.max(0, base) * minutesFactor * venueFactor;
}

export interface FairPriceInput extends FairFptsInput {
  /** MAX(fairFpts) across healthy, data-backed players in the slate. */
  slateTopFairFpts: number;
  salaryTier?: string | null;
}

/**
 * Scales a player's fair fantasy output to a dollar price so the slate's top
 * projected player ≈ $200, clamped to [$5, $200]. No-data players are floored
 * by salary tier.
 */
export function computeFairPrice(i: FairPriceInput): number {
  const fpts = computeFairFpts(i);
  const hasData = i.last5GamesPlayed > 0 || i.seasonAvgFpts > 0;
  if (!(i.slateTopFairFpts > 0)) return MIN_PRICE; // degrade gracefully — empty slate
  const scaled = fpts * (TARGET_TOP_PRICE / i.slateTopFairFpts);
  const tierBase = hasData ? 0 : TIER_BASE[i.salaryTier ?? 'budget'] ?? TIER_BASE.budget;
  return round2(clamp(Math.max(scaled, tierBase), MIN_PRICE, MAX_PRICE));
}

export interface PriceTickInput {
  currentPrice: number;
  fairPrice: number;
  velocity: number;
  demandThisTick: number;
  activeUsers: number;
  /** 0.2 (near tip) .. 1.0 (window open). Defaults to 1. */
  timeDecay?: number;
  /** U(-1,1) noise draw. Defaults to 0 for deterministic callers/tests. */
  noiseSample?: number;
}

export interface PriceTickResult {
  price: number;
  velocity: number;
}

/**
 * One pre-game tick: drift the live price around fair value with demand
 * (diminishing returns + cold-start cap), gravity (mean reversion), momentum,
 * and time-decayed noise — clamped to [fair*0.6, fair*1.8]. Velocity zeroes out
 * when clamped at a bound (anti-pin).
 */
export function applyPriceTick(i: PriceTickInput): PriceTickResult {
  const demandForce = Math.min(
    DEMAND_COEF * Math.log(1 + Math.max(0, i.demandThisTick)),
    COLDSTART_CAP * Math.sqrt(Math.max(1, i.activeUsers)),
  );
  const gravity = (i.fairPrice - i.currentPrice) * GRAVITY_COEF;
  const velocityTerm = i.velocity * VELOCITY_COEF;
  const decay = clamp(i.timeDecay ?? 1, 0.2, 1.0);
  const noise = (i.noiseSample ?? 0) * NOISE_PCT * i.fairPrice * decay;

  const raw = i.currentPrice + demandForce + gravity + velocityTerm + noise;
  const floor = i.fairPrice * PRICE_FLOOR_MULT;
  const ceiling = i.fairPrice * PRICE_CEILING_MULT;
  const price = clamp(raw, floor, ceiling);

  // Anti-pin: if we clamped, kill directional velocity so it doesn't oscillate.
  const velocity = raw !== price ? 0 : round4(price - i.currentPrice);
  return { price: round2(price), velocity };
}
