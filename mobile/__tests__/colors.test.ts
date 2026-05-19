import { describe, it, expect } from 'vitest';
import {
  COLORS,
  salaryColor,
  resultColor,
  propSideLabel,
  priceDirectionColor,
} from '@/lib/utils';

// The audit's M-1 reservation: priceUp #26D782 and priceDown #F24236 are for
// player-price direction UI ONLY. Win/loss/result/prop UI must use semantic
// tokens. These tests fail loudly if anyone wires the reserved palette into
// the wrong helper.

describe('color reservation', () => {
  it('priceUp / priceDown are the locked-spec hexes', () => {
    expect(COLORS.priceUp).toBe('#26D782');
    expect(COLORS.priceDown).toBe('#F24236');
  });

  it('salaryColor never returns priceUp or priceDown', () => {
    const samples = [
      salaryColor(100, 100),
      salaryColor(50, 100),
      salaryColor(15, 100),
      salaryColor(5, 100),
      salaryColor(0, 100),
    ];
    for (const c of samples) {
      expect(c).not.toBe(COLORS.priceUp);
      expect(c).not.toBe(COLORS.priceDown);
    }
  });

  it('resultColor never returns priceUp or priceDown', () => {
    expect(resultColor(true)).not.toBe(COLORS.priceUp);
    expect(resultColor(false)).not.toBe(COLORS.priceDown);
    expect(resultColor(null)).toBe(COLORS.textMuted);
  });

  it('propSideLabel uses win/loss tokens, not price-direction palette', () => {
    expect(propSideLabel('over').color).toBe(COLORS.win);
    expect(propSideLabel('under').color).toBe(COLORS.loss);
    expect(propSideLabel('OVER').color).not.toBe(COLORS.priceUp);
    expect(propSideLabel('UNDER').color).not.toBe(COLORS.priceDown);
  });

  it('priceDirectionColor IS the only legal user of priceUp / priceDown', () => {
    expect(priceDirectionColor(0.5)).toBe(COLORS.priceUp);
    expect(priceDirectionColor(-0.5)).toBe(COLORS.priceDown);
    expect(priceDirectionColor(0)).toBe(COLORS.textMuted);
  });
});
