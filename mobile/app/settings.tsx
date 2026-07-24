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
import { FONT } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { useThemeStore, type ThemePreference } from '@/stores/theme.store';
import type { NotificationPreference, ResponsibleGamingConfig } from '@/lib/database.types';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, user, signOut } = useAuthStore();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);

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
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  const isExcluded = rgConfig?.is_permanently_excluded ||
    (rgConfig?.self_excluded_until && new Date(rgConfig.self_excluded_until) > new Date());

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, gap: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: theme.ink, letterSpacing: -0.4 }}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
        {/* Account */}
        <SectionLabel text="Account" theme={theme} />
        <InfoRow label="Username" value={`@${profile.username}`} theme={theme} />
        <InfoRow label="Email" value={user?.email ?? '—'} theme={theme} />
        <InfoRow label="State" value={profile.state ?? '—'} theme={theme} />
        <InfoRow label="KYC Status" value={profile.kyc_status ?? 'unverified'} theme={theme} />

        {/* Appearance */}
        <SectionLabel text="Appearance" theme={theme} />
        <AppearancePicker value={themePreference} onChange={setThemePreference} theme={theme} />

        {/* Notifications */}
        <SectionLabel text="Notifications" theme={theme} />
        <ToggleRow label="Matchup Found" value={notifPrefs?.push_matchup_found ?? true} onToggle={(v) => updateNotifPref.mutate({ push_matchup_found: v })} theme={theme} />
        <ToggleRow label="Game Final" value={notifPrefs?.push_game_final ?? true} onToggle={(v) => updateNotifPref.mutate({ push_game_final: v })} theme={theme} />
        <ToggleRow label="Friend Activity" value={notifPrefs?.push_friend_request ?? true} onToggle={(v) => updateNotifPref.mutate({ push_friend_request: v })} theme={theme} />
        <ToggleRow label="Deposit & Withdrawal" value={notifPrefs?.push_deposit_confirmed ?? true} onToggle={(v) => updateNotifPref.mutate({ push_deposit_confirmed: v })} theme={theme} />
        <ToggleRow label="Promotions (email)" value={notifPrefs?.email_promotions ?? false} onToggle={(v) => updateNotifPref.mutate({ email_promotions: v })} theme={theme} />

        {/* Responsible Gaming */}
        <SectionLabel text="Responsible Gaming" theme={theme} />
        <InfoRow label="Daily Deposit Limit" value={rgConfig?.daily_deposit_limit ? `$${rgConfig.daily_deposit_limit}` : 'Not set'} theme={theme} />
        <InfoRow label="Weekly Loss Limit" value={rgConfig?.loss_limit_weekly ? `$${rgConfig.loss_limit_weekly}` : 'Not set'} theme={theme} />
        <NavRow label="Set Deposit Limit" onPress={() => router.push('/settings/deposit-limit' as never)} theme={theme} />
        <Pressable
          onPress={confirmSelfExclude}
          disabled={selfExclude.isPending || !!isExcluded}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderColor: theme.hairline, opacity: isExcluded ? 0.4 : 1 }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.danger }}>
            Self-Exclude (30 days)
          </Text>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={theme.danger} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m9 18 6-6-6-6" />
          </Svg>
        </Pressable>
        {isExcluded && (
          <View style={{ backgroundColor: theme.danger + '18', borderWidth: 1, borderColor: theme.danger + '44', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginVertical: 8 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.danger, lineHeight: 20 }}>
              {rgConfig?.is_permanently_excluded
                ? 'Your account is permanently self-excluded.'
                : `Self-excluded until ${new Date(rgConfig!.self_excluded_until!).toLocaleDateString()}.`}
            </Text>
          </View>
        )}

        {/* Payments */}
        <SectionLabel text="Payments" theme={theme} />
        <NavRow label="Payout Methods" onPress={() => router.push('/settings/payout-methods' as never)} theme={theme} />

        {/* Legal */}
        <SectionLabel text="Legal" theme={theme} />
        <NavRow label="Terms of Service" onPress={() => router.push('/terms' as never)} theme={theme} />
        <NavRow label="Privacy Policy" onPress={() => router.push('/privacy' as never)} theme={theme} />

        {/* Support */}
        <SectionLabel text="Support" theme={theme} />
        <Pressable
          onPress={() => Linking.openURL('mailto:support@betthat.com?subject=App%20Support')}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderColor: theme.hairline }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>Email Support</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted }}>support@betthat.com ›</Text>
        </Pressable>

        {/* About */}
        <SectionLabel text="About" theme={theme} />
        <InfoRow
          label="Version"
          value={Constants.expoConfig?.version ?? (Constants as any).manifest?.version ?? '1.0.0'}
          theme={theme}
        />
        <InfoRow
          label="Build"
          value={String(Constants.expoConfig?.ios?.buildNumber ?? (Constants as any).manifest?.ios?.buildNumber ?? '1')}
          theme={theme}
        />

        {/* Sign out */}
        <Pressable
          onPress={signOut}
          style={{ marginTop: 32, height: 52, borderRadius: 999, borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Sign Out
          </Text>
        </Pressable>

        {/* Delete account */}
        <Pressable
          onPress={confirmDeleteAccount}
          disabled={deletingAccount}
          style={{ marginTop: 12, height: 52, borderRadius: 999, borderWidth: 1, borderColor: theme.danger + '55', alignItems: 'center', justifyContent: 'center' }}
        >
          {deletingAccount ? (
            <ActivityIndicator color={theme.danger} size="small" />
          ) : (
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.danger, letterSpacing: 1.4, textTransform: 'uppercase' }}>
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

function SectionLabel({ text, theme }: { text: string; theme: Theme }) {
  return (
    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 28, marginBottom: 4 }}>
      {text}
    </Text>
  );
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: theme.hairline }}>
      <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.ink }}>{label}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted }}>{value}</Text>
    </View>
  );
}

function NavRow({ label, onPress, theme }: { label: string; onPress: () => void; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderColor: theme.hairline }}
    >
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>{label}</Text>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <Path d="m9 18 6-6-6-6" />
      </Svg>
    </Pressable>
  );
}

// 3-way System / Light / Dark segmented picker. Fully theme-aware — the
// active segment uses the yellow accent fill with dark on-accent text, and
// re-themes immediately as the user taps between System/Light/Dark.
const APPEARANCE_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function AppearancePicker({ value, onChange, theme }: { value: ThemePreference; onChange: (v: ThemePreference) => void; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderRadius: 999, borderWidth: 1, borderColor: theme.hairline, padding: 3, marginBottom: 16 }}>
      {APPEARANCE_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center',
              backgroundColor: active ? theme.accent : 'transparent',
            }}
          >
            <Text style={{ fontFamily: active ? FONT.sansMedium : FONT.sans, fontSize: 13, color: active ? theme.onAccent : theme.muted }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({ label, value, onToggle, theme }: { label: string; value: boolean; onToggle: (v: boolean) => void; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.hairline }}>
      <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.ink }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: theme.hairline2, true: theme.accent + 'CC' }}
        thumbColor={theme.ink}
        ios_backgroundColor={theme.surface}
      />
    </View>
  );
}

