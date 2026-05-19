import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { OAuthButtons } from '@/components/OAuthButtons';

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill out all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }
    if (!termsAccepted) {
      Alert.alert('Terms Required', 'You must agree to the Terms of Service to create an account.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Email confirmation required — Supabase will email a confirmation link.
      // Real-money actions (lineup submit, withdrawal) are also gated on
      // auth.users.email_confirmed_at in the RPCs.
    });
    setLoading(false);

    if (error) {
      Alert.alert('Sign Up Failed', error.message);
      return;
    }
    // When email confirmation is required, signUp returns user but no session.
    // Without explicit feedback the user is stuck on this screen — root layout
    // can't navigate them anywhere because there's no session yet.
    if (!data.session) {
      Alert.alert(
        'Check your email',
        'We sent a confirmation link to verify your account. Tap it, then sign in.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }],
      );
    }
    // Terms are recorded onto profiles during onboarding (with current
    // app_config.terms_version) — see onboarding.tsx.
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 px-6 pt-16 pb-10">
          <TouchableOpacity onPress={() => router.back()} className="mb-8">
            <Text className="text-brand text-sm">← Back</Text>
          </TouchableOpacity>

          <Text className="text-text-primary text-3xl font-bold mb-2">Create Account</Text>
          <Text className="text-text-muted mb-6 font-sans">
            Join BETTHAT and start winning with your NBA knowledge.
          </Text>

          <OAuthButtons />

          <View className="flex-row items-center my-6">
            <View className="flex-1 h-px bg-surface-border" />
            <Text className="mx-3 text-text-muted text-xs font-sans">or with email</Text>
            <View className="flex-1 h-px bg-surface-border" />
          </View>

          <View className="gap-4">
            <View>
              <Text className="text-text-secondary text-xs font-medium mb-2 tracking-wider uppercase font-sans">
                Email
              </Text>
              <TextInput
                className="bg-surface border border-surface-border rounded-xl px-4 py-4 text-text-primary text-base font-sans"
                placeholder="you@example.com"
                placeholderTextColor="#71717A"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View>
              <Text className="text-text-secondary text-xs font-medium mb-2 tracking-wider uppercase font-sans">
                Password
              </Text>
              <TextInput
                className="bg-surface border border-surface-border rounded-xl px-4 py-4 text-text-primary text-base font-sans"
                placeholder="At least 8 characters"
                placeholderTextColor="#71717A"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <View>
              <Text className="text-text-secondary text-xs font-medium mb-2 tracking-wider uppercase font-sans">
                Confirm Password
              </Text>
              <TextInput
                className="bg-surface border border-surface-border rounded-xl px-4 py-4 text-text-primary text-base font-sans"
                placeholder="Re-enter password"
                placeholderTextColor="#71717A"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>

            {/* H-18: terms acceptance gate at signup. Captured to profile during onboarding. */}
            <TouchableOpacity
              onPress={() => setTermsAccepted(!termsAccepted)}
              className="flex-row items-center mt-2"
            >
              <View
                className="w-5 h-5 rounded border items-center justify-center mr-3"
                style={{
                  backgroundColor: termsAccepted ? '#F5A524' : 'transparent',
                  borderColor: termsAccepted ? '#F5A524' : '#2A2A2E',
                }}
              >
                {termsAccepted && <Text className="text-bg text-xs font-bold">✓</Text>}
              </View>
              <Text className="text-text-secondary flex-1 text-sm font-sans">
                I'm 18+ and agree to the Terms of Service and Privacy Policy.
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleSignup}
            disabled={loading}
            className="mt-8 bg-brand rounded-xl py-4 items-center"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <ActivityIndicator color="#0A0A0C" />
              : <Text className="text-bg font-bold text-base tracking-wide">CREATE ACCOUNT</Text>
            }
          </TouchableOpacity>

          <View className="flex-row justify-center mt-6">
            <Text className="text-text-muted font-sans">Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text className="text-brand font-medium">Sign in</Text>
              </TouchableOpacity>
            </Link>
          </View>

          <Text className="text-text-muted text-xs text-center mt-auto pt-8 font-sans">
            Must be 18+ in an eligible state. Real money wagering. Play responsibly.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
