import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

const US_STATES = [
  { code: 'AZ', name: 'Arizona' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' },
  { code: 'MO', name: 'Missouri' }, { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'OH', name: 'Ohio' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'VA', name: 'Virginia' }, { code: 'WV', name: 'West Virginia' },
  { code: 'DC', name: 'Washington D.C.' },
];

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

  async function handleUsernameStep() {
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 3) {
      Alert.alert('Invalid Username', 'Username must be at least 3 characters (letters, numbers, underscores only).');
      return;
    }
    // Check uniqueness
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', clean)
      .maybeSingle();
    if (data) {
      Alert.alert('Username Taken', 'Please choose a different username.');
      return;
    }
    setUsername(clean);
    setStep('state');
  }

  async function handleStateStep() {
    if (!selectedState) {
      Alert.alert('Select State', 'Please select your state to continue.');
      return;
    }
    setStep('age');
  }

  async function handleAgeStep() {
    // Validate DOB format MM/DD/YYYY
    const dobRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = dob.match(dobRegex);
    if (!match) {
      Alert.alert('Invalid Date', 'Please enter date as MM/DD/YYYY.');
      return;
    }
    const birthDate = new Date(`${match[3]}-${match[1]}-${match[2]}`);
    const ageDiff = Date.now() - birthDate.getTime();
    const age = Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));
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
      const { data, error } = await supabase
        .from('profiles')
        .update({
          username,
          display_name: displayName.trim() || username,
          state: selectedState,
        })
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;

      setProfile(data);
      setStep('done');
      setTimeout(() => router.replace('/(tabs)/home'), 1500);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Step: Username ───────────────────────────────────────────
  if (step === 'username') {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-[#0a0a0a]"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-1 px-6 pt-20">
          <StepIndicator current={0} total={3} />
          <Text className="text-white text-3xl font-black mb-2 mt-8">
            Pick your username
          </Text>
          <Text className="text-[#71717A] mb-8">
            This is how other players will see you.
          </Text>

          <TextInput
            className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-4 text-white text-lg"
            placeholder="e.g. hoops_king21"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            value={username}
            onChangeText={setUsername}
          />
          <Text className="text-[#4B5563] text-xs mt-2">
            Letters, numbers, underscores. 3–20 characters.
          </Text>

          <TextInput
            className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-4 text-white text-lg mt-4"
            placeholder="Display name (optional)"
            placeholderTextColor="#4B5563"
            maxLength={30}
            value={displayName}
            onChangeText={setDisplayName}
          />

          <TouchableOpacity
            onPress={handleUsernameStep}
            className="mt-8 bg-[#F59E0B] rounded-xl py-4 items-center"
          >
            <Text className="text-black font-bold text-base">CONTINUE</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Step: State ─────────────────────────────────────────────
  if (step === 'state') {
    return (
      <View className="flex-1 bg-[#0a0a0a] px-6 pt-20">
        <StepIndicator current={1} total={3} />
        <Text className="text-white text-3xl font-black mb-2 mt-8">
          Where are you located?
        </Text>
        <Text className="text-[#71717A] mb-6">
          BETTHAT is available in these states. Select yours.
        </Text>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {US_STATES.map((s) => (
            <TouchableOpacity
              key={s.code}
              onPress={() => setSelectedState(s.code)}
              className="flex-row items-center justify-between py-3.5 border-b border-[#1E1E1E]"
            >
              <Text className="text-white text-base">{s.name}</Text>
              {selectedState === s.code && (
                <View className="w-5 h-5 rounded-full bg-[#F59E0B] items-center justify-center">
                  <Text className="text-black text-xs font-bold">✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          <View className="h-20" />
        </ScrollView>

        <TouchableOpacity
          onPress={handleStateStep}
          disabled={!selectedState}
          className="mb-8 bg-[#F59E0B] rounded-xl py-4 items-center"
          style={{ opacity: selectedState ? 1 : 0.4 }}
        >
          <Text className="text-black font-bold text-base">CONTINUE</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Step: Age ───────────────────────────────────────────────
  if (step === 'age') {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-[#0a0a0a]"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-1 px-6 pt-20">
          <StepIndicator current={2} total={3} />
          <Text className="text-white text-3xl font-black mb-2 mt-8">
            Verify your age
          </Text>
          <Text className="text-[#71717A] mb-8">
            You must be 18 or older to play. We take this seriously.
          </Text>

          <Text className="text-[#A1A1AA] text-xs font-medium mb-2 tracking-wider uppercase">
            Date of Birth
          </Text>
          <TextInput
            className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-4 text-white text-lg"
            placeholder="MM/DD/YYYY"
            placeholderTextColor="#4B5563"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            value={dob}
            onChangeText={setDob}
          />

          <TouchableOpacity
            onPress={handleAgeStep}
            disabled={loading}
            className="mt-8 bg-[#F59E0B] rounded-xl py-4 items-center"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text className="text-black font-bold text-base">CONFIRM & ENTER</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Step: Done ──────────────────────────────────────────────
  return (
    <View className="flex-1 bg-[#0a0a0a] items-center justify-center px-6">
      <Text className="text-6xl mb-4">🏀</Text>
      <Text className="text-white text-3xl font-black mb-2">You're in!</Text>
      <Text className="text-[#F59E0B] text-lg font-medium">Welcome to BETTHAT</Text>
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
          style={{ backgroundColor: i <= current ? '#F59E0B' : '#2E2E2E' }}
        />
      ))}
    </View>
  );
}
