// =============================================================================
// BETTHAT — Settings › Payout Methods
// View and manage withdrawal methods. Stripe payouts are handled server-side.
//
// Bank-account linking here is deliberately a *manual-review* flow (nickname +
// bank name + last4s only) rather than a real Plaid/Stripe-Connect Link — this
// app has no processor/KYC-vendor integration wired up anywhere, and building
// one is a real infra/vendor decision, not a bug fix. What WAS a bug: this
// screen never actually read or wrote `payout_methods` at all — "Add Bank
// Account" was a dead-end Alert, and the empty state was hardcoded, so no
// user could ever add a payout method (confirmed: 0 rows in payout_methods
// in the live DB). That part is fixed here — real insert/list/remove against
// the table, which RLS already permitted for the owning user.
// =============================================================================

import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Rect } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import type { PayoutMethod } from '@/lib/database.types';

export default function PayoutMethodsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuthStore();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [nickname, setNickname] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [routingLast4, setRoutingLast4] = useState('');

  const { data: methods, isLoading } = useQuery({
    queryKey: ['payout_methods', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('payout_methods')
        .select('*')
        .eq('user_id', profile.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as PayoutMethod[];
    },
    enabled: !!profile?.id,
  });

  function resetForm() {
    setNickname(''); setBankName(''); setAccountLast4(''); setRoutingLast4(''); setShowForm(false);
  }

  const addMethod = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error('Not signed in');
      const last4 = accountLast4.trim();
      const routing = routingLast4.trim();
      if (!nickname.trim() || !bankName.trim()) throw new Error('Enter a nickname and bank name.');
      if (!/^\d{4}$/.test(last4)) throw new Error('Account last 4 digits must be exactly 4 numbers.');
      if (!/^\d{4}$/.test(routing)) throw new Error('Routing last 4 digits must be exactly 4 numbers.');
      const { error } = await supabase.from('payout_methods').insert({
        user_id: profile.id,
        method_type: 'bank_ach',
        display_name: nickname.trim(),
        bank_name: bankName.trim(),
        account_last4: last4,
        routing_last4: routing,
        is_verified: false,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payout_methods', profile?.id] });
      resetForm();
      Alert.alert(
        'Bank account added',
        'Your account is pending manual verification. This usually takes 1–2 business days before it can be used for withdrawals.',
      );
    },
    onError: (err: any) => Alert.alert('Could not add account', err?.message ?? 'Try again.'),
  });

  const removeMethod = useMutation({
    mutationFn: async (id: string) => {
      // Soft-delete (is_active = false) rather than a hard DELETE: a real
      // withdrawal_requests row may already reference this payout_method_id,
      // and we don't want to break that history.
      const { error } = await supabase.from('payout_methods').update({ is_active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payout_methods', profile?.id] }),
    onError: (err: any) => Alert.alert('Could not remove', err?.message ?? 'Try again.'),
  });

  function onAddBankAccount() {
    setShowForm(true);
  }

  function onAddDebitCard() {
    Alert.alert(
      'Debit Card',
      'Debit card payouts (Visa/Mastercard) will be available soon. Check back for updates.',
      [{ text: 'OK' }],
    );
  }

  function confirmRemove(m: PayoutMethod) {
    Alert.alert('Remove payout method', `Remove ${m.display_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMethod.mutate(m.id) },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, gap: 14 }}>
        <Pressable onPress={() => (showForm ? resetForm() : router.back())} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: theme.ink, letterSpacing: -0.3 }}>
          {showForm ? 'Add Bank Account' : 'Payout Methods'}
        </Text>
      </View>

      {showForm ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 60, gap: 16 }}>
          <FormField theme={theme} label="Nickname" value={nickname} onChangeText={setNickname} placeholder="e.g. Chase Checking" />
          <FormField theme={theme} label="Bank Name" value={bankName} onChangeText={setBankName} placeholder="e.g. Chase" />
          <FormField theme={theme} label="Account — last 4 digits" value={accountLast4} onChangeText={setAccountLast4} placeholder="1234" keyboardType="number-pad" maxLength={4} />
          <FormField theme={theme} label="Routing — last 4 digits" value={routingLast4} onChangeText={setRoutingLast4} placeholder="5678" keyboardType="number-pad" maxLength={4} />

          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, lineHeight: 18 }}>
            For your security we only store the last 4 digits here. This account will be pending manual verification before it can receive withdrawals.
          </Text>

          <Pressable
            onPress={() => addMethod.mutate()}
            disabled={addMethod.isPending}
            style={{ height: 52, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginTop: 8, opacity: addMethod.isPending ? 0.6 : 1 }}
          >
            {addMethod.isPending ? <ActivityIndicator color={theme.onAccent} /> : (
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.6, textTransform: 'uppercase' }}>
                Add Account
              </Text>
            )}
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 60, gap: 24 }}>
          {/* Info */}
          <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 16, marginTop: 6, gap: 6 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink }}>Withdrawals</Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.ink2, lineHeight: 20 }}>
              Winnings are paid out to your linked method within 1–3 business days. Minimum withdrawal is $10. Funds in active matchups cannot be withdrawn until results are finalized.
            </Text>
          </View>

          {/* Section: Linked methods */}
          <View style={{ gap: 14 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Linked Methods
            </Text>

            {isLoading ? (
              <View style={{ padding: 28, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
            ) : (methods ?? []).length === 0 ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, borderStyle: 'dashed', padding: 28, alignItems: 'center', gap: 8 }}>
                <Svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={theme.muted2} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
                  <Rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <Path d="M1 10h22" />
                </Svg>
                <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 }}>
                  No payout methods linked yet.{'\n'}Add a method below to withdraw winnings.
                </Text>
              </View>
            ) : (
              (methods ?? []).map((m) => (
                <Pressable
                  key={m.id}
                  onLongPress={() => confirmRemove(m)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 14,
                    backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline,
                    padding: 16,
                  }}
                >
                  <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}>
                    <BankIcon theme={theme} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{m.display_name}</Text>
                    <Text style={{ fontFamily: FONT.mono, fontSize: 11, color: theme.muted }}>
                      {m.bank_name ? `${m.bank_name} · ` : ''}····{m.account_last4}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: (m.is_verified ? theme.accent : theme.muted) + '22', borderWidth: 1, borderColor: (m.is_verified ? theme.accent : theme.muted) + '44' }}>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 8, color: m.is_verified ? theme.accent : theme.muted, letterSpacing: 0.6 }}>
                      {m.is_verified ? 'VERIFIED' : 'PENDING'}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
            {(methods ?? []).length > 0 ? (
              <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2, textAlign: 'center' }}>
                Hold a method to remove it.
              </Text>
            ) : null}
          </View>

          {/* Section: Add method */}
          <View style={{ gap: 14 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Add Method
            </Text>

            <MethodRow
              theme={theme}
              icon={<BankIcon theme={theme} />}
              title="Bank Account (ACH)"
              subtitle="1–3 business days · No fee"
              badge="RECOMMENDED"
              badgeColor={theme.accent}
              onPress={onAddBankAccount}
            />

            <MethodRow
              theme={theme}
              icon={<CardIcon theme={theme} />}
              title="Debit Card"
              subtitle="Instant payout · Coming soon"
              badge="SOON"
              badgeColor={theme.muted}
              onPress={onAddDebitCard}
            />
          </View>

          {/* KYC note */}
          <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 16, gap: 6 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.muted }}>Identity Verification Required</Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted2, lineHeight: 20 }}>
              You must verify your identity (KYC) before making your first withdrawal. This is required by US financial regulations.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function FormField({
  theme, label, value, onChangeText, placeholder, keyboardType, maxLength,
}: {
  theme: Theme; label: string; value: string; onChangeText: (v: string) => void; placeholder: string;
  keyboardType?: 'default' | 'number-pad'; maxLength?: number;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <TextInput
        style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline, borderRadius: 12, paddingHorizontal: 16, height: 48, fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}
        placeholder={placeholder}
        placeholderTextColor={theme.muted2}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
      />
    </View>
  );
}

function MethodRow({
  theme,
  icon,
  title,
  subtitle,
  badge,
  badgeColor,
  onPress,
}: {
  theme: Theme;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline,
        padding: 16, opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{title}</Text>
          {badge ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: badgeColor + '22', borderWidth: 1, borderColor: badgeColor + '44' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 8, color: badgeColor, letterSpacing: 0.8 }}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>{subtitle}</Text>
      </View>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.muted2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="m9 18 6-6-6-6" />
      </Svg>
    </Pressable>
  );
}

function BankIcon({ theme }: { theme: Theme }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Path d="M9 22V12h6v10" />
    </Svg>
  );
}

function CardIcon({ theme }: { theme: Theme }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <Path d="M1 10h22" />
    </Svg>
  );
}
