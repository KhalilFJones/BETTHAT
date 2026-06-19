// =============================================================================
// BETTHAT — Settings (Holy Grail V2)
// Notifications, responsible gaming, payments, legal, support, account.
// =============================================================================

import { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Linking } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { requestSelfExclusion } from '@/services/responsible_gaming';
import { HG, FONT } from '@/lib/holygrail';
import type { NotificationPreference, ResponsibleGamingConfig } from '@/lib/database.types';

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, user, signOut } = useAuthStore();
  const [deletingAccount, setDeletingAccount] = useState(false);

  const { data: notifPrefs } = useQuery({
    queryKey: ['notif_prefs', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', profile.id)
        .maybeSingle();
      return data as NotificationPreference | null;
    },
    enabled: !!profile?.id,
  });

  const { data: rgConfig } = useQuery({
    queryKey: ['rg_config', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('responsible_gaming_settings')
        .select('*')
        .eq('user_id', profile.id)
        .maybeSingle();
      return data as ResponsibleGamingConfig | null;
    },
    enabled: !!profile?.id,
  });

  const updateNotifPref = useMutation({
    mutationFn: async (updates: Partial<NotificationPreference>) => {
      if (!profile?.id) throw new Error('not authenticated');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: profile.id, ...updates }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notif_prefs'] }),
    onError: (err: any) => Alert.alert('Could not save', err?.message ?? 'Try again.'),
  });

  const selfExclude = useMutation({
    mutationFn: async (days: number) => requestSelfExclusion(days),
    onSuccess: () => {
      Alert.alert('Done', 'Your account has been excluded. Contact support to discuss reinstatement after the exclusion period ends.');
      queryClient.invalidateQueries({ queryKey: ['rg_config'] });
    },
    onError: (err: any) => Alert.alert('Could not self-exclude', err?.message ?? 'Try again.'),
  });

  function confirmSelfExclude() {
    Alert.alert(
      'Self-Exclusion',
      'This will pause your account for 30 days. You will not be able to enter new matchups. This action cannot be reversed by you.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Self-Exclude', style: 'destructive', onPress: () => selfExclude.mutate(30) },
      ],
    );
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all data. Any remaining balance must be withdrawn first. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              // Mark account for deletion via RPC (server-side handles cleanup + wallet check)
              const { error } = await supabase.rpc('request_account_deletion' as any);
              if (error) throw error;
              await signOut();
            } catch (err: any) {
              setDeletingAccount(false);
              Alert.alert(
                'Cannot delete account',
                err?.message ?? 'Please withdraw your balance first, or contact support@betthat.com.',
              );
            }
          },
        },
      ],
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  const isExcluded = rgConfig?.is_permanently_excluded ||
    (rgConfig?.self_excluded_until && new Date(rgConfig.self_excluded_until) > new Date());

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, gap: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, letterSpacing: -0.4 }}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
        {/* Account */}
        <SectionLabel text="Account" />
        <InfoRow label="Username" value={`@${profile.username}`} />
        <InfoRow label="Email" value={user?.email ?? '—'} />
        <InfoRow label="State" value={profile.state ?? '—'} />
        <InfoRow label="KYC Status" value={profile.kyc_status ?? 'unverified'} />

        {/* Notifications */}
        <SectionLabel text="Notifications" />
        <ToggleRow label="Matchup Found" value={notifPrefs?.push_matchup_found ?? true} onToggle={(v) => updateNotifPref.mutate({ push_matchup_found: v })} />
        <ToggleRow label="Game Final" value={notifPrefs?.push_game_final ?? true} onToggle={(v) => updateNotifPref.mutate({ push_game_final: v })} />
        <ToggleRow label="Friend Activity" value={notifPrefs?.push_friend_request ?? true} onToggle={(v) => updateNotifPref.mutate({ push_friend_request: v })} />
        <ToggleRow label="Deposit & Withdrawal" value={notifPrefs?.push_deposit_confirmed ?? true} onToggle={(v) => updateNotifPref.mutate({ push_deposit_confirmed: v })} />
        <ToggleRow label="Promotions (email)" value={notifPrefs?.email_promotions ?? false} onToggle={(v) => updateNotifPref.mutate({ email_promotions: v })} />

        {/* Responsible Gaming */}
        <SectionLabel text="Responsible Gaming" />
        <InfoRow label="Daily Deposit Limit" value={rgConfig?.daily_deposit_limit ? `$${rgConfig.daily_deposit_limit}` : 'Not set'} />
        <InfoRow label="Weekly Loss Limit" value={rgConfig?.loss_limit_weekly ? `$${rgConfig.loss_limit_weekly}` : 'Not set'} />
        <NavRow label="Set Deposit Limit" onPress={() => router.push('/settings/deposit-limit' as never)} />
        <Pressable
          onPress={confirmSelfExclude}
          disabled={selfExclude.isPending || !!isExcluded}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderColor: HG.hairline, opacity: isExcluded ? 0.4 : 1 }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.down }}>
            Self-Exclude (30 days)
          </Text>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={HG.down} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m9 18 6-6-6-6" />
          </Svg>
        </Pressable>
        {isExcluded && (
          <View style={{ backgroundColor: HG.down + '18', borderWidth: 1, borderColor: HG.down + '44', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginVertical: 8 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.down, lineHeight: 20 }}>
              {rgConfig?.is_permanently_excluded
                ? 'Your account is permanently self-excluded.'
                : `Self-excluded until ${new Date(rgConfig!.self_excluded_until!).toLocaleDateString()}.`}
            </Text>
          </View>
        )}

        {/* Payments */}
        <SectionLabel text="Payments" />
        <NavRow label="Payout Methods" onPress={() => router.push('/settings/payout-methods' as never)} />

        {/* Legal */}
        <SectionLabel text="Legal" />
        <NavRow label="Terms of Service" onPress={() => router.push('/terms' as never)} />
        <NavRow label="Privacy Policy" onPress={() => router.push('/privacy' as never)} />

        {/* Support */}
        <SectionLabel text="Support" />
        <Pressable
          onPress={() => Linking.openURL('mailto:support@betthat.com?subject=App%20Support')}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderColor: HG.hairline }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>Email Support</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>support@betthat.com ›</Text>
        </Pressable>

        {/* About */}
        <SectionLabel text="About" />
        <InfoRow
          label="Version"
          value={Constants.expoConfig?.version ?? (Constants as any).manifest?.version ?? '1.0.0'}
        />
        <InfoRow
          label="Build"
          value={String(Constants.expoConfig?.ios?.buildNumber ?? (Constants as any).manifest?.ios?.buildNumber ?? '1')}
        />

        {/* Sign out */}
        <Pressable
          onPress={signOut}
          style={{ marginTop: 32, height: 52, borderRadius: 999, borderWidth: 1, borderColor: HG.hairline, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Sign Out
          </Text>
        </Pressable>

        {/* Delete account */}
        <Pressable
          onPress={confirmDeleteAccount}
          disabled={deletingAccount}
          style={{ marginTop: 12, height: 52, borderRadius: 999, borderWidth: 1, borderColor: HG.down + '55', alignItems: 'center', justifyContent: 'center' }}
        >
          {deletingAccount ? (
            <ActivityIndicator color={HG.down} size="small" />
          ) : (
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.down, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Delete Account
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function SectionLabel({ text }: { text: string }) {
  return (
    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 28, marginBottom: 4 }}>
      {text}
    </Text>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: HG.hairline }}>
      <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.ink }}>{label}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.muted }}>{value}</Text>
    </View>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderColor: HG.hairline }}
    >
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>{label}</Text>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <Path d="m9 18 6-6-6-6" />
      </Svg>
    </Pressable>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: HG.hairline }}>
      <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.ink }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: HG.hairline2, true: HG.sky + 'CC' }}
        thumbColor={HG.ink}
        ios_backgroundColor={HG.surface}
      />
    </View>
  );
}

