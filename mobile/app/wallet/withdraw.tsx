import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';

export default function WithdrawScreen() {
  const router = useRouter();
  const { profile, wallet, setWallet } = useAuthStore();
  const [amount, setAmount] = useState('');

  const maxWithdraw = wallet?.balance ?? 0;
  const withdrawAmount = parseFloat(amount);
  const isValid = !isNaN(withdrawAmount) && withdrawAmount >= 5 && withdrawAmount <= maxWithdraw;

  const requestWithdrawal = useMutation({
    mutationFn: async () => {
      if (!isValid || !profile?.id) throw new Error('Invalid withdrawal amount.');

      // Deduct from balance, create pending transaction
      const { data: w } = await supabase.from('wallets').select('balance, total_withdrawn').eq('user_id', profile.id).single();
      if (Number(w!.balance) < withdrawAmount) throw new Error('Insufficient balance.');

      const newBal = Number(w!.balance) - withdrawAmount;
      const newWithdrawn = Number(w!.total_withdrawn) + withdrawAmount;

      await supabase.from('wallets').update({ balance: newBal, total_withdrawn: newWithdrawn }).eq('user_id', profile.id);
      await supabase.from('transactions').insert({
        user_id: profile.id, type: 'withdrawal', amount: -withdrawAmount,
        balance_after: newBal,
        description: 'Withdrawal request — pending payout method setup',
        status: 'pending',
      });

      setWallet({ ...w, balance: newBal, total_withdrawn: newWithdrawn } as any);
    },
    onSuccess: () => {
      Alert.alert(
        '✅ Withdrawal Requested',
        'Your withdrawal is processing. Funds arrive within 1-3 business days via your payout method.',
        [{ text: 'Done', onPress: () => router.replace('/wallet') }]
      );
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">Withdraw</Text>
      </View>

      <View className="flex-1 px-5 pt-6">
        <Text className="text-[#71717A] text-xs uppercase tracking-wider mb-2">Available to Withdraw</Text>
        <Text className="text-white text-3xl font-black mb-8">{formatCurrency(maxWithdraw)}</Text>

        {(wallet?.escrow_balance ?? 0) > 0 && (
          <View className="bg-[#1a1200] border border-[#F59E0B33] rounded-xl px-4 py-3 mb-6">
            <Text className="text-[#F59E0B] text-sm">
              ⚠️ {formatCurrency(wallet!.escrow_balance)} is locked in active matchups and not available to withdraw.
            </Text>
          </View>
        )}

        <Text className="text-white font-bold mb-2">Enter Amount (min $5)</Text>
        <TextInput
          className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 text-white text-2xl font-black text-center mb-3"
          placeholder="$0.00"
          placeholderTextColor="#4B5563"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />

        <TouchableOpacity
          onPress={() => setAmount(String(maxWithdraw))}
          className="items-center mb-8"
        >
          <Text className="text-[#F59E0B] text-sm">Withdraw all ({formatCurrency(maxWithdraw)})</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              'Confirm Withdrawal',
              `Withdraw ${formatCurrency(withdrawAmount)} to your payout method?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', onPress: () => requestWithdrawal.mutate() },
              ]
            );
          }}
          disabled={requestWithdrawal.isPending || !isValid}
          className="bg-white rounded-xl py-4 items-center"
          style={{ opacity: isValid ? 1 : 0.4 }}
        >
          {requestWithdrawal.isPending ? (
            <ActivityIndicator color="black" />
          ) : (
            <Text className="text-black font-black text-base">
              WITHDRAW {isValid ? formatCurrency(withdrawAmount) : ''}
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-[#4B5563] text-xs text-center mt-4">
          Withdrawals are processed via ACH or debit.{'\n'}1-3 business days. Min $5 per withdrawal.
        </Text>
      </View>
    </SafeAreaView>
  );
}
