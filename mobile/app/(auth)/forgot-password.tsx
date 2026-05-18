import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

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
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 px-6 pt-16">
        <TouchableOpacity onPress={() => router.back()} className="mb-8">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>

        <Text className="text-text-primary text-3xl font-bold mb-2">Reset Password</Text>
        <Text className="text-text-muted mb-10 font-sans">
          Enter your email and we'll send you a reset link.
        </Text>

        {sent ? (
          <View className="bg-surface border border-win rounded-xl p-5">
            <Text className="text-win font-medium text-base mb-2">Email sent</Text>
            <Text className="text-text-secondary font-sans">
              Check your inbox for the password reset link.
            </Text>
          </View>
        ) : (
          <>
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
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <TouchableOpacity
              onPress={handleReset}
              disabled={loading}
              className="mt-6 bg-brand rounded-xl py-4 items-center"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? <ActivityIndicator color="#0A0A0C" />
                : <Text className="text-bg font-bold text-base">SEND RESET LINK</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
