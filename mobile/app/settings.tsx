import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import type { NotificationPreference, ResponsibleGamingConfig } from '@/lib/database.types';

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, signOut, user } = useAuthStore();

  const { data: notifPrefs, refetch: refetchPrefs } = useQuery({
    queryKey: ['notif_prefs', profile?.id],
    queryFn: async () => {
      // Notification preferences are stored as profile metadata
      // Return defaults if no separate table exists
      return {
        matchup_result: true, lineup_lock_reminder: true,
        sidebet_updates: true, friend_activity: true, promotions: false,
      } as NotificationPreference;
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
        .single();
      return data as ResponsibleGamingConfig | null;
    },
    enabled: !!profile?.id,
  });

  const updateNotifPref = useMutation({
    mutationFn: async (_updates: Partial<NotificationPreference>) => {
      // No-op until notification_preferences table is created in DB
      // Future: store in profiles.metadata or dedicated table
    },
  });

  const requestSelfExclusion = () => {
    Alert.alert(
      'Self-Exclusion',
      'This will pause your account for 30 days. You will not be able to enter new matchups or deposit funds. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Self-Exclude',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('responsible_gaming_settings')
              .upsert({
                user_id: profile!.id,
                self_exclusion_until: new Date(Date.now() + 30 * 86400000).toISOString(),
                is_self_excluded: true,
              });
            Alert.alert('Done', 'Your account has been paused for 30 days.');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>

        {/* ── Account ── */}
        <SectionHeader title="Account" />
        <SettingRow label="Username" value={`@${profile?.username}`} />
        <SettingRow label="Email" value={profile?.email ?? user?.email ?? '—'} />
        <SettingRow label="State" value={profile?.state ?? '—'} />
        <SettingRow label="KYC Status" value={profile?.kyc_status ?? 'unverified'} />

        {/* ── Notifications ── */}
        <SectionHeader title="Notifications" />
        <ToggleRow
          label="Matchup Results"
          value={notifPrefs?.matchup_result ?? true}
          onToggle={(v) => updateNotifPref.mutate({ matchup_result: v })}
        />
        <ToggleRow
          label="Lineup Lock Reminders"
          value={notifPrefs?.lineup_lock_reminder ?? true}
          onToggle={(v) => updateNotifPref.mutate({ lineup_lock_reminder: v })}
        />
        <ToggleRow
          label="Sidebet Updates"
          value={notifPrefs?.sidebet_updates ?? true}
          onToggle={(v) => updateNotifPref.mutate({ sidebet_updates: v })}
        />
        <ToggleRow
          label="Friend Activity"
          value={notifPrefs?.friend_activity ?? true}
          onToggle={(v) => updateNotifPref.mutate({ friend_activity: v })}
        />
        <ToggleRow
          label="Promotions"
          value={notifPrefs?.promotions ?? false}
          onToggle={(v) => updateNotifPref.mutate({ promotions: v })}
        />

        {/* ── Responsible Gaming ── */}
        <SectionHeader title="Responsible Gaming" />
        <SettingRow
          label="Daily Deposit Limit"
          value={rgConfig?.daily_deposit_limit ? `$${rgConfig.daily_deposit_limit}` : 'Not set'}
        />
        <SettingRow
          label="Weekly Loss Limit"
          value={rgConfig?.weekly_spend_limit ? `$${rgConfig.weekly_spend_limit}` : 'Not set'}
        />
        <TouchableOpacity
          onPress={() => router.push('/settings/deposit-limit')}
          className="flex-row items-center justify-between py-4 border-b border-[#1a1a1a]"
        >
          <Text className="text-white">Set Deposit Limit</Text>
          <Text className="text-[#71717A]">›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={requestSelfExclusion}
          className="flex-row items-center justify-between py-4 border-b border-[#1a1a1a]"
        >
          <Text className="text-[#EF4444]">Self-Exclude (30 days)</Text>
          <Text className="text-[#71717A]">›</Text>
        </TouchableOpacity>

        {/* ── Payments ── */}
        <SectionHeader title="Payments" />
        <TouchableOpacity
          onPress={() => router.push('/settings/payout-methods')}
          className="flex-row items-center justify-between py-4 border-b border-[#1a1a1a]"
        >
          <Text className="text-white">Payout Methods</Text>
          <Text className="text-[#71717A]">›</Text>
        </TouchableOpacity>

        {/* ── Legal ── */}
        <SectionHeader title="Legal" />
        <TouchableOpacity
          onPress={() => router.push('/terms')}
          className="flex-row items-center justify-between py-4 border-b border-[#1a1a1a]"
        >
          <Text className="text-white">Terms of Service</Text>
          <Text className="text-[#71717A]">›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push('/privacy')}
          className="flex-row items-center justify-between py-4 border-b border-[#1a1a1a]"
        >
          <Text className="text-white">Privacy Policy</Text>
          <Text className="text-[#71717A]">›</Text>
        </TouchableOpacity>

        {/* ── Sign Out ── */}
        <View className="mt-8">
          <TouchableOpacity
            onPress={signOut}
            className="border border-[#EF4444] rounded-xl py-3.5 items-center"
          >
            <Text className="text-[#EF4444] font-bold">Sign Out</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-[#71717A] text-xs tracking-widest uppercase mt-6 mb-2">{title}</Text>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-4 border-b border-[#1a1a1a]">
      <Text className="text-white">{label}</Text>
      <Text className="text-[#71717A]">{value}</Text>
    </View>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center justify-between py-3.5 border-b border-[#1a1a1a]">
      <Text className="text-white">{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#2E2E2E', true: '#F59E0B' }}
        thumbColor="#fff"
      />
    </View>
  );
}
