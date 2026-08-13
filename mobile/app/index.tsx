// =============================================================================
// BETTHAT — Splash / entry screen (Figma "Account – Select Alert type" frame)
// The first thing shown on a cold start: a full-bleed court photo under a
// top-down scrim (#333 → transparent at 67%), the brand mark, the "BETTHAT
// Fantasy" wordmark, and the co-branding disclaimer along the bottom.
//
// Tapping ANYWHERE continues into the app. Where that lands depends on auth
// state, exactly as this route used to redirect: signed out → login, signed
// in but un-onboarded → onboarding, otherwise → home. There is no auto-
// advance timer; the screen waits for the tap.
//
// NOTE: app/_layout.tsx deliberately skips its auth redirect while this route
// is showing (segments.length === 0) so the splash isn't bounced past.
// =============================================================================

import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useAuth } from '@/hooks/useAuth';
import { FONT } from '@/lib/holygrail';

// ── Art direction ───────────────────────────────────────────────────────────
// The hero court shot is a placeholder in the design export and there's no
// asset for it in the repo yet. Drop the photo at assets/splash-bg.jpg and
// swap the two lines below; until then the gradient fallback stands in.
//   const SPLASH_BG = require('../assets/splash-bg.jpg');
const SPLASH_BG: number | null = null;

// Same story for the brand mark — the export draws a grey #D9D9D9 puck
// reading "Logo", and assets/icon.png is still the Expo template placeholder.
// Point this at the real mark once it exists and render it inside the circle.
const LOGO_MARK: number | null = null;

export default function Index() {
  const { session, profile, isInitialized } = useAuth();
  const router = useRouter();
  const [continuing, setContinuing] = useState(false);

  const destination = !session
    ? '/(auth)/login'
    : !profile?.username
      ? '/(auth)/onboarding'
      : '/(tabs)/home';

  // A tap before auth has resolved isn't dropped — it's held until
  // `isInitialized` flips, then routed to the right place.
  useEffect(() => {
    if (continuing && isInitialized) router.replace(destination as any);
  }, [continuing, isInitialized, destination, router]);

  return (
    <Pressable
      onPress={() => setContinuing(true)}
      accessibilityRole="button"
      accessibilityLabel="Continue to BETTHAT"
      accessibilityHint="Tap anywhere to enter the app"
      style={{ flex: 1, backgroundColor: '#0A0A0C' }}
    >
      <StatusBar style="light" />

      {/* Background */}
      {SPLASH_BG ? (
        <Image source={SPLASH_BG} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Svg style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="splashFallback" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#141418" />
              <Stop offset="0.55" stopColor="#1E1A17" />
              <Stop offset="1" stopColor="#33241A" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#splashFallback)" />
        </Svg>
      )}

      {/* Scrim — #333 at the top fading out by 67%, per the export */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="splashScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#333333" stopOpacity={1} />
            <Stop offset="0.67" stopColor="#000000" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#splashScrim)" />
      </Svg>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Brand block — the export centres the 153px puck at ~49% of the
            screen with the wordmark 52px beneath it. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: 153, height: 153, borderRadius: 9999, backgroundColor: '#D9D9D9',
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}
          >
            {LOGO_MARK ? (
              <Image source={LOGO_MARK} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 48, lineHeight: 56, color: '#000000' }}>
                Logo
              </Text>
            )}
          </View>

          <Text style={{ marginTop: 52, fontSize: 16, lineHeight: 24, color: '#FFFFFF', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT.sansBold }}>BETTHAT</Text>
            <Text style={{ fontFamily: FONT.sans }}> Fantasy</Text>
          </Text>
        </View>

        {/* Co-branding disclaimer */}
        <Text
          style={{
            fontFamily: FONT.sans, fontSize: 9, lineHeight: 13,
            color: 'rgba(255, 255, 255, 0.85)', textAlign: 'center',
            paddingHorizontal: 40, paddingBottom: 20,
          }}
        >
          The BETTHAT Championship Hub is a co-branded experience. All contests are exclusively
          introduced by BETTHAT Gaming Inc. and offered on a licensed, regulated platform. BETTHAT
          and the BETTHAT logo are trademarks of BETTHAT Gaming Inc., used under license.
        </Text>
      </SafeAreaView>
    </Pressable>
  );
}
