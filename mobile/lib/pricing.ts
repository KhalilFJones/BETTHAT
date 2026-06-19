// BETTHAT pricing engine — TypeScript reference implementation (v3).
//
// The authoritative implementation runs server-side in the
// `recalibrate_player_prices` / `refresh_fair_prices` / `tick_player_prices`
// RPCs + the `v_player_fair_value` view
// (supabase/migrations/20260618000000_pricing_v3_realtime_factors.sql). This
// module mirrors that math so we can unit-test it and run client "what-if"
// previews off the same constants.
//
// Model:
//   fair value  = base projection (recent-form blend, optionally fused with the
//                 prop line) × a product of bounded FACTORS, scaled so the
//                 slate's top player ≈ $200.
//   live price  = drifts around fair value EVERY second (demand + gravity +
//                 momentum + tiny noise) until the game tips off, then it locks.
//
// Every data-feed factor defaults to NEUTRAL (1.0) so missing data == no effect.

// ── Base-projection constants ────────────────────────────────────────────────
export const SEASON_WEIGHT = 0.35;
export const LAST5_WEIGHT = 0.65;
export const PROP_BLEND = 0.5; // weight on prop-implied fpts when present
export const MIN_PRICE = 5;
export const MAX_PRICE = 200;
export const TARGET_TOP_PRICE = 200;
export const TIER_BASE: Record<string, number> = { superstar: 110, star: 70, mid: 30, budget: 10 };

// ── Factor bounds + league-average normalizers ───────────────────────────────
export const MIN_MINUTES_FACTOR = 0.7;
export const MAX_MINUTES_FACTOR = 1.3;
export const HOME_FACTOR = 1.02;
export const AWAY_FACTOR = 0.98;
export const REST_B2B_FACTOR = 0.96; // back-to-back fatigue
export const REST_LONG_FACTOR = 1.02; // 3+ days rest
export const TEAMMATE_PER_INJURY = 0.05; // usage bump per rotation teammate out
export const TEAMMATE_MAX = 1.2;
export const PLAYOFF_FACTOR = 1.03;
export const PLAYOFF_MIN_MINUTES = 28;
export const LEAGUE_PACE = 100;
export const LEAGUE_TOTAL = 230;
export const LEAGUE_TEAM_TOTAL = 115;
export const LEAGUE_USAGE = 20;
export const COMBINED_MIN = 0.55; // total multiplier floor (anti-explosion)
export const COMBINED_MAX = 1.6; // total multiplier ceiling

// ── Per-second market-drift constants (sized for a ~1s tick) ─────────────────
export const DEMAND_COEF = 0.15;
export const GRAVITY_COEF = 0.01;
export const VELOCITY_COEF = 0.1;
export const COLDSTART_CAP = 1.5;
export const NOISE_PCT = 0.0015; // ±0.15% of fair per tick, time-decayed
export const PRICE_FLOOR_MULT = 0.6;
export const PRICE_CEILING_MULT = 1.8;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

export type Venue = 'home' | 'away' | null;

// ── Individual factors (each defaults to neutral 1.0 when data is absent) ─────
export const fMinutes = (seasonMin?: number, last5Min?: number): number =>
  seasonMin && seasonMin > 0 ? clamp((last5Min ?? seasonMin) / seasonMin, MIN_MINUTES_FACTOR, MAX_MINUTES_FACTOR) : 1;

export const fHome = (venue?: Venue): number => (venue === 'home' ? HOME_FACTOR : venue === 'away' ? AWAY_FACTOR : 1);

export const fRest = (daysRest?: number | null): number =>
  daysRest == null ? 1 : daysRest <= 1 ? REST_B2B_FACTOR : daysRest >= 3 ? REST_LONG_FACTOR : 1;

export const fTeammate = (injuredTeammates?: number): number =>
  Math.min(TEAMMATE_MAX, 1 + TEAMMATE_PER_INJURY * Math.max(0, injuredTeammates ?? 0));

export const fPlayoff = (isPlayoffs?: boolean, seasonMin?: number): number =>
  isPlayoffs && (seasonMin ?? 0) >= PLAYOFF_MIN_MINUTES ? PLAYOFF_FACTOR : 1;

export const fPace = (homePace?: number | null, awayPace?: number | null): number =>
  clamp(((homePace ?? LEAGUE_PACE) + (awayPace ?? LEAGUE_PACE)) / 2 / LEAGUE_PACE, 0.9, 1.1);

export const fTotal = (vegasTotal?: number | null): number =>
  clamp((vegasTotal ?? LEAGUE_TOTAL) / LEAGUE_TOTAL, 0.9, 1.1);

