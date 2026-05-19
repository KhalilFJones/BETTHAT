// =============================================================================
// BETTHAT — Forgot Password (Holy Grail V2)
// Sends a password-reset email via Supabase Auth.
// =============================================================================

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { HG, FONT } from '@/lib/holygrail';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email) {
      Alert.alert('Error', 'Please enter your email.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'betthat://reset-password',
    });
    setLoading(false);
    if (error) Alert.alert('Error', error.message);
    else setSent(true);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16 }}>
          {/* Back */}
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginBottom: 36 }}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m15 18-6-6 6-6" />
            </Svg>
          </Pressable>

          <Text style={{ fontFamily: FONT.serif, fontSize: 38, color: HG.ink, letterSpacing: -0.8, marginBottom: 8 }}>
            Reset{'\n'}
            <Text style={{ fontFamily: FONT.serifItalic, color: HG.sky }}>Password</Text>
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.muted, marginBottom: 36, lineHeight: 20 }}>
            Enter your email and we'll send you a reset link.
          </Text>

          {sent ? (
            <View style={{ padding: 20, backgroundColor: HG.surface, borderRadius: 16, borderWidth: 1, borderColor: HG.skyEdge, gap: 8 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.sky }}>✓ Email sent</Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, lineHeight: 20 }}>
                Check your inbox for the password reset link. Tap it to set a new password.
              </Text>
            </View>
          ) : (
            <>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8 }}>
                Email
              </Text>
              <TextInput
                style={{ backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, borderRadius: 12, paddingHorizontal: 16, height: 52, fontFamily: FONT.sans, fontSize: 15, color: HG.ink, marginBottom: 24 }}
                placeholder="you@example.com"
                placeholderTextColor={HG.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              <Pressable
                onPress={handleReset}
                disabled={loading || !email}
                style={{ height: 54, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center', opacity: loading || !email ? 0.4 : 1 }}
              >
                {loading ? (
                  <ActivityIndicator color={HG.jet} />
                ) : (
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.8, textTransform: 'uppercase' }}>
                    Send Reset Link
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

