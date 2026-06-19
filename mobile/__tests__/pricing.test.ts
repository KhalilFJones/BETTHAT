import { describe, it, expect } from 'vitest';
import {
  applyPriceTick,
  computeBaseFpts,
  computeFairFpts,
  computeFairPrice,
  combinedFactor,
  fRest,
  fTeammate,
  fPlayoff,
  fPace,
  fTotal,
  fTeamTotal,
  fDvp,
  fUsage,
  PRICE_FLOOR_MULT,
  PRICE_CEILING_MULT,
  MIN_PRICE,
  MAX_PRICE,
  TIER_BASE,
  COMBINED_MIN,
  COMBINED_MAX,
} from '@/lib/pricing';

// =============================================================================
// BASE PROJECTION
// =============================================================================
describe('computeBaseFpts', () => {
  it('weights recent form (last5) more than season when both exist', () => {
    expect(computeBaseFpts({ seasonAvgFpts: 30, last5AvgFpts: 50, last5GamesPlayed: 5 })).toBeCloseTo(0.35 * 30 + 0.65 * 50, 5);
  });

  it('falls back to season average when no recent games', () => {
    expect(computeBaseFpts({ seasonAvgFpts: 28, last5AvgFpts: 0, last5GamesPlayed: 0 })).toBeCloseTo(28, 5);
  });

  it('blends 50/50 with the prop-implied projection when present', () => {
    const model = 0.35 * 30 + 0.65 * 40;
    expect(computeBaseFpts({ seasonAvgFpts: 30, last5AvgFpts: 40, last5GamesPlayed: 5, propFpts: 50 })).toBeCloseTo(0.5 * model + 0.5 * 50, 5);
  });

  it('ignores a missing / non-positive prop line', () => {
    const model = 0.35 * 30 + 0.65 * 40;
    expect(computeBaseFpts({ seasonAvgFpts: 30, last5AvgFpts: 40, last5GamesPlayed: 5, propFpts: 0 })).toBeCloseTo(model, 5);
  });
});

// =============================================================================
// FACTORS
// =============================================================================
describe('pricing factors', () => {
  it('rest: back-to-back haircut, long-rest bump, neutral otherwise', () => {
    expect(fRest(0)).toBeLessThan(1);
    expect(fRest(1)).toBeLessThan(1);
    expect(fRest(2)).toBe(1);
    expect(fRest(3)).toBeGreaterThan(1);
    expect(fRest(null)).toBe(1);
  });

  it('teammate injuries redistribute usage upward, capped', () => {
    expect(fTeammate(0)).toBe(1);
    expect(fTeammate(2)).toBeCloseTo(1.1, 5);
    expect(fTeammate(50)).toBeLessThanOrEqual(1.2);
  });

  it('playoff bump applies only to high-minute players', () => {
    expect(fPlayoff(true, 32)).toBeGreaterThan(1);
    expect(fPlayoff(true, 10)).toBe(1);
    expect(fPlayoff(false, 32)).toBe(1);
  });

  it('feed-dependent factors are NEUTRAL when their data is absent', () => {
    expect(fPace(null, null)).toBe(1);
    expect(fTotal(null)).toBe(1);
    expect(fTeamTotal(null, null, true)).toBe(1);
    expect(fDvp(null)).toBe(1);
    expect(fUsage(null)).toBe(1);
  });

  it('feed-dependent factors move the price once populated, within bounds', () => {
    expect(fPace(110, 110)).toBeGreaterThan(1);
    expect(fPace(130, 130)).toBeLessThanOrEqual(1.1);
    expect(fTotal(250)).toBeGreaterThan(1);
    expect(fDvp(1.3)).toBeGreaterThan(1);
    expect(fDvp(2)).toBeLessThanOrEqual(1.15);
    expect(fUsage(30)).toBeGreaterThan(1);
    expect(fUsage(50)).toBeLessThanOrEqual(1.15);
  });

  it('team total: the favored side gets the higher implied-total factor', () => {
    // total 230, home favored by 10 (spread -10) → home implied 120 > away 110
    expect(fTeamTotal(230, -10, true)).toBeGreaterThan(fTeamTotal(230, -10, false));
  });

  it('combined multiplier is clamped to [MIN, MAX] (anti-explosion)', () => {
    const allUp = combinedFactor({
      seasonAvgMin: 20, last5AvgMin: 40, venue: 'home', daysRest: 3, injuredTeammates: 10,
      isPlayoffs: true, homePace: 130, awayPace: 130, vegasTotal: 300, vegasSpread: -40, isHome: true,
      dvpMultiplier: 2, usageRate: 40,
    });
    expect(allUp).toBeLessThanOrEqual(COMBINED_MAX);

    const allDown = combinedFactor({
      seasonAvgMin: 40, last5AvgMin: 4, venue: 'away', daysRest: 1,
      homePace: 80, awayPace: 80, vegasTotal: 180, dvpMultiplier: 0.5, usageRate: 5,
    });
    expect(allDown).toBeGreaterThanOrEqual(COMBINED_MIN);
  });
});

