import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { useAuthStore } from '@/stores/auth.store';
import { createPaymentIntent, EmailUnverifiedError } from '@/services/wallet';
import { supabase } from '@/lib/supabase';
import { HG, FONT, fmtPrice } from '@/lib/holygrail';

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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, marginLeft: 12 }}>Deposit</Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 16 }}>
        {/* Balance display */}
        <View style={{ padding: 18, backgroundColor: HG.surface, borderRadius: 16, borderWidth: 1, borderColor: HG.hairline, marginBottom: 28 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
            Current Balance
          </Text>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 32, color: HG.ink, letterSpacing: -0.5 }}>
            {fmtPrice(wallet?.balance ?? 0)}
          </Text>
        </View>

        {/* Preset amounts */}
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 10 }}>
          Select Amount
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {AMOUNTS.map((a) => (
            <Pressable
              key={a}
              onPress={() => { setSelectedPreset(a); setAmount(''); }}
              style={{
                paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
                borderColor: selectedPreset === a ? HG.sky : HG.hairline,
                backgroundColor: selectedPreset === a ? HG.sky + '22' : HG.surface,
              }}
            >
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 14, color: selectedPreset === a ? HG.sky : HG.muted }}>
                ${a}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Custom amount */}
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
          Or enter custom amount
        </Text>
        <TextInput
          style={{ backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontFamily: FONT.monoBold, fontSize: 28, color: HG.ink, textAlign: 'center', marginBottom: 28 }}
          placeholder="$0.00"
          placeholderTextColor={HG.muted}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={(v) => { setAmount(v); setSelectedPreset(null); }}
        />

        {/* CTA */}
        <Pressable
          onPress={() => deposit.mutate()}
          disabled={deposit.isPending || (!selectedPreset && (!amount || Number.isNaN(parseFloat(amount))))}
          style={{ height: 54, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center', opacity: !finalAmount || Number.isNaN(finalAmount) ? 0.4 : 1 }}
        >
          {deposit.isPending ? (
            <ActivityIndicator color={HG.jet} />
          ) : (
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.8, textTransform: 'uppercase' }}>
              Deposit {finalAmount && !Number.isNaN(finalAmount) ? fmtPrice(finalAmount) : ''}
            </Text>
          )}
        </Pressable>

        <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: HG.muted, textAlign: 'center', marginTop: 14 }}>
          Deposits are processed securely via Stripe.
        </Text>
      </View>
    </SafeAreaView>
  );
}
