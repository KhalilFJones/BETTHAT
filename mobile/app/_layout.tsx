import '../global.css';
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { View, Text } from 'react-native';
import {
  registerForPushNotificationsAsync,
  savePushToken,
  deactivatePushToken,
  useNotificationRouting,
} from '@/lib/notifications';
import {
  useFonts,
  DMSans_300Light,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  DMSerifDisplay_400Regular,
  DMSerifDisplay_400Regular_Italic,
} from '@expo-google-fonts/dm-serif-display';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import { VT323_400Regular } from '@expo-google-fonts/vt323';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initSentry, captureError } from '@/lib/sentry';
import { FONT } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';

// Prevent auto-hide so we can show the splash until fonts are ready.
SplashScreen.preventAutoHideAsync().catch(() => {});
initSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: 1000,
    },
  },
  queryCache: new QueryCache({
    onError: (err, query) => captureError(err, { queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) =>
      captureError(err, { mutationKey: mutation.options.mutationKey }),
  }),
});

function RootLayoutNav() {
  const theme = useTheme();
  const { session, profile, isInitialized } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Set up notification tap → navigation routing.
  useNotificationRouting();

  // Register / deactivate push token on auth state change.
  useEffect(() => {
    if (!isInitialized) return;
    if (session && profile?.id) {
      registerForPushNotificationsAsync().then((token) => {
        if (token) savePushToken(profile.id, token);
      });
    } else if (!session && profile?.id) {
      deactivatePushToken(profile.id);
    }
  }, [session, profile?.id, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    // app/index.tsx is the splash screen and owns its own navigation — it
    // holds until the user taps, then routes by auth state itself. Without
    // this exemption the `!session && !inAuthGroup` branch below would fire
    // on every signed-out cold start and replace the splash with login
    // before it had a chance to render.
    // Cast: typedRoutes narrows useSegments() to the known 1-3 segment route
    // tuples, but the root index route really does yield [] at runtime.
    if ((segments as string[]).length === 0) return;

    const inAuthGroup = segments[0] === '(auth)';
    // reset-password and callback drive their own post-auth navigation (see
    // those two screens). Both legitimately establish/refresh a session while
    // still inside the (auth) group — a password-recovery link sets a session
    // via callback.tsx specifically so it can forward to reset-password, and
    // an already-onboarded existing user hitting either of those screens
    // would otherwise get raced: this effect would see `session &&
    // inAuthGroup` and force `router.replace('/(tabs)/home')` the instant the
    // session updates, stomping the screen's own navigation and making
    // password reset unreachable for any existing user. Skipping the bounce
    // here leaves both screens free to route themselves once they're done.
    const ownsNavigation = segments[1] === 'reset-password' || segments[1] === 'callback';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup && !ownsNavigation) {
      if (!profile?.username) {
        router.replace('/(auth)/onboarding');
      } else {
        router.replace('/(tabs)/home');
      }
    }
  }, [session, profile, isInitialized, segments]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      {/* Splash — dark art-directed screen, so it paints its own background
          rather than inheriting the (light-mode white) theme surface. */}
      <Stack.Screen name="index" options={{ animation: 'fade', contentStyle: { backgroundColor: '#0A0A0C' } }} />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="wallet" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="wallet/deposit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="wallet/withdraw" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="player/[id]" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="matchup/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="matchup/create" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="matchup/found/[id]" options={{ presentation: 'card', animation: 'fade' }} />
      <Stack.Screen name="settings" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="settings/deposit-limit" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="settings/payout-methods" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="terms" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="privacy" options={{ presentation: 'card', animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const theme = useTheme();

  // Holy Grail V2 type stack — DM Sans (UI), DM Serif Display (headlines),
  // IBM Plex Mono (every number, ticker, timestamp).
  const [fontsLoaded] = useFonts({
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSerifDisplay_400Regular,
    DMSerifDisplay_400Regular_Italic,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    VT323_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  // While fonts boot, show a theme-matched screen instead of the default
  // white flash. Avoids the 1-frame light-mode glitch on cold start.
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.mono, color: theme.muted, fontSize: 11, letterSpacing: 2 }}>BETTHAT</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />
            <RootLayoutNav />
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