// =============================================================================
// FAIR VALUE (projection × factors)
// =============================================================================
describe('computeFairFpts', () => {
  it('equals the base projection when every factor is neutral', () => {
    expect(computeFairFpts({ seasonAvgFpts: 30, last5AvgFpts: 50, last5GamesPlayed: 5 })).toBeCloseTo(0.35 * 30 + 0.65 * 50, 5);
  });

  it('applies the minutes/role trend, clamped to [0.7, 1.3]', () => {
    expect(computeFairFpts({ seasonAvgFpts: 20, last5AvgFpts: 20, last5GamesPlayed: 5, seasonAvgMin: 20, last5AvgMin: 40 })).toBeCloseTo(20 * 1.3, 5);
    expect(computeFairFpts({ seasonAvgFpts: 20, last5AvgFpts: 20, last5GamesPlayed: 5, seasonAvgMin: 40, last5AvgMin: 4 })).toBeCloseTo(20 * 0.7, 5);
  });

  it('raises a healthy player when rotation teammates are injured', () => {
    const base = { seasonAvgFpts: 30, last5AvgFpts: 30, last5GamesPlayed: 5 };
    expect(computeFairFpts({ ...base, injuredTeammates: 2 })).toBeGreaterThan(computeFairFpts(base));
  });

  it('nudges home up and away down', () => {
    const base = { seasonAvgFpts: 30, last5AvgFpts: 30, last5GamesPlayed: 5 };
    expect(computeFairFpts({ ...base, venue: 'home' })).toBeGreaterThan(computeFairFpts({ ...base, venue: 'away' }));
  });

  it('returns 0 with no usable data, and floors negative inputs', () => {
    expect(computeFairFpts({ seasonAvgFpts: 0, last5AvgFpts: 0, last5GamesPlayed: 0 })).toBe(0);
    expect(computeFairFpts({ seasonAvgFpts: -10, last5AvgFpts: -5, last5GamesPlayed: 5 })).toBe(0);
  });
});

describe('computeFairPrice', () => {
  const slateTop = 50;

  it('scales the slate-top player to ~$200 and clamps to [MIN, MAX]', () => {
    expect(computeFairPrice({ seasonAvgFpts: 50, last5AvgFpts: 50, last5GamesPlayed: 5, slateTopFairFpts: slateTop })).toBeCloseTo(MAX_PRICE, 1);
    expect(computeFairPrice({ seasonAvgFpts: 0.1, last5AvgFpts: 0.1, last5GamesPlayed: 5, slateTopFairFpts: slateTop })).toBeGreaterThanOrEqual(MIN_PRICE);
    expect(computeFairPrice({ seasonAvgFpts: 999, last5AvgFpts: 999, last5GamesPlayed: 5, slateTopFairFpts: slateTop })).toBeLessThanOrEqual(MAX_PRICE);
  });

  it('floors a no-data player by salary tier', () => {
    expect(computeFairPrice({ seasonAvgFpts: 0, last5AvgFpts: 0, last5GamesPlayed: 0, slateTopFairFpts: slateTop, salaryTier: 'superstar' })).toBeCloseTo(TIER_BASE.superstar, 1);
  });

  it('degrades to MIN_PRICE on an empty slate', () => {
    expect(computeFairPrice({ seasonAvgFpts: 30, last5AvgFpts: 30, last5GamesPlayed: 5, slateTopFairFpts: 0 })).toBe(MIN_PRICE);
  });
});

// =============================================================================
// MARKET DRIFT (per-second tick)
// =============================================================================
describe('applyPriceTick', () => {
  const baseTick = { fairPrice: 50, velocity: 0, demandThisTick: 0, activeUsers: 1000, noiseSample: 0 };

  it('holds at fair value with no demand, velocity, or noise', () => {
    expect(applyPriceTick({ ...baseTick, currentPrice: 50 }).price).toBeCloseTo(50, 5);
  });

  it('moves up under demand with diminishing returns (ln)', () => {
    const low = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 10 }).price - 50;
    const high = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 100 }).price - 50;
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(low * 10); // sub-linear
  });

  it('reverts toward fair value via gravity when current > fair', () => {
    const { price } = applyPriceTick({ ...baseTick, currentPrice: 80 });
    expect(price).toBeLessThan(80);
    expect(price).toBeGreaterThan(50 * PRICE_FLOOR_MULT);
  });

  it('clamps to floor/ceiling and zeros velocity at a bound (anti-pin)', () => {
    const low = applyPriceTick({ ...baseTick, currentPrice: 31, velocity: -1000 });
    expect(low.price).toBeGreaterThanOrEqual(50 * PRICE_FLOOR_MULT);

    const high = applyPriceTick({ ...baseTick, currentPrice: 89, velocity: 1000, demandThisTick: 1000 });
    expect(high.price).toBeCloseTo(50 * PRICE_CEILING_MULT, 2);
    expect(high.velocity).toBe(0);
  });

  it('applies the cold-start cap (few active users limits demand at extreme demand)', () => {
    const fewUsers = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 60000, activeUsers: 1 });
    const manyUsers = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 60000, activeUsers: 10000 });
    expect(fewUsers.price).toBeLessThan(manyUsers.price);
  });

  it('scales noise by time-decay (calmer near tip-off)', () => {
    const early = applyPriceTick({ ...baseTick, currentPrice: 50, noiseSample: 1, timeDecay: 1.0 });
    const late = applyPriceTick({ ...baseTick, currentPrice: 50, noiseSample: 1, timeDecay: 0.2 });
    expect(early.price - 50).toBeGreaterThan(late.price - 50);
  });
});
