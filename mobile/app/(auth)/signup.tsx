import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (error) {
      Alert.alert('Sign Up Failed', error.message);
    } else {
      // RootLayoutNav will detect new session and route to onboarding
      // (profile.username will be null for new users)
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0a0a0a]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 px-6 pt-16 pb-10">

          {/* Header */}
          <TouchableOpacity onPress={() => router.back()} className="mb-8">
            <Text className="text-[#F59E0B] text-sm">← Back</Text>
          </TouchableOpacity>

          <Text className="text-white text-3xl font-black mb-2">Create Account</Text>
          <Text className="text-[#71717A] mb-10">
            Join BETTHAT and start winning with your NBA knowledge.
          </Text>

          {/* Form */}
          <View className="gap-4">
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
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View>
              <Text className="text-[#A1A1AA] text-xs font-medium mb-2 tracking-wider uppercase">
                Password
              </Text>
              <TextInput
                className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-4 text-white text-base"
                placeholder="At least 8 characters"
                placeholderTextColor="#4B5563"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <View>
              <Text className="text-[#A1A1AA] text-xs font-medium mb-2 tracking-wider uppercase">
                Confirm Password
              </Text>
              <TextInput
                className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-4 text-white text-base"
                placeholder="Re-enter password"
                placeholderTextColor="#4B5563"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>
          </View>

          {/* CTA */}
          <TouchableOpacity
            onPress={handleSignup}
            disabled={loading}
            className="mt-8 bg-[#F59E0B] rounded-xl py-4 items-center"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text className="text-black font-bold text-base tracking-wide">CREATE ACCOUNT</Text>
            }
          </TouchableOpacity>

          {/* Sign in link */}
          <View className="flex-row justify-center mt-6">
            <Text className="text-[#71717A]">Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text className="text-[#F59E0B] font-medium">Sign in</Text>
              </TouchableOpacity>
            </Link>
          </View>

          {/* Legal */}
          <Text className="text-[#4B5563] text-xs text-center mt-auto pt-8">
            By creating an account you agree to our Terms of Service.{'\n'}
            Must be 18+ in an eligible state. Real money wagering.
          </Text>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
