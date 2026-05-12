import { create } from 'zustand';

interface LineupSlot {
  position: string; // 'PG' | 'SG' | 'SF' | 'PF' | 'C'
  playerId: string | null;
  playerName: string | null;
  price: number;
}

interface LineupBuilderState {
  tier: '$1' | '$5' | '$10' | '$20' | '$50' | null;
  salaryCap: number;
  slots: LineupSlot[];
  totalSalary: number;
  remainingSalary: number;

  setTier: (tier: '$1' | '$5' | '$10' | '$20' | '$50', cap: number) => void;
  addPlayer: (slot: LineupSlot) => void;
  removePlayer: (position: string) => void;
  reset: () => void;
}

const defaultSlots: LineupSlot[] = [
  { position: 'PG', playerId: null, playerName: null, price: 0 },
  { position: 'SG', playerId: null, playerName: null, price: 0 },
  { position: 'SF', playerId: null, playerName: null, price: 0 },
  { position: 'PF', playerId: null, playerName: null, price: 0 },
  { position: 'C',  playerId: null, playerName: null, price: 0 },
];

export const useLineupStore = create<LineupBuilderState>((set, get) => ({
  tier: null,
  salaryCap: 0,
  slots: defaultSlots,
  totalSalary: 0,
  remainingSalary: 0,

  setTier: (tier, cap) =>
    set({
      tier,
      salaryCap: cap,
      slots: defaultSlots,
      totalSalary: 0,
      remainingSalary: cap,
    }),

  addPlayer: (slot) => {
    const slots = get().slots.map((s) =>
      s.position === slot.position ? slot : s
    );
    const totalSalary = slots.reduce((sum, s) => sum + s.price, 0);
    set({ slots, totalSalary, remainingSalary: get().salaryCap - totalSalary });
  },

  removePlayer: (position) => {
    const slots = get().slots.map((s) =>
      s.position === position
        ? { position, playerId: null, playerName: null, price: 0 }
        : s
    );
    const totalSalary = slots.reduce((sum, s) => sum + s.price, 0);
    set({ slots, totalSalary, remainingSalary: get().salaryCap - totalSalary });
  },

  reset: () =>
    set({
      tier: null,
      salaryCap: 0,
      slots: defaultSlots,
      totalSalary: 0,
      remainingSalary: 0,
    }),
}));
