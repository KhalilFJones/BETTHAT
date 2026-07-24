// =============================================================================
// BETTHAT — Settings › Deposit & Loss Limits
// Responsible Gaming tool. User can set a daily deposit cap and a weekly
// deposit cap (there is no separate "loss" limit — both fields here cap
// deposits, not losses; the screen name is aspirational).
// Limits are enforced server-side via SECURITY DEFINER RPC set_deposit_limit.
// =============================================================================

import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { setDepositLimit } from '@/services/responsible_gaming';
import { useAuthStore } from '@/stores/auth.store';
import { FONT } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';

export default function DepositLimitScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuthStore();

  // Fetch current limits
  const { data: currentLimits, isLoading: limitsLoading } = useQuery({
    queryKey: ['rg-limits', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('responsible_gaming_settings' as never)
        .select('daily_deposit_limit, weekly_deposit_limit')
        .eq('user_id', profile!.id)
        .maybeSingle();
      return (data as any) ?? { daily_deposit_limit: null, weekly_deposit_limit: null };
    },
    enabled: !!profile?.id,
  });

  const [dailyDeposit, setDailyDeposit] = useState('');
  const [weeklyLoss, setWeeklyLoss] = useState('');
  const [saved, setSaved] = useState(false);

  // Prefill inputs from saved limits
  useEffect(() => {
    if (currentLimits?.daily_deposit_limit != null) setDailyDeposit(String(currentLimits.daily_deposit_limit));
    if (currentLimits?.weekly_deposit_limit != null) setWeeklyLoss(String(currentLimits.weekly_deposit_limit));
  }, [currentLimits]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const daily = dailyDeposit ? parseFloat(dailyDeposit) : null;
      const weekly = weeklyLoss ? parseFloat(weeklyLoss) : null;
      if (daily !== null && (isNaN(daily) || daily < 0)) throw new Error('Enter a valid daily deposit limit');
      if (weekly !== null && (isNaN(weekly) || weekly < 0)) throw new Error('Enter a valid weekly loss limit');
      await setDepositLimit({ daily, weekly });
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: Error) => {
      Alert.alert('Could not save limits', err.message);
    },
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, gap: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: theme.ink, letterSpacing: -0.3 }}>Deposit & Loss Limits</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 60, gap: 28 }}>
        {/* Info banner */}
        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 16, marginTop: 6, gap: 6 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink }}>Responsible Gaming</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.ink2, lineHeight: 20 }}>
            Set limits to control your spending. Once set, limits can only be decreased — not increased — for 24 hours. Limits are enforced automatically.
          </Text>
        </View>

        {/* Current limits display */}
        {!limitsLoading && currentLimits && (
          <View style={{ gap: 10 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Current Limits
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <LimitChip
                theme={theme}
                label="Daily Deposit"
                value={currentLimits.daily_deposit_limit ? `$${currentLimits.daily_deposit_limit}` : 'No limit'}
              />
              <LimitChip
                theme={theme}
                label="Weekly Deposit"
                value={currentLimits.weekly_deposit_limit ? `$${currentLimits.weekly_deposit_limit}` : 'No limit'}
              />
            </View>
          </View>
        )}

        {/* Daily deposit limit */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: theme.ink }}>Daily Deposit Limit</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, lineHeight: 18 }}>
            Maximum you can deposit per calendar day.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline, paddingHorizontal: 16, height: 52 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 18, color: theme.muted, marginRight: 6 }}>$</Text>
            <TextInput
              value={dailyDeposit}
              onChangeText={setDailyDeposit}
              keyboardType="decimal-pad"
              placeholder="e.g. 100"
              placeholderTextColor={theme.muted2}
              style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 18, color: theme.ink }}
            />
          </View>
        </View>

        {/* Weekly loss limit */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: theme.ink }}>Weekly Deposit Limit</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, lineHeight: 18 }}>
            Maximum you can deposit per 7-day window.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline, paddingHorizontal: 16, height: 52 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 18, color: theme.muted, marginRight: 6 }}>$</Text>
            <TextInput
              value={weeklyLoss}
              onChangeText={setWeeklyLoss}
              keyboardType="decimal-pad"
              placeholder="e.g. 250"
              placeholderTextColor={theme.muted2}
              style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 18, color: theme.ink }}
            />
          </View>
        </View>

        {/* Remove limits note */}
        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted2, lineHeight: 18 }}>
          To remove a limit, leave the field blank and save. A cooling-off period of 24 hours applies before limits can be raised.
        </Text>

        {/* Save button */}
        <Pressable
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          style={{
            height: 54, borderRadius: 999,
            backgroundColor: saved ? theme.gain : theme.accent,
            alignItems: 'center', justifyContent: 'center',
            opacity: saveMutation.isPending ? 0.6 : 1,
          }}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.onAccent, letterSpacing: 0.3 }}>
              {saved ? '✓ Saved' : 'Save Limits'}
            </Text>
          )}
        </Pressable>

        {saveMutation.isError ? (
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.danger, textAlign: 'center', letterSpacing: 0.3 }}>
            {(saveMutation.error as Error)?.message}
          </Text>
        ) : null}

        {/* Helpline */}
        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 16, gap: 4 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.muted }}>Need help?</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted2, lineHeight: 20 }}>
            National Problem Gambling Helpline: 1-800-522-4700 (24/7, free, confidential)
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LimitChip({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.hairline, padding: 12, gap: 4 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: theme.ink }}>{value}</Text>
    </View>
  );
}
