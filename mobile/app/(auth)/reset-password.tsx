// =============================================================================
// BETTHAT — Reset Password (Holy Grail V2)
// Landing screen after tapping password-reset email link.
// Supabase session is already set by callback.tsx before routing here.
// =============================================================================

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { FONT } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';

export default function ResetPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleUpdate() {
    if (password.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      Alert.alert('Could not update password', error.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.replace('/(tabs)/home'), 2000);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 48, gap: 0 }}>
          {/* Title */}
          <Text style={{ fontFamily: FONT.serif, fontSize: 38, color: theme.ink, letterSpacing: -0.8, marginBottom: 8 }}>
            New{'\n'}
            <Text style={{ fontFamily: FONT.serifItalic, color: theme.accent }}>Password</Text>
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.muted, marginBottom: 36, lineHeight: 20 }}>
            Choose a strong password for your BETTHAT account.
          </Text>

          {done ? (
            <View style={{ padding: 20, backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.accentEdge, alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 18, color: theme.accent }}>✓</Text>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>Password updated!</Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>Taking you home…</Text>
            </View>
          ) : (
            <>
              {/* New password */}
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8 }}>
                New Password
              </Text>
              <TextInput
                style={{
                  backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
                  borderRadius: 12, paddingHorizontal: 16, height: 52,
                  fontFamily: FONT.sans, fontSize: 15, color: theme.ink, marginBottom: 18,
                }}
                placeholder="At least 8 characters"
                placeholderTextColor={theme.muted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
              />

              {/* Confirm password */}
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8 }}>
                Confirm Password
              </Text>
              <TextInput
                style={{
                  backgroundColor: theme.surface, borderWidth: 1,
                  borderColor: confirm.length > 0 && confirm !== password ? theme.danger + '88' : theme.hairline,
                  borderRadius: 12, paddingHorizontal: 16, height: 52,
                  fontFamily: FONT.sans, fontSize: 15, color: theme.ink, marginBottom: 32,
                }}
                placeholder="Re-enter password"
                placeholderTextColor={theme.muted}
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
                autoCapitalize="none"
              />

              <Pressable
                onPress={handleUpdate}
                disabled={loading || !password || !confirm}
                style={{
                  height: 54, borderRadius: 999,
                  backgroundColor: theme.accent,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: loading || !password || !confirm ? 0.4 : 1,
                }}
              >
                {loading ? (
                  <ActivityIndicator color={theme.onAccent} />
                ) : (
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.8, textTransform: 'uppercase' }}>
                    Update Password
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
