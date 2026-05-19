// =============================================================================
// BETTHAT — Auth Callback (OAuth redirect + password reset deep link handler)
// This screen is the landing point for:
//   betthat://reset-password?access_token=...&type=recovery
//   betthat://callback?code=...  (OAuth PKCE)
// It processes the Supabase session tokens from the URL, then routes
// the user to their appropriate destination.
// =============================================================================

import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { HG, FONT } from '@/lib/holygrail';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    type?: string;
    code?: string;
    error?: string;
    error_description?: string;
  }>();

  const [message, setMessage] = useState('Signing you in…');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function handle() {
      // OAuth error (e.g. user denied)
      if (params.error) {
        setErrorMsg(params.error_description ?? params.error ?? 'Authentication failed.');
        setTimeout(() => router.replace('/(auth)/login'), 3000);
        return;
      }

      // Password recovery — access_token arrives as a hash fragment.
      // Supabase JS picks it up automatically via detectSessionInUrl in web,
      // but on React Native we receive it as a query param via the deep link.
      if (params.type === 'recovery' && params.access_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token ?? '',
        });
        if (error) {
          setErrorMsg(error.message);
          setTimeout(() => router.replace('/(auth)/login'), 3000);
          return;
        }
        // Session is set — route to password update screen.
        router.replace('/(auth)/reset-password' as any);
        return;
      }

      // PKCE OAuth code exchange
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) {
          setErrorMsg(error.message);
          setTimeout(() => router.replace('/(auth)/login'), 3000);
          return;
        }
        // onAuthStateChange in useAuth.ts will fire and route to home or onboarding.
        return;
      }

      // Nothing actionable — just redirect to login.
      router.replace('/(auth)/login');
    }

    handle();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
      {errorMsg ? (
        <>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.down, textAlign: 'center', letterSpacing: 0.4 }}>
            {errorMsg}
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted, textAlign: 'center' }}>
            Redirecting to sign in…
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color={HG.sky} />
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            {message}
          </Text>
        </>
      )}
    </View>
  );
}