export const fTeamTotal = (vegasTotal?: number | null, vegasSpread?: number | null, isHome?: boolean): number => {
  if (vegasTotal == null || vegasSpread == null) return 1;
  const implied = isHome ? vegasTotal / 2 - vegasSpread / 2 : vegasTotal / 2 + vegasSpread / 2;
  return clamp(implied / LEAGUE_TEAM_TOTAL, 0.9, 1.12);
};

export const fDvp = (dvpMultiplier?: number | null): number => clamp(dvpMultiplier ?? 1, 0.85, 1.15);

export const fUsage = (usageRate?: number | null): number => clamp((usageRate ?? LEAGUE_USAGE) / LEAGUE_USAGE, 0.85, 1.15);

export interface FactorInputs {
  seasonAvgMin?: number;
  last5AvgMin?: number;
  venue?: Venue;
  isHome?: boolean;
  daysRest?: number | null;
  injuredTeammates?: number;
  isPlayoffs?: boolean;
  homePace?: number | null;
  awayPace?: number | null;
  vegasTotal?: number | null;
  vegasSpread?: number | null;
  dvpMultiplier?: number | null;
  usageRate?: number | null;
}

/** Product of all factors, clamped so they can't compound into the absurd. */
export function combinedFactor(i: FactorInputs): number {
  const product =
    fMinutes(i.seasonAvgMin, i.last5AvgMin) *
    fHome(i.venue) *
    fRest(i.daysRest) *
    fTeammate(i.injuredTeammates) *
    fPlayoff(i.isPlayoffs, i.seasonAvgMin) *
    fPace(i.homePace, i.awayPace) *
    fTotal(i.vegasTotal) *
    fTeamTotal(i.vegasTotal, i.vegasSpread, i.isHome ?? i.venue === 'home') *
    fDvp(i.dvpMultiplier) *
    fUsage(i.usageRate);
  return clamp(product, COMBINED_MIN, COMBINED_MAX);
}

export interface FairFptsInput extends FactorInputs {
  seasonAvgFpts: number;
  last5AvgFpts: number;
  last5GamesPlayed: number;
  /** Prop-implied fpts (pts + reb*1.2 + ast*1.5 + blk*3) when prop lines exist. */
  propFpts?: number | null;
}

/** Base projection: recent-form blend, optionally fused 50/50 with the prop signal. */
export function computeBaseFpts(i: FairFptsInput): number {
  const model =
    i.last5GamesPlayed > 0 && i.last5AvgFpts > 0
      ? SEASON_WEIGHT * Math.max(0, i.seasonAvgFpts) + LAST5_WEIGHT * Math.max(0, i.last5AvgFpts)
      : i.seasonAvgFpts > 0
        ? Math.max(0, i.seasonAvgFpts)
        : 0;
  return i.propFpts != null && i.propFpts > 0 ? PROP_BLEND * model + (1 - PROP_BLEND) * i.propFpts : model;
}

/** Projected fantasy output = base projection × the combined factor multiplier. */
export function computeFairFpts(i: FairFptsInput): number {
  return Math.max(0, computeBaseFpts(i)) * combinedFactor(i);
}

export interface FairPriceInput extends FairFptsInput {
  /** MAX(fairFpts) across healthy, data-backed players in the slate. */
  slateTopFairFpts: number;
  salaryTier?: string | null;
}

/**
 * Scales fair fantasy output to a dollar price so the slate's top projected
 * player ≈ $200, clamped to [$5, $200]. No-data players are floored by tier.
 */
export function computeFairPrice(i: FairPriceInput): number {
  const fpts = computeFairFpts(i);
  const hasData = i.last5GamesPlayed > 0 || i.seasonAvgFpts > 0;
  if (!(i.slateTopFairFpts > 0)) return MIN_PRICE; // empty slate — degrade gracefully
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
  /** 0.2 (near tip) .. 1.0. No upcoming game ⇒ 1.0 (full, constant motion). */
  timeDecay?: number;
  /** U(-1,1) noise draw. Defaults to 0 for deterministic callers/tests. */
  noiseSample?: number;
}

export interface PriceTickResult {
  price: number;
  velocity: number;
}

/**
 * One per-second tick: drift the live price around fair value with demand
 * (diminishing returns + cold-start cap), gravity (mean reversion), momentum,
 * and time-decayed noise — clamped to [fair*0.6, fair*1.8]. Velocity zeroes when
 * clamped at a bound (anti-pin). Runs continuously until tip-off.
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

  const velocity = raw !== price ? 0 : round4(price - i.currentPrice);
  return { price: round2(price), velocity };
}
