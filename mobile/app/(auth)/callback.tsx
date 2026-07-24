// =============================================================================
// BETTHAT — Auth Callback (OAuth redirect + password reset deep link handler)
// This screen is the landing point for:
//   betthat://reset-password?access_token=...&type=recovery
//   betthat://callback?code=...  (OAuth PKCE)
// It processes the Supabase session tokens from the URL, then routes
// the user to their appropriate destination.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { FONT } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';

// Supabase's hosted /auth/v1/verify redirect (which every email-link flow,
// including password recovery, goes through) appends the session tokens as a
// URL HASH fragment (`#access_token=...&type=recovery`), not a query string —
// the same shape components/OAuthButtons.tsx already has to parse for the
// OAuth round-trip. expo-router's useLocalSearchParams only reflects the
// query string, so on a real device this screen could read `undefined` for
// every token even though they're right there in the URL. Fall back to
// parsing the raw incoming URL's fragment so this works regardless of which
// shape Supabase actually sends.
function parseHashParams(url: string | null): Record<string, string> {
  if (!url) return {};
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return {};
  const hash = url.slice(hashIdx + 1);
  const out: Record<string, string> = {};
  for (const pair of hash.split('&')) {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return out;
}

export default function AuthCallbackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    type?: string;
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const rawUrl = Linking.useURL();

  const [message, setMessage] = useState('Signing you in…');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // `Linking.useURL()` can resolve asynchronously (null on the very first
  // render, then the real URL a tick later) — this guard stops the effect
  // from re-running `handle()` a second time once it has already acted on a
  // URL (setSession / exchangeCodeForSession are not safely re-callable with
  // the same one-time token).
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    async function handle() {
      const hashParams = parseHashParams(rawUrl);
      const accessToken = params.access_token ?? hashParams.access_token;
      const refreshToken = params.refresh_token ?? hashParams.refresh_token;
      const type = params.type ?? hashParams.type;
      const oauthError = params.error ?? hashParams.error;
      const oauthErrorDescription = params.error_description ?? hashParams.error_description;
      const hasActionableParam = !!(oauthError || (type === 'recovery' && accessToken) || params.code);

      // `Linking.useURL()` resolves asynchronously and can still be null on
      // the very first render. If the query string alone has nothing
      // actionable, don't jump to "nothing here, back to login" yet — wait
      // for rawUrl to resolve (the effect re-runs when it changes) in case
      // the tokens are sitting in a hash fragment we haven't seen yet.
      if (!hasActionableParam && rawUrl === null) {
        return;
      }

      handledRef.current = true;

      // OAuth error (e.g. user denied)
      if (oauthError) {
        setErrorMsg(oauthErrorDescription ?? oauthError ?? 'Authentication failed.');
        setTimeout(() => router.replace('/(auth)/login'), 3000);
        return;
      }

      // Password recovery — access_token can arrive as either a query param or
      // a hash fragment depending on the Supabase redirect shape; both are
      // checked above.
      if (type === 'recovery' && accessToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken ?? '',
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
        const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) {
          setErrorMsg(error.message);
          setTimeout(() => router.replace('/(auth)/login'), 3000);
          return;
        }
        // Navigate ourselves instead of relying on the root layout's ambient
        // session-based redirect (as a prior version of this code did): that
        // redirect must also leave reset-password/callback navigation alone
        // to avoid racing the recovery flow (see app/_layout.tsx), so it can
        // no longer be trusted to drive this screen's exit. Read the profile
        // directly rather than off the shared auth store, since useAuth.ts's
        // own fetchUserData() triggered by this same sign-in may not have
        // resolved yet.
        const uid = data.user?.id;
        if (!uid) {
          router.replace('/(auth)/login');
          return;
        }
        const { data: prof } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', uid)
          .maybeSingle();
        router.replace(prof?.username ? '/(tabs)/home' : '/(auth)/onboarding');
        return;
      }

      // Nothing actionable — just redirect to login.
      router.replace('/(auth)/login');
    }

    handle();
  }, [rawUrl]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
      {errorMsg ? (
        <>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: theme.danger, textAlign: 'center', letterSpacing: 0.4 }}>
            {errorMsg}
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, textAlign: 'center' }}>
            Redirecting to sign in…
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color={theme.accent} />
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            {message}
          </Text>
        </>
      )}
    </View>
  );
}
