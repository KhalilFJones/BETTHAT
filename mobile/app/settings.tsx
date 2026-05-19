import { View, Text, ScrollView, TouchableOpacity, Switch, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { requestSelfExclusion } from '@/services/responsible_gaming';
import type { NotificationPreference, ResponsibleGamingConfig } from '@/lib/database.types';

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, user, signOut } = useAuthStore();

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

  // H-27: actually persist notification preferences
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

  // C-4: self-exclusion goes through the request_self_exclusion RPC.
  // The user cannot reverse this — it is one-way per RG compliance.
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
      'This will pause your account for 30 days. You will not be able to enter new matchups or sidebets. This action cannot be reversed by you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Self-Exclude',
          style: 'destructive',
          onPress: () => selfExclude.mutate(30),
        },
      ],
    );
  }

  if (!profile) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color="#F5A524" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-text-primary font-bold text-xl">Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
        <SectionHeader title="Account" />
        <SettingRow label="Username" value={`@${profile.username}`} />
        {/* H-28: profiles has no `email`; use auth.users.email */}
        <SettingRow label="Email" value={user?.email ?? '—'} />
        <SettingRow label="State" value={profile.state ?? '—'} />
        <SettingRow label="KYC Status" value={profile.kyc_status ?? 'unverified'} />

        <SectionHeader title="Notifications" />
        <ToggleRow
          label="Matchup Found"
          value={notifPrefs?.push_matchup_found ?? true}
          onToggle={(v) => updateNotifPref.mutate({ push_matchup_found: v })}
        />
        <ToggleRow
          label="Game Final"
          value={notifPrefs?.push_game_final ?? true}
          onToggle={(v) => updateNotifPref.mutate({ push_game_final: v })}
        />
        <ToggleRow
          label="Sidebet Received"
          value={notifPrefs?.push_sidebet_received ?? true}
          onToggle={(v) => updateNotifPref.mutate({ push_sidebet_received: v })}
        />
        <ToggleRow
          label="Sidebet Result"
          value={notifPrefs?.push_sidebet_result ?? true}
          onToggle={(v) => updateNotifPref.mutate({ push_sidebet_result: v })}
        />
        <ToggleRow
          label="Friend Activity"
          value={notifPrefs?.push_friend_request ?? true}
          onToggle={(v) => updateNotifPref.mutate({ push_friend_request: v })}
        />
        <ToggleRow
          label="Promotions"
          value={notifPrefs?.email_promotions ?? false}
          onToggle={(v) => updateNotifPref.mutate({ email_promotions: v })}
        />

        <SectionHeader title="Responsible Gaming" />
        <SettingRow
          label="Daily Deposit Limit"
          value={rgConfig?.daily_deposit_limit ? `$${rgConfig.daily_deposit_limit}` : 'Not set'}
        />
        {/* H-26: column is loss_limit_weekly, not weekly_spend_limit */}
        <SettingRow
          label="Weekly Loss Limit"
          value={rgConfig?.loss_limit_weekly ? `$${rgConfig.loss_limit_weekly}` : 'Not set'}
        />
        <TouchableOpacity
          // These detail screens (/settings/deposit-limit, /settings/payout-methods,
          // /terms, /privacy) aren't built yet — keep the entry points wired but
          // cast to silence expo-router 6 typed-route check.
          onPress={() => router.push('/settings/deposit-limit' as never)}
          className="flex-row items-center justify-between py-4 border-b border-surface-border"
        >
          <Text className="text-text-primary">Set Deposit Limit</Text>
          <Text className="text-text-muted">›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={confirmSelfExclude}
          disabled={selfExclude.isPending}
          className="flex-row items-center justify-between py-4 border-b border-surface-border"
        >
          <Text className="text-loss">Self-Exclude (30 days)</Text>
          <Text className="text-text-muted">›</Text>
        </TouchableOpacity>
        {(rgConfig?.is_permanently_excluded || (rgConfig?.self_excluded_until && new Date(rgConfig.self_excluded_until) > new Date())) && (
          <View className="bg-lossTint border border-loss rounded-xl px-4 py-3 mt-2">
            <Text className="text-loss text-sm font-sans">
              {rgConfig?.is_permanently_excluded
                ? 'Your account is permanently self-excluded.'
                : `Self-excluded until ${new Date(rgConfig!.self_excluded_until!).toLocaleDateString()}.`}
            </Text>
          </View>
        )}

        <SectionHeader title="Payments" />
        <TouchableOpacity
          onPress={() => router.push('/settings/payout-methods' as never)}
          className="flex-row items-center justify-between py-4 border-b border-surface-border"
        >
          <Text className="text-text-primary">Payout Methods</Text>
          <Text className="text-text-muted">›</Text>
        </TouchableOpacity>

        <SectionHeader title="Legal" />
        <TouchableOpacity
          onPress={() => router.push('/terms' as never)}
          className="flex-row items-center justify-between py-4 border-b border-surface-border"
        >
          <Text className="text-text-primary">Terms of Service</Text>
          <Text className="text-text-muted">›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push('/privacy' as never)}
          className="flex-row items-center justify-between py-4 border-b border-surface-border"
        >
          <Text className="text-text-primary">Privacy Policy</Text>
          <Text className="text-text-muted">›</Text>
        </TouchableOpacity>

        <View className="mt-8">
          <TouchableOpacity
            onPress={signOut}
            className="border border-loss rounded-xl py-3.5 items-center"
          >
            <Text className="text-loss font-bold">Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-text-muted text-xs tracking-widest uppercase mt-6 mb-2 font-sans">{title}</Text>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-4 border-b border-surface-border">
      <Text className="text-text-primary">{label}</Text>
      <Text className="text-text-muted font-sans">{value}</Text>
    </View>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center justify-between py-3.5 border-b border-surface-border">
      <Text className="text-text-primary">{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#2A2A2E', true: '#F5A524' }}
        thumbColor="#fff"
      />
    </View>
  );
}
