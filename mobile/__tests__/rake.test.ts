import { describe, it, expect } from 'vitest';

// The locked spec: matchup rake = 3.5%, sidebet rake = 5%.
// These values are sourced from app_config at runtime (rake_percentage /
// sidebet_rake_percentage), but the math is universal and worth pinning down.

const MATCHUP_RAKE = 0.035;
const SIDEBET_RAKE = 0.05;

function matchupPayout(entryTier: number): { pot: number; rake: number; payout: number } {
  const pot = entryTier * 2;
  const rake = Math.round(pot * MATCHUP_RAKE * 100) / 100;
  return { pot, rake, payout: pot - rake };
}

function sidebetPayout(wager: number): { pot: number; rake: number; payout: number } {
  const pot = wager * 2;
  const rake = Math.round(pot * SIDEBET_RAKE * 100) / 100;
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

describe('Sidebet rake calc (5%)', () => {
  it.each([
    [1,  2.00,  0.10, 1.90],
    [5,  10.00, 0.50, 9.50],
    [10, 20.00, 1.00, 19.00],
    [25, 50.00, 2.50, 47.50],
  ])('wager $%d → pot %d, rake %d, payout %d', (wager, pot, rake, payout) => {
    const r = sidebetPayout(wager);
    expect(r.pot).toBeCloseTo(pot, 2);
    expect(r.rake).toBeCloseTo(rake, 2);
    expect(r.payout).toBeCloseTo(payout, 2);
  });
});
