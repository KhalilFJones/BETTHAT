import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import type { StateRestriction } from '@/lib/database.types';

type Step = 'username' | 'state' | 'age' | 'done';

export default function OnboardingScreen() {
  const router = useRouter();
  const { user, setProfile } = useAuthStore();

  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);

  // H-20: drive states from state_restrictions, not a hard-coded list.
  const { data: states } = useQuery({
    queryKey: ['allowed_states'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_restrictions')
        .select('*')
        .eq('is_allowed', true)
        .order('state_name');
      if (error) throw error;
      return (data ?? []) as StateRestriction[];
    },
    staleTime: 60 * 60_000,
  });

  async function handleUsernameStep() {
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 3) {
      Alert.alert('Invalid Username', 'Username must be at least 3 characters (letters, numbers, underscores only).');
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', clean)
      .maybeSingle();
    if (error) {
      Alert.alert('Error', 'Could not verify username availability. Please try again.');
      return;
    }
    if (data) {
      Alert.alert('Username Taken', 'Please choose a different username.');
      return;
    }
    setUsername(clean);
    setStep('state');
  }

  function handleStateStep() {
    if (!selectedState) {
      Alert.alert('Select State', 'Please select your state to continue.');
      return;
    }
    setStep('age');
  }

  async function handleAgeStep() {
    const match = dob.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
      Alert.alert('Invalid Date', 'Please enter date as MM/DD/YYYY.');
      return;
    }
    // H-21: construct in local time to avoid UTC midnight edge-case.
    const m = Number(match[1]);
    const d = Number(match[2]);
    const y = Number(match[3]);
    const birthDate = new Date(y, m - 1, d);

    // Calendar-based age (whole years on the user's local clock).
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDelta = today.getMonth() - birthDate.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
      age -= 1;
    }
    if (age < 18) {
      Alert.alert('Age Requirement', 'You must be 18 or older to play BETTHAT.');
      return;
    }
    await completeOnboarding(birthDate);
  }

  async function completeOnboarding(birthDate: Date) {
    if (!user) return;
    setLoading(true);
    try {
      // H-18: record terms acceptance + version on profile.
      const { data: terms } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'terms_version')
        .maybeSingle();

      const { data, error } = await supabase
        .from('profiles')
        .update({
          username,
          display_name: displayName.trim() || username,
          state: selectedState,
          date_of_birth: birthDate.toISOString().split('T')[0],
          terms_accepted_at: new Date().toISOString(),
          terms_version: (terms?.value as string | undefined) ?? '1.0',
          onboarding_step: 'complete',
        })
        .eq('id', user.id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('Profile not found');

      // H-18: capture IP + UA + terms version server-side. Fire-and-forget —
      // signup completes even if the audit insert fails (it's a write-side
      // ledger, not a blocker), but failures are logged via Sentry.
      supabase.functions.invoke('signup-audit', {
        body: { terms_version: (terms?.value as string | undefined) ?? '1.0' },
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[signup-audit] failed:', err);
      });

      setProfile(data);
      setStep('done');
      setTimeout(() => router.replace('/(tabs)/home'), 1500);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'username') {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-bg"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-1 px-6 pt-20">
          <StepIndicator current={0} total={3} />
          <Text className="text-text-primary text-3xl font-bold mb-2 mt-8">Pick your username</Text>
          <Text className="text-text-muted mb-8 font-sans">This is how other players will see you.</Text>

          <TextInput
            className="bg-surface border border-surface-border rounded-xl px-4 py-4 text-text-primary text-lg"
            placeholder="e.g. hoops_king21"
            placeholderTextColor="#71717A"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            value={username}
            onChangeText={setUsername}
          />
          <Text className="text-text-muted text-xs mt-2 font-sans">
            Letters, numbers, underscores. 3–20 characters.
          </Text>

          <TextInput
            className="bg-surface border border-surface-border rounded-xl px-4 py-4 text-text-primary text-lg mt-4"
            placeholder="Display name (optional)"
            placeholderTextColor="#71717A"
            maxLength={30}
            value={displayName}
            onChangeText={setDisplayName}
          />

          <TouchableOpacity
            onPress={handleUsernameStep}
            className="mt-8 bg-brand rounded-xl py-4 items-center"
          >
            <Text className="text-bg font-bold text-base">CONTINUE</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (step === 'state') {
    return (
      <View className="flex-1 bg-bg px-6 pt-20">
        <StepIndicator current={1} total={3} />
        <Text className="text-text-primary text-3xl font-bold mb-2 mt-8">Where are you located?</Text>
        <Text className="text-text-muted mb-6 font-sans">
          BETTHAT is available in these states. Select yours.
        </Text>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {(states ?? []).map((s) => (
            <TouchableOpacity
              key={s.state_code}
              onPress={() => setSelectedState(s.state_code)}
              className="flex-row items-center justify-between py-3.5 border-b border-surface-border"
            >
              <Text className="text-text-primary text-base">{s.state_name}</Text>
              {selectedState === s.state_code && (
                <View className="w-5 h-5 rounded-full bg-brand items-center justify-center">
                  <Text className="text-bg text-xs font-bold">✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          <View className="h-20" />
        </ScrollView>

        <TouchableOpacity
          onPress={handleStateStep}
          disabled={!selectedState}
          className="mb-8 bg-brand rounded-xl py-4 items-center"
          style={{ opacity: selectedState ? 1 : 0.4 }}
        >
          <Text className="text-bg font-bold text-base">CONTINUE</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'age') {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-bg"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-1 px-6 pt-20">
          <StepIndicator current={2} total={3} />
          <Text className="text-text-primary text-3xl font-bold mb-2 mt-8">Verify your age</Text>
          <Text className="text-text-muted mb-8 font-sans">
            You must be 18 or older to play. By continuing, you accept our Terms of Service and Privacy Policy.
          </Text>

          <Text className="text-text-secondary text-xs font-medium mb-2 tracking-wider uppercase font-sans">
            Date of Birth
          </Text>
          <TextInput
            className="bg-surface border border-surface-border rounded-xl px-4 py-4 text-text-primary text-lg font-mono"
            placeholder="MM/DD/YYYY"
            placeholderTextColor="#71717A"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            value={dob}
            onChangeText={setDob}
          />

          <TouchableOpacity
            onPress={handleAgeStep}
            disabled={loading}
            className="mt-8 bg-brand rounded-xl py-4 items-center"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <ActivityIndicator color="#0A0A0C" />
              : <Text className="text-bg font-bold text-base">CONFIRM & ENTER</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View className="flex-1 bg-bg items-center justify-center px-6">
      <Text className="text-text-primary text-3xl font-bold mb-2">You're in</Text>
      <Text className="text-brand text-lg font-medium font-sans">Welcome to BETTHAT</Text>
    </View>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View className="flex-row gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          className="h-1 flex-1 rounded-full"
          style={{ backgroundColor: i <= current ? '#F5A524' : '#2A2A2E' }}
        />
      ))}
    </View>
  );
}
