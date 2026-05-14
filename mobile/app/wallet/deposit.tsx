import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';

const AMOUNTS = [10, 20, 50, 100, 200];

export default function DepositScreen() {
  const router = useRouter();
  const { profile, wallet, setWallet } = useAuthStore();
  const [amount, setAmount] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);

  const finalAmount = selectedPreset ?? parseFloat(amount);

  const initiateDeposit = useMutation({
    mutationFn: async () => {
      if (!finalAmount || isNaN(finalAmount) || finalAmount < 1) {
        throw new Error('Enter a valid deposit amount (min $1).');
      }
      if (!profile?.id) throw new Error('Not authenticated.');

      // In production this would create a Stripe PaymentIntent via Edge Function
      // and use Stripe's native SDK to collect card info.
      // For now, create a pending transaction.
      const { data, error } = await supabase.functions.invoke('create-payment-intent', {
        body: { user_id: profile.id, amount: finalAmount },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data) => {
      // In production: open Stripe payment sheet with client_secret
      Alert.alert(
        '💳 Deposit',
        'Stripe payment sheet would open here.\n\nIn development mode your balance will be credited directly.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Simulate Deposit',
            onPress: async () => {
              // Dev-only: directly credit wallet
              const { data: w } = await supabase.from('wallets').select('balance, total_deposited').eq('user_id', profile!.id).single();
              const newBal = Number(w!.balance) + finalAmount;
              const newDeposited = Number(w!.total_deposited) + finalAmount;
              await supabase.from('wallets').update({ balance: newBal, total_deposited: newDeposited }).eq('user_id', profile!.id);
              await supabase.from('transactions').insert({
                user_id: profile!.id, type: 'deposit', amount: finalAmount,
                balance_after: newBal, description: 'Dev deposit', status: 'completed',
              });
              setWallet({ ...w, balance: newBal, total_deposited: newDeposited } as any);
              Alert.alert('✅ Deposited!', `${formatCurrency(finalAmount)} added to your wallet.`);
              router.replace('/wallet');
            },
          },
        ]
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
        <Text className="text-white font-black text-xl">Deposit</Text>
      </View>

      <View className="flex-1 px-5 pt-6">
        <Text className="text-[#71717A] text-xs uppercase tracking-wider mb-3">Current Balance</Text>
        <Text className="text-white text-3xl font-black mb-8">{formatCurrency(wallet?.balance ?? 0)}</Text>

        <Text className="text-white font-bold mb-3">Select Amount</Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          {AMOUNTS.map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => { setSelectedPreset(a); setAmount(''); }}
              className="px-5 py-3 rounded-xl border"
              style={{
                borderColor: selectedPreset === a ? '#F59E0B' : '#2E2E2E',
                backgroundColor: selectedPreset === a ? '#1a1200' : '#141414',
              }}
            >
              <Text className="font-bold" style={{ color: selectedPreset === a ? '#F59E0B' : '#71717A' }}>
                ${a}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-[#71717A] text-sm mb-2">Or enter custom amount</Text>
        <TextInput
          className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 text-white text-2xl font-black text-center mb-8"
          placeholder="$0.00"
          placeholderTextColor="#4B5563"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={(v) => { setAmount(v); setSelectedPreset(null); }}
        />

        <TouchableOpacity
          onPress={() => initiateDeposit.mutate()}
          disabled={initiateDeposit.isPending || (!selectedPreset && (!amount || isNaN(parseFloat(amount))))}
          className="bg-[#F59E0B] rounded-xl py-4 items-center"
          style={{ opacity: (!finalAmount || isNaN(finalAmount)) ? 0.4 : 1 }}
        >
          {initiateDeposit.isPending ? (
            <ActivityIndicator color="black" />
          ) : (
            <Text className="text-black font-black text-base">
              DEPOSIT {finalAmount && !isNaN(finalAmount) ? formatCurrency(finalAmount) : ''}
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-[#4B5563] text-xs text-center mt-4">
          Deposits are processed securely via Stripe.{'\n'}Funds are available instantly.
        </Text>
      </View>
    </SafeAreaView>
  );
}
