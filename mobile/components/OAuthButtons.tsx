import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { captureError } from '@/lib/sentry';

WebBrowser.maybeCompleteAuthSession();

type Provider = 'google' | 'apple' | 'facebook';

// The redirect URL Supabase will send the user back to after the OAuth round-
// trip. Must be allowlisted in Supabase Auth settings ("Additional Redirect
// URLs") for each environment.
const REDIRECT_URL = Linking.createURL('/auth/callback');

async function signInWithProvider(provider: Provider) {
  // Step 1: ask Supabase for the OAuth URL (we'll open it ourselves to keep
  // the flow inside the app via expo-web-browser).
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('No OAuth URL returned from Supabase');

  // Step 2: open the provider's consent page in a Safari/Chrome view.
  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
  if (result.type !== 'success' || !result.url) {
    return null; // user cancelled
  }

  // Step 3: complete the session from the deep-link. Two possible shapes
  // depending on Supabase auth flow type:
  //   - PKCE (default for new projects): ?code=<authcode>
  //   - Implicit: #access_token=...&refresh_token=...
  const callback = new URL(result.url);

  const code = callback.searchParams.get('code');
  if (code) {
    const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) throw exErr;
    return true;
  }

  const hash = callback.hash.startsWith('#') ? callback.hash.slice(1) : callback.hash;
  const search = new URLSearchParams(hash);
  const access_token  = search.get('access_token');
  const refresh_token = search.get('refresh_token');
  if (!access_token || !refresh_token) {
    throw new Error('OAuth callback missing tokens');
  }

  const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
  if (setErr) throw setErr;
  return true;
}

export function OAuthButtons() {
  const [loading, setLoading] = useState<Provider | null>(null);

  async function handlePress(provider: Provider) {
    setLoading(provider);
    try {
      await signInWithProvider(provider);
    } catch (err: any) {
      captureError(err, { where: `oauth-${provider}` });
      Alert.alert('Sign-in failed', err?.message ?? 'Try again.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <View className="gap-3">
      <ProviderButton
        provider="google"
        label="Continue with Google"
        loading={loading === 'google'}
        disabled={loading !== null}
        onPress={() => handlePress('google')}
        bg="#FFFFFF"
        fg="#0A0A0C"
        accentBg="#FFFFFF"
      />
      {Platform.OS === 'ios' && (
        <ProviderButton
          provider="apple"
          label="Continue with Apple"
          loading={loading === 'apple'}
          disabled={loading !== null}
          onPress={() => handlePress('apple')}
          bg="#000000"
          fg="#FFFFFF"
          accentBg="#000000"
        />
      )}
      <ProviderButton
        provider="facebook"
        label="Continue with Facebook"
        loading={loading === 'facebook'}
        disabled={loading !== null}
        onPress={() => handlePress('facebook')}
        bg="#1877F2"
        fg="#FFFFFF"
        accentBg="#1877F2"
      />
    </View>
  );
}

function ProviderButton({
  label, loading, disabled, onPress, bg, fg,
}: {
  provider: Provider;
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
  bg: string;
  fg: string;
  accentBg: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className="rounded-xl py-3.5 items-center justify-center flex-row"
      style={{ backgroundColor: bg, opacity: disabled ? 0.6 : 1 }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text className="font-bold text-base" style={{ color: fg }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}
