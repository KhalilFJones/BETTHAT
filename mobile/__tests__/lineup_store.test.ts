import { describe, it, expect, beforeEach } from 'vitest';
import { useLineupStore, LINEUP_SIZE } from '@/stores/lineup.store';

describe('lineup store (3v3, position-unconstrained)', () => {
  beforeEach(() => useLineupStore.getState().reset());

  it('has exactly 3 slots after setTier', () => {
    useLineupStore.getState().setTier(5, 75, 25);
    expect(useLineupStore.getState().slots.length).toBe(LINEUP_SIZE);
    expect(LINEUP_SIZE).toBe(3);
  });

  it('addPlayer fills the first empty slot', () => {
    const s = useLineupStore.getState();
    s.setTier(5, 75, 25);
    s.addPlayer({ id: 'p1', name: 'Player 1', price: 25 });
    expect(useLineupStore.getState().slots[0].playerId).toBe('p1');
    expect(useLineupStore.getState().slots[1].playerId).toBeNull();
  });

  it('addPlayer refuses duplicates', () => {
    const s = useLineupStore.getState();
    s.setTier(5, 75, 25);
    s.addPlayer({ id: 'p1', name: 'Player 1', price: 25 });
    const added = s.addPlayer({ id: 'p1', name: 'Player 1 again', price: 25 });
    expect(added).toBe(false);
    expect(useLineupStore.getState().slots.filter((x) => x.playerId === 'p1').length).toBe(1);
  });

  it('addPlayer fails once the lineup is full', () => {
    const s = useLineupStore.getState();
    s.setTier(5, 75, 25);
    expect(s.addPlayer({ id: 'p1', name: 'P1', price: 25 })).toBe(true);
    expect(s.addPlayer({ id: 'p2', name: 'P2', price: 25 })).toBe(true);
    expect(s.addPlayer({ id: 'p3', name: 'P3', price: 25 })).toBe(true);
    expect(s.addPlayer({ id: 'p4', name: 'P4', price: 25 })).toBe(false);
  });

  it('tracks total + remaining salary', () => {
    const s = useLineupStore.getState();
    s.setTier(5, 75, 25);
    s.addPlayer({ id: 'p1', name: 'P1', price: 25 });
    s.addPlayer({ id: 'p2', name: 'P2', price: 25 });
    expect(useLineupStore.getState().totalSalary).toBe(50);
    expect(useLineupStore.getState().remainingSalary).toBe(25);
  });

  it('removePlayer clears the slot and updates totals', () => {
    const s = useLineupStore.getState();
    s.setTier(5, 75, 25);
    s.addPlayer({ id: 'p1', name: 'P1', price: 25 });
    s.removePlayer(0);
    expect(useLineupStore.getState().slots[0].playerId).toBeNull();
    expect(useLineupStore.getState().totalSalary).toBe(0);
    expect(useLineupStore.getState().remainingSalary).toBe(75);
  });

  it('reset blanks out everything', () => {
    const s = useLineupStore.getState();
    s.setTier(5, 75, 25);
    s.addPlayer({ id: 'p1', name: 'P1', price: 25 });
    s.reset();
    const state = useLineupStore.getState();
    expect(state.tier).toBeNull();
    expect(state.totalSalary).toBe(0);
    expect(state.slots.every((sl) => sl.playerId === null)).toBe(true);
  });
});
