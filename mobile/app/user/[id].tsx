import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatCurrency, RANK_COLORS, COLORS } from '@/lib/utils';

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
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('User not found');
      return data;
    },
    enabled: !!id,
  });

  const { data: achievements } = useQuery({
    queryKey: ['user_achievements_public', id],
    queryFn: async () => {
      // Schema columns: name, rarity (not icon/title).
      const { data } = await supabase
        .from('user_achievements')
        .select('*, achievement:achievements(name, rarity)')
        .eq('user_id', id!)
        .order('earned_at', { ascending: false })
        .limit(9);
      return data ?? [];
    },
    enabled: !!id,
  });

  if (isLoading || !user) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  const rankColor = RANK_COLORS[user.rank_tier ?? 'Bronze'];
  const totalGames = (user.total_wins ?? 0) + (user.total_losses ?? 0);
  const winRate = totalGames > 0
    ? Math.round(((user.total_wins ?? 0) / totalGames) * 100)
    : 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        <View className="items-center px-5 pt-4 pb-6">
          <View
            className="w-20 h-20 rounded-full bg-surface border-2 items-center justify-center mb-3"
            style={{ borderColor: rankColor }}
          >
            <Text className="text-text-primary text-4xl">{user.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text className="text-text-primary text-2xl font-bold">{user.display_name ?? user.username}</Text>
          <Text className="text-text-muted text-sm font-sans">@{user.username}</Text>
          <View className="mt-2 px-3 py-1 rounded-full border" style={{ borderColor: rankColor }}>
            <Text className="text-xs font-bold" style={{ color: rankColor }}>{user.rank_tier}</Text>
          </View>
        </View>

        <View className="mx-5 bg-surface border border-surface-border rounded-2xl p-5 mb-6">
          <View className="flex-row justify-between mb-4">
            <StatCell label="Wins" value={String(user.total_wins)} color={COLORS.win} />
            <StatCell label="Losses" value={String(user.total_losses)} color={COLORS.loss} />
            <StatCell label="Win Rate" value={`${winRate}%`} color={COLORS.brand} />
          </View>
          <View className="flex-row justify-center">
            <StatCell label="Total Earnings" value={formatCurrency(Number(user.total_earnings))} color="#A855F7" />
          </View>
        </View>

        {(achievements?.length ?? 0) > 0 && (
          <View className="px-5">
            <Text className="text-text-primary font-bold text-lg mb-3">Recent Achievements</Text>
            <View className="flex-row flex-wrap gap-3">
              {achievements?.map((ua: any) => {
                const ach = Array.isArray(ua.achievement) ? ua.achievement[0] : ua.achievement;
                return (
                  <View
                    key={ua.id}
                    className="w-[30%] bg-surface border border-surface-border rounded-xl p-3 items-center"
                  >
                    <Text className="text-text-primary text-[11px] font-bold text-center" numberOfLines={2}>
                      {ach?.name ?? 'Achievement'}
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
      <Text className="font-mono text-xl font-bold" style={{ color }}>{value}</Text>
      <Text className="text-text-muted text-xs mt-0.5 font-sans">{label}</Text>
    </View>
  );
}
