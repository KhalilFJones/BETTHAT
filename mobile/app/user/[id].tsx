import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatCurrency, RANK_COLORS } from '@/lib/utils';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: user, isLoading } = useQuery({
    queryKey: ['user_profile', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: achievements } = useQuery({
    queryKey: ['user_achievements_public', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_achievements')
        .select('*, achievement:achievements(icon, title, rarity)')
        .eq('user_id', id!)
        .order('earned_at', { ascending: false })
        .limit(9);
      return data ?? [];
    },
    enabled: !!id,
  });

  if (isLoading || !user) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0a0a] items-center justify-center">
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  const rankColor = RANK_COLORS[user.rank_tier ?? 'Bronze'];
  const winRate = user.total_wins + user.total_losses > 0
    ? Math.round((user.total_wins / (user.total_wins + user.total_losses)) * 100)
    : 0;

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View className="items-center px-5 pt-4 pb-6">
          <View
            className="w-20 h-20 rounded-full bg-[#1E1E1E] border-2 items-center justify-center mb-3"
            style={{ borderColor: rankColor }}
          >
            <Text className="text-4xl">{user.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text className="text-white text-2xl font-black">{user.display_name ?? user.username}</Text>
          <Text className="text-[#71717A] text-sm">@{user.username}</Text>
          <View className="mt-2 px-3 py-1 rounded-full border" style={{ borderColor: rankColor }}>
            <Text className="text-xs font-bold" style={{ color: rankColor }}>🏅 {user.rank_tier}</Text>
          </View>
        </View>

        {/* Stats */}
        <View className="mx-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-6">
          <View className="flex-row justify-between mb-4">
            <StatCell label="Wins" value={String(user.total_wins)} color="#22C55E" />
            <StatCell label="Losses" value={String(user.total_losses)} color="#EF4444" />
            <StatCell label="Win Rate" value={`${winRate}%`} color="#F59E0B" />
          </View>
          <View className="flex-row justify-center">
            <StatCell label="Total Earnings" value={formatCurrency(user.total_earnings)} color="#A855F7" />
          </View>
        </View>

        {/* Achievements */}
        {(achievements?.length ?? 0) > 0 && (
          <View className="px-5">
            <Text className="text-white font-black text-lg mb-3">Recent Achievements</Text>
            <View className="flex-row flex-wrap gap-3">
              {achievements?.map((ua: any) => {
                const ach = Array.isArray(ua.achievement) ? ua.achievement[0] : ua.achievement;
                return (
                  <View
                    key={ua.id}
                    className="w-[30%] bg-[#141414] border border-[#F59E0B44] rounded-xl p-3 items-center"
                  >
                    <Text className="text-2xl">{ach?.icon ?? '🏅'}</Text>
                    <Text className="text-white text-[10px] font-bold text-center mt-1" numberOfLines={2}>
                      {ach?.title ?? 'Achievement'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
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
