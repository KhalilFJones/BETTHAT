import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { requestWithdrawal } from '@/services/wallet';
import { formatCurrency } from '@/lib/utils';
import type { AppConfig, PayoutMethod } from '@/lib/database.types';

export default function WithdrawScreen() {
  const router = useRouter();
  const { profile, wallet } = useAuthStore();
  const [amount, setAmount] = useState('');
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);

  const { data: cfg } = useQuery({
    queryKey: ['app_config', 'min_withdrawal'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_config')
        .select('*')
        .eq('key', 'min_withdrawal')
        .maybeSingle();
      return data as AppConfig | null;
    },
    staleTime: 5 * 60_000,
  });
  const minWithdrawal = cfg?.value ? Number(cfg.value) : 10;

  const { data: payoutMethods } = useQuery({
    queryKey: ['payout_methods', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('payout_methods')
        .select('*')
        .eq('user_id', profile.id)
        .eq('is_active', true);
      return (data ?? []) as PayoutMethod[];
    },
    enabled: !!profile?.id,
  });

  const maxWithdraw = Number(wallet?.balance ?? 0);
  const withdrawAmount = parseFloat(amount);
  const isValid =
    !Number.isNaN(withdrawAmount) &&
    withdrawAmount >= minWithdrawal &&
    withdrawAmount <= maxWithdraw &&
    !!selectedMethodId;

  const withdraw = useMutation({
    mutationFn: async () => {
      if (!isValid || !selectedMethodId) throw new Error('Invalid withdrawal request');
      return requestWithdrawal(withdrawAmount, selectedMethodId);
    },
    onSuccess: () => {
      Alert.alert(
        'Withdrawal Requested',
        'Your withdrawal is processing. Funds arrive within 1–3 business days.',
        [{ text: 'Done', onPress: () => router.replace('/wallet') }],
      );
    },
    onError: (err: any) => Alert.alert('Could not withdraw', err?.message ?? 'Try again.'),
  });

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-text-primary font-bold text-xl">Withdraw</Text>
      </View>

      <View className="flex-1 px-5 pt-6">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2 font-sans">
          Available to Withdraw
        </Text>
        <Text className="text-text-primary font-mono text-3xl font-bold mb-8">
          {formatCurrency(maxWithdraw)}
        </Text>

        {Number(wallet?.escrow_balance ?? 0) > 0 && (
          <View className="bg-brandTint border border-warning rounded-xl px-4 py-3 mb-6">
            <Text className="text-warning text-sm font-sans">
              {formatCurrency(Number(wallet?.escrow_balance ?? 0))} is locked in active matchups
              and not available to withdraw.
            </Text>
          </View>
        )}

        <Text className="text-text-primary font-bold mb-2">
          Enter Amount (min ${minWithdrawal})
        </Text>
        <TextInput
          className="bg-surface border border-surface-border rounded-xl px-4 py-3 text-text-primary font-mono text-2xl text-center mb-3"
          placeholder="$0.00"
          placeholderTextColor="#71717A"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <TouchableOpacity onPress={() => setAmount(String(maxWithdraw))} className="items-center mb-6">
          <Text className="text-brand text-sm">Withdraw all ({formatCurrency(maxWithdraw)})</Text>
        </TouchableOpacity>

        <Text className="text-text-primary font-bold mb-2">Payout Method</Text>
        {(payoutMethods ?? []).length === 0 ? (
          <View className="bg-surface border border-surface-border rounded-xl p-4 mb-6">
            <Text className="text-text-muted text-sm font-sans">
              You haven't added a verified payout method yet. Add one in Settings.
            </Text>
          </View>
        ) : (
          <View className="mb-6">
            {(payoutMethods ?? []).map((m) => (
              <TouchableOpacity
                key={m.id}
                onPress={() => setSelectedMethodId(m.id)}
                disabled={!m.is_verified}
                className="border rounded-xl px-4 py-3 mb-2"
                style={{
                  borderColor: selectedMethodId === m.id ? '#F5A524' : '#2A2A2E',
                  backgroundColor: selectedMethodId === m.id ? '#1a1200' : '#141416',
                  opacity: m.is_verified ? 1 : 0.4,
                }}
              >
                <Text className="text-text-primary font-bold font-sans">{m.display_name}</Text>
                <Text className="text-text-muted text-xs font-sans">
                  {m.is_verified ? m.method_type.toUpperCase() : 'Unverified — contact support'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              'Confirm Withdrawal',
              `Withdraw ${formatCurrency(withdrawAmount)}?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', onPress: () => withdraw.mutate() },
              ],
            );
          }}
          disabled={withdraw.isPending || !isValid}
          className="bg-text-primary rounded-xl py-4 items-center"
          style={{ opacity: isValid ? 1 : 0.4 }}
        >
          {withdraw.isPending ? (
            <ActivityIndicator color="#0A0A0C" />
          ) : (
            <Text className="text-bg font-bold text-base">
              WITHDRAW {isValid ? formatCurrency(withdrawAmount) : ''}
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-text-muted text-xs text-center mt-4 font-sans">
          Withdrawals are processed via ACH or debit. 1–3 business days.
        </Text>
      </View>
    </SafeAreaView>
  );
}
