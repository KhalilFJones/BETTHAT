import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import type { Profile, Wallet } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  wallet: Wallet | null;
  isLoading: boolean;
  isInitialized: boolean;

  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setWallet: (wallet: Wallet | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  signOut: () => Promise<void>;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  wallet: null,
  isLoading: true,
  isInitialized: false,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setProfile: (profile) => set({ profile }),
  setWallet: (wallet) => set({ wallet }),
  setLoading: (isLoading) => set({ isLoading }),
  setInitialized: (isInitialized) => set({ isInitialized }),

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, wallet: null });
  },

  reset: () =>
    set({
      session: null,
      user: null,
      profile: null,
      wallet: null,
      isLoading: false,
    }),
}));
