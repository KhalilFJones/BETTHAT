import { create } from 'zustand';

// Locked spec: 3v3 lineups. Slots are unconstrained by position — server
// validates only the total against entry_tier_caps. UI surfaces slot 1/2/3 in
// the order picked; players can be swapped out by tapping a filled slot.

export interface LineupSlot {
  playerId: string | null;
  playerName: string | null;
  price: number;
}

export const LINEUP_SIZE = 3;

interface LineupBuilderState {
  tier: number | null;       // entry_tier dollars: 1, 5, 10, 20, 50
  salaryCap: number;         // max total frozen price (from entry_tier_caps)
  minCap: number;            // min total frozen price (from entry_tier_caps)
  slots: LineupSlot[];
  totalSalary: number;
  remainingSalary: number;
  setTier: (tier: number, cap: number, minCap?: number) => void;
  addPlayer: (player: { id: string; name: string; price: number }) => boolean;
  removePlayer: (slotIndex: number) => void;
  reset: () => void;
}

const emptySlots = (): LineupSlot[] =>
  Array.from({ length: LINEUP_SIZE }, () => ({
    playerId: null,
    playerName: null,
    price: 0,
  }));

export const useLineupStore = create<LineupBuilderState>((set, get) => ({
  tier: null,
  salaryCap: 0,
  minCap: 0,
  slots: emptySlots(),
  totalSalary: 0,
  remainingSalary: 0,

  setTier: (tier, cap, minCap = 0) =>
    set({
      tier,
      salaryCap: cap,
      minCap,
      slots: emptySlots(),
      totalSalary: 0,
      remainingSalary: cap,
    }),

  // Returns true if the player was added; false if no empty slot.
  addPlayer: (player) => {
    const { slots, salaryCap } = get();
    if (slots.some((s) => s.playerId === player.id)) return false;
    const idx = slots.findIndex((s) => s.playerId === null);
    if (idx < 0) return false;
    const next = slots.map((s, i) =>
      i === idx
        ? { playerId: player.id, playerName: player.name, price: player.price }
        : s,
    );
    const totalSalary = next.reduce((sum, s) => sum + s.price, 0);
    set({
      slots: next,
      totalSalary,
      remainingSalary: salaryCap - totalSalary,
    });
    return true;
  },

  removePlayer: (slotIndex) => {
    const { slots, salaryCap } = get();
    if (slotIndex < 0 || slotIndex >= slots.length) return;
    const next = slots.map((s, i) =>
      i === slotIndex ? { playerId: null, playerName: null, price: 0 } : s,
    );
    const totalSalary = next.reduce((sum, s) => sum + s.price, 0);
    set({
      slots: next,
      totalSalary,
      remainingSalary: salaryCap - totalSalary,
    });
  },

  reset: () =>
    set({
      tier: null,
      salaryCap: 0,
      minCap: 0,
      slots: emptySlots(),
      totalSalary: 0,
      remainingSalary: 0,
    }),
}));
