import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { createPaymentIntent, EmailUnverifiedError } from '@/services/wallet';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';

// Stripe payment sheet is loaded lazily so that tests / web platforms which
// don't link the native module don't crash on import.
async function presentStripeSheet(clientSecret: string, publishableKey: string) {
  const StripeSdk = await import('@stripe/stripe-react-native');
  await StripeSdk.initStripe({ publishableKey, merchantIdentifier: 'merchant.com.betthat' });
  const init = await StripeSdk.initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'BETTHAT',
    returnURL: 'betthat://stripe-return',
  });
  if (init.error) throw new Error(init.error.message);
  const present = await StripeSdk.presentPaymentSheet();
  if (present.error) throw new Error(present.error.message);
}

const AMOUNTS = [10, 20, 50, 100, 200];

export default function DepositScreen() {
  const router = useRouter();
  const { wallet } = useAuthStore();
  const [amount, setAmount] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);

  const finalAmount = selectedPreset ?? parseFloat(amount);

  const deposit = useMutation({
    mutationFn: async () => {
      if (!finalAmount || Number.isNaN(finalAmount) || finalAmount < 1) {
        throw new Error('Enter a valid deposit amount (min $1).');
      }
      const intent = await createPaymentIntent(finalAmount);
      await presentStripeSheet(intent.client_secret, intent.publishable_key);
      // Wallet credit happens server-side via stripe-webhook → process_stripe_event.
      // Realtime sub in useAuth will update the displayed balance.
      return intent.payment_intent_id;
    },
    onSuccess: () => {
      Alert.alert(
        'Deposit submitted',
        'Your balance will update as soon as Stripe confirms the payment.',
        [{ text: 'OK', onPress: () => router.replace('/wallet') }],
      );
    },
    onError: (err: any) => {
      if (err instanceof EmailUnverifiedError) {
        Alert.alert(
          'Verify your email first',
          'Deposits require a verified email. Tap "Resend" to get a new confirmation link.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Resend',
              onPress: async () => {
                const userEmail = (await supabase.auth.getUser()).data.user?.email;
                if (!userEmail) return;
                await supabase.auth.resend({ type: 'signup', email: userEmail });
                Alert.alert('Sent', 'Check your inbox for the confirmation link.');
              },
            },
          ],
        );
        return;
      }
      Alert.alert('Could not deposit', err?.message ?? 'Try again.');
    },
  });

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-text-primary font-bold text-xl">Deposit</Text>
      </View>

      <View className="flex-1 px-5 pt-6">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-3 font-sans">
          Current Balance
        </Text>
        <Text className="text-text-primary font-mono text-3xl font-bold mb-8">
          {formatCurrency(Number(wallet?.balance ?? 0))}
        </Text>

        <Text className="text-text-primary font-bold mb-3">Select Amount</Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          {AMOUNTS.map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => { setSelectedPreset(a); setAmount(''); }}
              className="px-5 py-3 rounded-xl border"
              style={{
                borderColor: selectedPreset === a ? '#F5A524' : '#2A2A2E',
                backgroundColor: selectedPreset === a ? '#1a1200' : '#141416',
              }}
            >
              <Text className="font-mono font-bold" style={{ color: selectedPreset === a ? '#F5A524' : '#71717A' }}>
                ${a}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-text-muted text-sm mb-2 font-sans">Or enter custom amount</Text>
        <TextInput
          className="bg-surface border border-surface-border rounded-xl px-4 py-3 text-text-primary font-mono text-2xl text-center mb-8"
          placeholder="$0.00"
          placeholderTextColor="#71717A"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={(v) => { setAmount(v); setSelectedPreset(null); }}
        />

        <TouchableOpacity
          onPress={() => deposit.mutate()}
          disabled={deposit.isPending || (!selectedPreset && (!amount || Number.isNaN(parseFloat(amount))))}
          className="bg-brand rounded-xl py-4 items-center"
          style={{ opacity: !finalAmount || Number.isNaN(finalAmount) ? 0.4 : 1 }}
        >
          {deposit.isPending ? (
            <ActivityIndicator color="#0A0A0C" />
          ) : (
            <Text className="text-bg font-bold text-base">
              DEPOSIT {finalAmount && !Number.isNaN(finalAmount) ? formatCurrency(finalAmount) : ''}
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-text-muted text-xs text-center mt-4 font-sans">
          Deposits are processed securely via Stripe.
        </Text>
      </View>
    </SafeAreaView>
  );
}
