import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';

export default function PromosScreen() {
  const theme = useTheme();
  const { profile, wallet } = useAuthStore();
  const qc = useQueryClient();
  const [code, setCode] = useState('');

  const { data: promos, isLoading } = useQuery({
    queryKey: ['promos'],
    queryFn: async () => {
      const now = new Date();
      const { data } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('is_active', true)
        .order('expires_at', { ascending: true });
      return (data ?? []).filter((promo: any) => !promo.expires_at || new Date(promo.expires_at) > now);
    },
  });

  const { data: myRedemptions } = useQuery({
    queryKey: ['my-promos', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('user_promo_redemptions')
        .select('*, promo_codes(*)')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  const redeemMutation = useMutation({
    mutationFn: async (promoCode: string) => {
      if (!profile?.id) throw new Error('Not signed in');
      const trimmed = promoCode.trim().toUpperCase();
      const now = new Date();

      const { data: promo, error: findErr } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', trimmed)
        .eq('is_active', true)
        .maybeSingle();
      if (findErr || !promo || (promo.expires_at && new Date(promo.expires_at) <= now)) {
        throw new Error('Invalid or expired promo code');
      }

      const { count: redemptionCount, error: redemptionErr } = await supabase
        .from('user_promo_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('promo_code_id', promo.id);
      if (redemptionErr) throw redemptionErr;
      if ((redemptionCount ?? 0) > 0) throw new Error('You have already used this promo code');
      if (promo.max_uses != null && (promo.uses_count ?? 0) >= promo.max_uses) {
        throw new Error('This promo code has been fully redeemed');
      }
      if (promo.max_uses_per_user != null && (redemptionCount ?? 0) >= promo.max_uses_per_user) {
        throw new Error('You have already used this promo code');
      }

      const { error: insertErr } = await supabase
        .from('user_promo_redemptions')
        .insert({
          user_id: profile.id,
          promo_code_id: promo.id,
          status: 'active',
          credit_amount: promo.value,
        });
      if (insertErr) throw insertErr;

      const { error: updateErr } = await supabase
        .from('promo_codes')
        .update({ uses_count: (promo.uses_count ?? 0) + 1 })
        .eq('id', promo.id);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      setCode('');
      qc.invalidateQueries({ queryKey: ['my-promos'] });
      qc.invalidateQueries({ queryKey: ['promos'] });
      Alert.alert('Promo Applied! 🎉', 'Your promo credit has been added.');
    },
    onError: (err: any) => Alert.alert('Could not apply promo', err?.message ?? 'Try again'),
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader walletBalance={wallet?.balance} showBack />
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 32, color: theme.ink, letterSpacing: -0.5 }}>Promos</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, marginTop: 6 }}>
            Enter a promo code or claim one of today's offers.
          </Text>
        </View>

        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', gap: 10 }}>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Enter promo code"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            style={{
              flex: 1,
              height: 48,
              paddingHorizontal: 16,
              backgroundColor: theme.surfaceSunken,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.hairline,
              color: theme.ink,
              fontFamily: FONT.monoBold,
              fontSize: 13,
              letterSpacing: 1.2,
            }}
          />
          <Pressable
            onPress={() => code.trim() && redeemMutation.mutate(code)}
            disabled={!code.trim() || redeemMutation.isPending}
            style={{
              height: 48,
              paddingHorizontal: 20,
              borderRadius: 14,
              backgroundColor: theme.accent,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !code.trim() ? 0.5 : 1,
            }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.1 }}>APPLY</Text>
          </Pressable>
        </View>

        {(myRedemptions ?? []).length > 0 && (
          <View style={{ paddingHorizontal: 18, paddingTop: 24, paddingBottom: 8 }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.6, color: theme.muted, textTransform: 'uppercase', marginBottom: 12 }}>
              Your Promos
            </Text>
            <View style={{ gap: 10 }}>
              {(myRedemptions ?? []).map((r: any) => (
                <View
                  key={r.id}
                  style={{
                    padding: 16,
                    backgroundColor: theme.surface,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.hairline,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View>
                    <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: theme.ink }}>
                      {r.promo_codes?.code ?? '—'}
                    </Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, marginTop: 4 }}>
                      {r.promo_codes?.type?.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 18, color: theme.up }}>
                      {fmtPrice(r.credit_amount)}
                    </Text>
                    <View style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 999,
                      backgroundColor: r.status === 'active' ? theme.gainSoft : theme.surfaceRaised,
                    }}>
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 1, color: r.status === 'active' ? theme.up : theme.muted }}>
                        {r.status?.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ paddingHorizontal: 18, paddingTop: 24 }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.6, color: theme.muted, textTransform: 'uppercase', marginBottom: 12 }}>
            Available Offers
          </Text>
          {isLoading ? (
            <ActivityIndicator color={theme.accent} />
          ) : (promos ?? []).length === 0 ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>No active offers right now. Check back soon.</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {(promos ?? []).map((promo: any) => (
                <Pressable
                  key={promo.id}
                  onPress={() => redeemMutation.mutate(promo.code)}
                  disabled={redeemMutation.isPending}
                  style={{
                    padding: 18,
                    backgroundColor: theme.surface,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.hairline,
                    gap: 10,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: theme.accentSoft,
                      borderWidth: 1,
                      borderColor: theme.accentEdge,
                    }}>
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.accent, letterSpacing: 1.2 }}>{promo.code}</Text>
                    </View>
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 20, color: theme.ink }}>
                      {promo.value_type === 'percent' ? `${promo.value}% Match` : fmtPrice(promo.value)}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>
                    {promo.type === 'signup_bonus' ? 'New account bonus' :
                     promo.type === 'first_bet' ? 'First bet bonus' :
                     promo.type === 'deposit_match' ? `${promo.value}% deposit match (min ${fmtPrice(promo.min_deposit)})` :
                     'Promo credit'}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2 }}>
                      {promo.expires_at
                        ? `Expires ${new Date(promo.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                        : 'No expiration'}
                    </Text>
                    <View style={{
                      paddingHorizontal: 12,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: theme.accent,
                    }}>
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: theme.onAccent, letterSpacing: 0.8 }}>CLAIM</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
