import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency, RANK_COLORS } from '@/lib/utils';
import type { Achievement, UserAchievement } from '@/lib/database.types';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, wallet, signOut } = useAuthStore();

  const { data: achievements } = useQuery({
    queryKey: ['user_achievements', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return { earned: [], all: [] };
      const [allRes, earnedRes] = await Promise.all([
        supabase.from('achievements').select('*'),
        supabase.from('user_achievements').select('*').eq('user_id', profile.id),
      ]);
      return {
        all: (allRes.data ?? []) as Achievement[],
        earned: (earnedRes.data ?? []) as UserAchievement[],
      };
    },
    enabled: !!profile?.id,
  });

  const earnedIds = new Set(achievements?.earned.map((a) => a.achievement_id));
  const rankColor = RANK_COLORS[profile?.rank_tier ?? 'Bronze'];

  if (!profile) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0a0a] items-center justify-center">
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* ── Header ── */}
        <View className="px-5 pt-4 pb-6">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-2xl font-black">Profile</Text>
            <TouchableOpacity onPress={() => router.push('/settings')}>
              <Text className="text-[#71717A] text-2xl">⚙️</Text>
            </TouchableOpacity>
          </View>

          {/* Avatar + name */}
          <View className="items-center mb-6">
            <View className="w-20 h-20 rounded-full bg-[#1E1E1E] border-2 items-center justify-center mb-3"
              style={{ borderColor: rankColor }}>
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} className="w-full h-full rounded-full" />
              ) : (
                <Text className="text-4xl">{profile.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
              )}
            </View>

            <Text className="text-white text-xl font-black">
              {profile.display_name ?? profile.username}
            </Text>
            <Text className="text-[#71717A] text-sm">@{profile.username}</Text>

            {/* Rank badge */}
            <View
              className="mt-2 px-3 py-1 rounded-full border"
              style={{ borderColor: rankColor }}
            >
              <Text className="text-xs font-bold" style={{ color: rankColor }}>
                🏅 {profile.rank_tier}
              </Text>
            </View>
          </View>

          {/* Stats grid */}
          <View className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5">
            <View className="flex-row justify-between mb-4">
              <StatCell label="Wins" value={String(profile.total_wins)} color="#22C55E" />
              <StatCell label="Losses" value={String(profile.total_losses)} color="#EF4444" />
              <StatCell label="Win Rate" value={`${profile.win_rate ?? 0}%`} color="#F59E0B" />
            </View>
            <View className="flex-row justify-between">
              <StatCell label="Earnings" value={formatCurrency(profile.total_earnings)} color="#A855F7" />
              <StatCell label="Balance" value={formatCurrency(wallet?.balance ?? 0)} color="#3B82F6" />
              <StatCell label="Escrow" value={formatCurrency(wallet?.escrow_balance ?? 0)} color="#71717A" />
            </View>
          </View>
        </View>

        {/* ── Actions ── */}
        <View className="px-5 mb-6">
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => router.push('/wallet')}
              className="flex-1 bg-[#141414] border border-[#2E2E2E] rounded-xl py-3 items-center"
            >
              <Text className="text-xl mb-1">💳</Text>
              <Text className="text-white text-xs font-bold">Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/friends')}
              className="flex-1 bg-[#141414] border border-[#2E2E2E] rounded-xl py-3 items-center"
            >
              <Text className="text-xl mb-1">👥</Text>
              <Text className="text-white text-xs font-bold">Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/leaderboard')}
              className="flex-1 bg-[#141414] border border-[#2E2E2E] rounded-xl py-3 items-center"
            >
              <Text className="text-xl mb-1">🏆</Text>
              <Text className="text-white text-xs font-bold">Leaderboard</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Achievements ── */}
        <View className="px-5 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white font-black text-lg">Achievements</Text>
            <Text className="text-[#71717A] text-sm">
              {earnedIds.size} / {achievements?.all.length ?? 0}
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-3">
            {achievements?.all.slice(0, 9).map((ach) => {
              const isEarned = earnedIds.has(ach.id);
              return (
                <View
                  key={ach.id}
                  className="w-[30%] bg-[#141414] border rounded-xl p-3 items-center"
                  style={{ borderColor: isEarned ? '#F59E0B' : '#2E2E2E', opacity: isEarned ? 1 : 0.4 }}
                >
                  <Text className="text-2xl">{ach.icon}</Text>
                  <Text className="text-white text-[10px] font-bold text-center mt-1" numberOfLines={2}>
                    {ach.title}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Sign Out ── */}
        <View className="px-5">
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

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View className="items-center">
      <Text className="text-xl font-black" style={{ color }}>{value}</Text>
      <Text className="text-[#71717A] text-xs mt-0.5">{label}</Text>
    </View>
  );
}
