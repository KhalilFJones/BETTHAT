import { describe, it, expect } from 'vitest';

// The locked spec: matchup rake = 3.5%. This value is sourced from app_config
// at runtime (rake_percentage), but the math is universal and worth pinning down.

const MATCHUP_RAKE = 0.035;

function matchupPayout(entryTier: number): { pot: number; rake: number; payout: number } {
  const pot = entryTier * 2;
  const rake = Math.round(pot * MATCHUP_RAKE * 100) / 100;
  return { pot, rake, payout: pot - rake };
}

describe('Matchup rake calc (3.5%)', () => {
  it.each([
    [1,  2.00, 0.07, 1.93],
    [5,  10.00, 0.35, 9.65],
    [10, 20.00, 0.70, 19.30],
    [20, 40.00, 1.40, 38.60],
    [50, 100.00, 3.50, 96.50],
  ])('entry $%d → pot %d, rake %d, payout %d', (entry, pot, rake, payout) => {
    const r = matchupPayout(entry);
    expect(r.pot).toBeCloseTo(pot, 2);
    expect(r.rake).toBeCloseTo(rake, 2);
    expect(r.payout).toBeCloseTo(payout, 2);
  });

  it('rake never exceeds pot', () => {
    const r = matchupPayout(50);
    expect(r.rake).toBeLessThan(r.pot);
    expect(r.rake).toBeGreaterThan(0);
  });
});
