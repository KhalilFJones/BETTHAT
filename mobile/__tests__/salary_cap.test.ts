import { describe, it, expect } from 'vitest';

// Authoritative caps come from the entry_tier_caps DB table — this constant
// mirrors the seed values for testing the client-side enforcement logic.
const CAPS: Record<number, { min: number; max: number }> = {
  1:  { min: 12,  max: 45 },
  5:  { min: 25,  max: 75 },
  10: { min: 40,  max: 105 },
  20: { min: 55,  max: 135 },
  50: { min: 75,  max: 180 },
};

function validateLineupTotal(entryTier: number, prices: number[]): {
  ok: boolean;
  reason?: string;
  total: number;
} {
  if (prices.length !== 3) {
    return { ok: false, reason: 'must contain 3 players', total: 0 };
  }
  const total = prices.reduce((a, b) => a + b, 0);
  const cap = CAPS[entryTier];
  if (!cap) return { ok: false, reason: 'invalid tier', total };
  if (total < cap.min) return { ok: false, reason: 'below min', total };
  if (total > cap.max) return { ok: false, reason: 'over cap', total };
  return { ok: true, total };
}

describe('salary cap enforcement (3v3 lineups)', () => {
  it('rejects lineups with != 3 players', () => {
    expect(validateLineupTotal(5, [25, 25]).ok).toBe(false);
    expect(validateLineupTotal(5, [25, 25, 25, 25]).ok).toBe(false);
  });

  it('accepts a 3-player lineup within the tier cap', () => {
    const r = validateLineupTotal(5, [25, 25, 25]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(75);
  });

  it('rejects lineups under min', () => {
    const r = validateLineupTotal(5, [5, 5, 5]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('below min');
  });

  it('rejects lineups over the cap', () => {
    const r = validateLineupTotal(5, [30, 30, 30]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('over cap');
  });

  it('accepts exactly-at-cap lineups', () => {
    const r = validateLineupTotal(10, [40, 35, 30]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(105);
  });

  it('rejects an unknown tier', () => {
    expect(validateLineupTotal(100, [30, 30, 30]).ok).toBe(false);
  });
});
