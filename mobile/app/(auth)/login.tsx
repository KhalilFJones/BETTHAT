// =============================================================================
// BETTHAT — Splash + Sign In (Holy Grail V2, Screens 01 + 02)
// Drifting tickers backdrop, BETTHAT wordmark, OAuth, email sign-in.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView, Animated, Easing,
} from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { HG, FONT } from '@/lib/holygrail';
import { OAuthButtons } from '@/components/OAuthButtons';

// Sample ticker handles drift across the splash backdrop. Stationary, low-opacity.
const DRIFT_HANDLES = [
  'JOKICN15', 'JAMESL23', 'CURRYS30', 'GILGES2', 'TATUMJ0',
  'EDWARA5', 'ANTETG34', 'WEMBAV1', 'DURANK7', 'EMBIIJ21',
  'HALIBT0', 'BRUNSJ11', 'LILLAD0', 'ADEBAB13', 'TOWNSK32',
  'BOOKED1', 'MORANJ12', 'CADEC2', 'BANCHP5', 'YOUNGT11',
];

export default function LoginScreen() {
  const [email, setEmail] = useState('demo@betthat.local');
  const [password, setPassword] = useState('BetThatDemo!2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) setError(err.message);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: HG.jet }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Drifting ticker backdrop */}
      <DriftingTickers />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between', padding: 24, paddingTop: 100, paddingBottom: 40 }}
      >
        <View>
          {/* Brand wordmark */}
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 36, color: HG.ink, letterSpacing: 6, textAlign: 'center' }}>
            BETTHAT
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center', marginTop: 8, fontStyle: 'italic' }}>
            Draft the market.
          </Text>
        </View>

        <View style={{ gap: 16, marginTop: 64 }}>
          {/* OAuth */}
          <OAuthButtons />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: HG.hairline }} />
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4 }}>OR EMAIL</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: HG.hairline }} />
          </View>

          {/* Email */}
          <View>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
              Email
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={HG.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={inputStyle}
            />
          </View>

          {/* Password */}
          <View>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
              Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={HG.muted}
              secureTextEntry
              autoComplete="password"
              style={inputStyle}
            />
          </View>

          {error ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.down }}>{error}</Text>
          ) : null}

          <Link href="/(auth)/forgot-password" asChild>
            <Pressable style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.sky }}>Forgot password?</Text>
            </Pressable>
          </Link>

          <Pressable
            onPress={handleLogin}
            disabled={loading}
            style={{
              height: 52, borderRadius: 999,
              backgroundColor: HG.sky,
              alignItems: 'center', justifyContent: 'center',
              opacity: loading ? 0.7 : 1,
              marginTop: 4,
            }}
          >
            {loading ? (
              <ActivityIndicator color={HG.jet} />
            ) : (
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                Sign in
              </Text>
            )}
          </Pressable>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 8 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted }}>New here?</Text>
            <Link href="/(auth)/signup" asChild>
              <Pressable>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.sky }}>Create account</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: HG.muted2, textAlign: 'center', lineHeight: 17, marginTop: 40 }}>
          Must be 18+ and in an eligible state to play.{'\n'}Real money wagering. Play responsibly.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// =============================================================================
// Drifting tickers — atmosphere only, no content lives in this layer.
// =============================================================================

function DriftingTickers() {
  // Generate 20 floating handles at random positions
  const handles = useRef(
    DRIFT_HANDLES.map((h, i) => ({
      handle: h,
      top: 60 + ((i * 73) % 720),
      left: ((i * 137) % 280) - 30,
      anim: new Animated.Value(0),
      duration: 30000 + (i * 1700) % 18000,
    }))
  ).current;

  useEffect(() => {
    handles.forEach((h) => {
      h.anim.setValue(0);
      Animated.loop(
        Animated.timing(h.anim, {
          toValue: 1,
          duration: h.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {/* Subtle radial glow upper-right */}
      <View
        style={{
          position: 'absolute', top: -200, right: -150,
          width: 500, height: 500, borderRadius: 999,
          backgroundColor: HG.sky, opacity: 0.05,
        }}
      />
      {handles.map((h, i) => {
        const tx = h.anim.interpolate({ inputRange: [0, 1], outputRange: [0, 90] });
        return (
          <Animated.View
            key={i}
            style={{ position: 'absolute', top: h.top, left: h.left, transform: [{ translateX: tx }], opacity: 0.13 }}
          >
            {/* V2.1 Amendment 1: Splash drifting tickers use the LED hero font */}
            <Text style={{ fontFamily: FONT.hero, fontSize: 20, color: HG.sky, letterSpacing: 2 }}>
              {h.handle}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const inputStyle = {
  backgroundColor: HG.inputBg,
  borderRadius: 14,
  paddingHorizontal: 16,
  paddingVertical: 14,
  fontFamily: FONT.sans,
  fontSize: 15,
  color: HG.ink,
  borderWidth: 1,
  borderColor: HG.hairline,
};
