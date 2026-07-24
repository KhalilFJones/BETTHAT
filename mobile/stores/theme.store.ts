// =============================================================================
// BETTHAT — Theme preference store
// Persists the user's manual light/dark override (or "system" to follow the
// OS setting) across app restarts. Consumed by lib/theme.ts's useTheme() hook.
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'betthat-theme-preference',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
