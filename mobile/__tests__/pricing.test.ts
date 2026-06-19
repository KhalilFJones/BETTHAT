import { describe, it, expect } from 'vitest';
import {
  applyPriceTick,
  computeFairFpts,
  computeFairPrice,
  PRICE_FLOOR_MULT,
  PRICE_CEILING_MULT,
  MIN_PRICE,
  MAX_PRICE,
  TIER_BASE,
} from '@/lib/pricing';

// =============================================================================
// FAIR VALUE (fundamentals anchor)
// =============================================================================
describe('computeFairFpts', () => {
  it('weights recent form (last5) more than season when both exist', () => {
    const hotStreak = computeFairFpts({ seasonAvgFpts: 30, last5AvgFpts: 50, last5GamesPlayed: 5 });
    const blended = 0.35 * 30 + 0.65 * 50; // = 43
    expect(hotStreak).toBeCloseTo(blended, 5);
  });

  it('falls back to season average when no recent games', () => {
    const fpts = computeFairFpts({ seasonAvgFpts: 28, last5AvgFpts: 0, last5GamesPlayed: 0 });
    expect(fpts).toBeCloseTo(28, 5);
  });

  it('returns 0 when there is no usable data (rookie / no games)', () => {
    expect(computeFairFpts({ seasonAvgFpts: 0, last5AvgFpts: 0, last5GamesPlayed: 0 })).toBe(0);
  });

  it('applies the minutes/role trend factor, clamped to [0.7, 1.3]', () => {
    const surging = computeFairFpts({
      seasonAvgFpts: 20, last5AvgFpts: 20, last5GamesPlayed: 5,
      seasonAvgMin: 20, last5AvgMin: 40, // 2x → clamps to 1.3
    });
    expect(surging).toBeCloseTo(20 * 1.3, 5);

    const benched = computeFairFpts({
      seasonAvgFpts: 20, last5AvgFpts: 20, last5GamesPlayed: 5,
      seasonAvgMin: 40, last5AvgMin: 4, // 0.1x → clamps to 0.7
    });
    expect(benched).toBeCloseTo(20 * 0.7, 5);
  });

  it('nudges home up and away down', () => {
    const base = { seasonAvgFpts: 30, last5AvgFpts: 30, last5GamesPlayed: 5 };
    const home = computeFairFpts({ ...base, venue: 'home' });
    const away = computeFairFpts({ ...base, venue: 'away' });
    expect(home).toBeGreaterThan(away);
  });

  it('floors negative inputs at zero (bad data guard)', () => {
    expect(computeFairFpts({ seasonAvgFpts: -10, last5AvgFpts: -5, last5GamesPlayed: 5 })).toBe(0);
  });
});

describe('computeFairPrice', () => {
  const slateTop = 50; // best projected player on the slate

  it('scales the slate-top player to ~$200', () => {
    const price = computeFairPrice({
      seasonAvgFpts: 50, last5AvgFpts: 50, last5GamesPlayed: 5, slateTopFairFpts: slateTop,
    });
    expect(price).toBeCloseTo(MAX_PRICE, 1);
  });

  it('clamps within [MIN, MAX]', () => {
    const tiny = computeFairPrice({
      seasonAvgFpts: 0.1, last5AvgFpts: 0.1, last5GamesPlayed: 5, slateTopFairFpts: slateTop,
    });
    expect(tiny).toBeGreaterThanOrEqual(MIN_PRICE);

    const huge = computeFairPrice({
      seasonAvgFpts: 999, last5AvgFpts: 999, last5GamesPlayed: 5, slateTopFairFpts: slateTop,
    });
    expect(huge).toBeLessThanOrEqual(MAX_PRICE);
  });

  it('floors a no-data player by salary tier', () => {
    const star = computeFairPrice({
      seasonAvgFpts: 0, last5AvgFpts: 0, last5GamesPlayed: 0,
      slateTopFairFpts: slateTop, salaryTier: 'superstar',
    });
    expect(star).toBeCloseTo(TIER_BASE.superstar, 1);
  });

  it('degrades to MIN_PRICE on an empty slate (no slate top)', () => {
    expect(
      computeFairPrice({ seasonAvgFpts: 30, last5AvgFpts: 30, last5GamesPlayed: 5, slateTopFairFpts: 0 }),
    ).toBe(MIN_PRICE);
  });
});

// =============================================================================
// MARKET DRIFT (per-tick)
// =============================================================================
describe('applyPriceTick', () => {
  const baseTick = { fairPrice: 50, velocity: 0, demandThisTick: 0, activeUsers: 1000, noiseSample: 0 };

  it('holds steady at fair value with no demand, no velocity, no noise', () => {
    const { price } = applyPriceTick({ ...baseTick, currentPrice: 50 });
    expect(price).toBeCloseTo(50, 5);
  });

  it('moves up under demand (diminishing returns via ln)', () => {
    const { price } = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 10 });
    expect(price).toBeGreaterThan(50);
  });

  it('demand has diminishing returns — 100 is not 10x the push of 10', () => {
    const low = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 10 }).price - 50;
    const high = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 100 }).price - 50;
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(low * 10); // sub-linear
  });

  it('reverts toward fair value via gravity when current > fair', () => {
    const { price } = applyPriceTick({ ...baseTick, currentPrice: 80 });
    expect(price).toBeLessThan(80);
    expect(price).toBeGreaterThan(50 * PRICE_FLOOR_MULT);
  });

  it('clamps to floor and ceiling of fair price', () => {
    const low = applyPriceTick({ ...baseTick, currentPrice: 31, velocity: -1000 });
    expect(low.price).toBeGreaterThanOrEqual(50 * PRICE_FLOOR_MULT);

    const high = applyPriceTick({ ...baseTick, currentPrice: 89, velocity: 1000, demandThisTick: 1000 });
    expect(high.price).toBeLessThanOrEqual(50 * PRICE_CEILING_MULT);
  });

  it('zeros velocity when clamped at a bound (anti-pin)', () => {
    const high = applyPriceTick({ ...baseTick, currentPrice: 89, velocity: 1000, demandThisTick: 1000 });
    expect(high.price).toBeCloseTo(50 * PRICE_CEILING_MULT, 2);
    expect(high.velocity).toBe(0);
  });

  it('applies the cold-start cap (few active users limits demand force at extreme demand)', () => {
    // At extreme demand the ln() force (~8.9) exceeds the 1-user cap (8*sqrt(1)=8)
    // but not the many-user cap (8*sqrt(10000)=800), so the cap binds only for few users.
    const fewUsers = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 20000, activeUsers: 1 });
    const manyUsers = applyPriceTick({ ...baseTick, currentPrice: 50, demandThisTick: 20000, activeUsers: 10000 });
    expect(fewUsers.price).toBeLessThan(manyUsers.price);
  });

  it('scales noise by time-decay (calmer near tip-off)', () => {
    const early = applyPriceTick({ ...baseTick, currentPrice: 50, noiseSample: 1, timeDecay: 1.0 });
    const late = applyPriceTick({ ...baseTick, currentPrice: 50, noiseSample: 1, timeDecay: 0.2 });
    expect(early.price - 50).toBeGreaterThan(late.price - 50);
  });
});
