import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      Alert.alert('Login Failed', error.message);
    }
    // Navigation is handled by RootLayoutNav based on session
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
        <View className="flex-1 px-6 pt-20 pb-10">

          {/* Logo / Brand */}
          <View className="items-center mb-12">
            <Text className="text-5xl font-black text-[#F59E0B] tracking-widest">
              BETTHAT
            </Text>
            <Text className="text-[#71717A] text-sm mt-2 tracking-wide">
              SKILL-BASED NBA FANTASY
            </Text>
          </View>

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
                placeholder="••••••••"
                placeholderTextColor="#4B5563"
                secureTextEntry
                autoComplete="password"
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Link href="/(auth)/forgot-password" asChild>
              <TouchableOpacity className="items-end">
                <Text className="text-[#F59E0B] text-sm">Forgot password?</Text>
              </TouchableOpacity>
            </Link>
          </View>

          {/* CTA */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading}
            className="mt-8 bg-[#F59E0B] rounded-xl py-4 items-center"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text className="text-black font-bold text-base tracking-wide">SIGN IN</Text>
            }
          </TouchableOpacity>

          {/* Sign up link */}
          <View className="flex-row justify-center mt-6">
            <Text className="text-[#71717A]">Don't have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text className="text-[#F59E0B] font-medium">Sign up</Text>
              </TouchableOpacity>
            </Link>
          </View>

          {/* Legal */}
          <Text className="text-[#4B5563] text-xs text-center mt-auto pt-8">
            Must be 18+ and in an eligible state to play.{'\n'}
            Real money wagering. Play responsibly.
          </Text>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
