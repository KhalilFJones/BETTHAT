import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { requestWithdrawal } from '@/services/wallet';
import { FONT, fmtPrice } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';
import type { AppConfig, PayoutMethod } from '@/lib/database.types';

export default function WithdrawScreen() {
  const theme = useTheme();
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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: theme.ink, letterSpacing: -0.4 }}>Withdraw</Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 8, gap: 0 }}>
        {/* Available balance */}
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 6 }}>
          Available to Withdraw
        </Text>
        <Text style={{ fontFamily: FONT.monoBold, fontSize: 36, color: theme.ink, marginBottom: 24 }}>
          {fmtPrice(maxWithdraw)}
        </Text>

        {/* Escrow notice */}
        {Number(wallet?.escrow_balance ?? 0) > 0 && (
          <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.danger + '55', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 20 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.ink2, lineHeight: 20 }}>
              {fmtPrice(Number(wallet?.escrow_balance ?? 0))} is locked in active matchups and not available to withdraw.
            </Text>
          </View>
        )}

        {/* Amount input */}
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8 }}>
          Amount (min ${minWithdrawal})
        </Text>
        <TextInput
          style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline, borderRadius: 12, paddingHorizontal: 16, height: 52, fontFamily: FONT.monoBold, fontSize: 24, color: theme.ink, textAlign: 'center', marginBottom: 10 }}
          placeholder="$0.00"
          placeholderTextColor={theme.muted}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <Pressable onPress={() => setAmount(String(maxWithdraw))} style={{ alignItems: 'center', marginBottom: 28 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.accent }}>
            Withdraw all ({fmtPrice(maxWithdraw)})
          </Text>
        </Pressable>

        {/* Payout methods */}
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 10 }}>
          Payout Method
        </Text>
        {(payoutMethods ?? []).length === 0 ? (
          <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline, borderRadius: 14, padding: 16, marginBottom: 24 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, lineHeight: 20 }}>
              You haven't added a verified payout method yet. Add one in Settings.
            </Text>
          </View>
        ) : (
          <View style={{ marginBottom: 24, gap: 8 }}>
            {(payoutMethods ?? []).map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setSelectedMethodId(m.id)}
                disabled={!m.is_verified}
                style={{
                  backgroundColor: selectedMethodId === m.id ? theme.accentSoft : theme.surface,
                  borderWidth: 1, borderColor: selectedMethodId === m.id ? theme.accent : theme.hairline,
                  borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
                  opacity: m.is_verified ? 1 : 0.4,
                }}
              >
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink, marginBottom: 2 }}>{m.display_name}</Text>
                <Text style={{ fontFamily: FONT.mono, fontSize: 11, color: theme.muted }}>
                  {m.is_verified ? m.method_type.toUpperCase() : 'Unverified — contact support'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* CTA */}
        <Pressable
          onPress={() => {
            Alert.alert(
              'Confirm Withdrawal',
              `Withdraw ${fmtPrice(withdrawAmount)}?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', onPress: () => withdraw.mutate() },
              ],
            );
          }}
          disabled={withdraw.isPending || !isValid}
          style={{ height: 54, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', opacity: isValid ? 1 : 0.4 }}
        >
          {withdraw.isPending ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.8, textTransform: 'uppercase' }}>
              Withdraw {isValid ? fmtPrice(withdrawAmount) : ''}
            </Text>
          )}
        </Pressable>

        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, textAlign: 'center', marginTop: 16, lineHeight: 18 }}>
          Withdrawals are processed via ACH or debit. 1–3 business days.
        </Text>
      </View>
    </SafeAreaView>
  );
}
