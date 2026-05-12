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
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0a0a0a]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 px-6 pt-16">
        <TouchableOpacity onPress={() => router.back()} className="mb-8">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>

        <Text className="text-white text-3xl font-black mb-2">Reset Password</Text>
        <Text className="text-[#71717A] mb-10">
          Enter your email and we'll send you a reset link.
        </Text>

        {sent ? (
          <View className="bg-[#141414] border border-[#22C55E] rounded-xl p-5">
            <Text className="text-[#22C55E] font-medium text-base mb-2">Email sent!</Text>
            <Text className="text-[#A1A1AA]">
              Check your inbox for the password reset link.
            </Text>
          </View>
        ) : (
          <>
            <View>
              <Text className="text-[#A1A1AA] text-xs font-medium mb-2 tracking-wider uppercase">
                Email
              </Text>
              <TextInput
                className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-4 text-white text-base"
                placeholder="you@example.com"
                placeholderTextColor="#4B5563"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <TouchableOpacity
              onPress={handleReset}
              disabled={loading}
              className="mt-6 bg-[#F59E0B] rounded-xl py-4 items-center"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text className="text-black font-bold text-base">SEND RESET LINK</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
