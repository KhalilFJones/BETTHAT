import { describe, it, expect } from 'vitest';
import { applyPriceTick, PRICE_FLOOR_MULT, PRICE_CEILING_MULT } from '@/lib/pricing';

describe('applyPriceTick (locked spec formula)', () => {
  it('returns current price when demand=0 and velocity=0 (only tiny noise + gravity)', () => {
    const next = applyPriceTick({
      currentPrice: 50,
      basePrice: 50,
      velocity: 0,
      demandThisTick: 0,
      activeUsers: 1000,
      noise: 0, // deterministic for test
    });
    expect(next).toBeCloseTo(50, 5);
  });

  it('moves price up when there is demand (upward-only demand force)', () => {
    const next = applyPriceTick({
      currentPrice: 50,
      basePrice: 50,
      velocity: 0,
      demandThisTick: 10,
      activeUsers: 1000,
      noise: 0,
    });
    expect(next).toBeGreaterThan(50);
  });

  it('reverts toward base via gravity when current > base and demand=0', () => {
    const next = applyPriceTick({
      currentPrice: 80,
      basePrice: 50,
      velocity: 0,
      demandThisTick: 0,
      activeUsers: 1000,
      noise: 0,
    });
    // gravity = (50 - 80) * 0.008 = -0.24 → price decreases
    expect(next).toBeLessThan(80);
    expect(next).toBeGreaterThan(50 * PRICE_FLOOR_MULT);
  });

  it('clamps to floor (60%) and ceiling (180%) of base price', () => {
    const low = applyPriceTick({
      currentPrice: 30,
      basePrice: 50,
      velocity: -1000,
      demandThisTick: 0,
      activeUsers: 1000,
      noise: 0,
    });
    expect(low).toBeGreaterThanOrEqual(50 * PRICE_FLOOR_MULT);

    const high = applyPriceTick({
      currentPrice: 89,
      basePrice: 50,
      velocity: 1000,
      demandThisTick: 1000,
      activeUsers: 1000,
      noise: 0,
    });
    expect(high).toBeLessThanOrEqual(50 * PRICE_CEILING_MULT);
  });

  it('applies cold-start cap (low active_users limits demand_force)', () => {
    const withLowUsers = applyPriceTick({
      currentPrice: 50,
      basePrice: 50,
      velocity: 0,
      demandThisTick: 1000, // huge demand
      activeUsers: 4,        // tiny user base
      noise: 0,
    });
    const withHighUsers = applyPriceTick({
      currentPrice: 50,
      basePrice: 50,
      velocity: 0,
      demandThisTick: 1000,
      activeUsers: 10000,
      noise: 0,
    });
    expect(withLowUsers).toBeLessThan(withHighUsers);
  });
});
