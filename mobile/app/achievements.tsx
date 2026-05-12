import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import type { Achievement, UserAchievement } from '@/lib/database.types';

const RARITY_COLORS: Record<string, string> = {
  common: '#71717A',
  rare: '#3B82F6',
  epic: '#A855F7',
  legendary: '#F59E0B',
};

const RARITY_LABELS: Record<string, string> = {
  common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary',
};

export default function AchievementsScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['achievements_full', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return { all: [], earned: [] };
      const [allRes, earnedRes] = await Promise.all([
        supabase.from('achievements').select('*').order('rarity').order('title'),
        supabase.from('user_achievements').select('*, achievement:achievements(id)').eq('user_id', profile.id),
      ]);
      return {
        all: (allRes.data ?? []) as Achievement[],
        earned: (earnedRes.data ?? []) as (UserAchievement & { achievement: { id: string } })[],
      };
    },
    enabled: !!profile?.id,
  });

  const earnedMap = new Map(data?.earned.map((e) => [e.achievement_id, e]) ?? []);
  const earnedCount = earnedMap.size;
  const totalCount = data?.all.length ?? 0;
  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  // Group by rarity
  const grouped = (['legendary', 'epic', 'rare', 'common'] as const).map((rarity) => ({
    rarity,
    items: (data?.all ?? []).filter((a) => a.rarity === rarity),
  })).filter((g) => g.items.length > 0);

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">🎖️ Achievements</Text>
      </View>

      {/* Progress bar */}
      <View className="mx-5 mt-4 mb-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5">
        <View className="flex-row justify-between mb-2">
          <Text className="text-white font-bold">{earnedCount} / {totalCount} Unlocked</Text>
          <Text className="text-[#F59E0B] font-bold">{pct}%</Text>
        </View>
        <View className="h-3 bg-[#2E2E2E] rounded-full overflow-hidden">
          <View
            className="h-full bg-[#F59E0B] rounded-full"
            style={{ width: `${pct}%` }}
          />
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#F59E0B" className="mt-10" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
          {grouped.map(({ rarity, items }) => (
            <View key={rarity} className="mb-6">
              <View className="flex-row items-center mb-3">
                <View className="flex-1 h-px bg-[#1E1E1E]" />
                <Text
                  className="mx-3 text-xs font-black tracking-widest uppercase"
                  style={{ color: RARITY_COLORS[rarity] }}
                >
                  {RARITY_LABELS[rarity]}
                </Text>
                <View className="flex-1 h-px bg-[#1E1E1E]" />
              </View>

              {items.map((ach) => {
                const earned = earnedMap.get(ach.id);
                const isUnlocked = !!earned;
                return (
                  <View
                    key={ach.id}
                    className="flex-row items-center bg-[#141414] rounded-xl px-4 py-3.5 mb-2 border"
                    style={{
                      borderColor: isUnlocked ? RARITY_COLORS[rarity] + '55' : '#1E1E1E',
                      opacity: isUnlocked ? 1 : 0.45,
                    }}
                  >
                    <View
                      className="w-12 h-12 rounded-xl items-center justify-center mr-4"
                      style={{ backgroundColor: isUnlocked ? RARITY_COLORS[rarity] + '22' : '#1E1E1E' }}
                    >
                      <Text className="text-2xl">{ach.icon}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-bold text-sm">{ach.title}</Text>
                      <Text className="text-[#71717A] text-xs mt-0.5" numberOfLines={2}>
                        {ach.description}
                      </Text>
                      {isUnlocked && earned?.earned_at && (
                        <Text className="text-xs mt-1" style={{ color: RARITY_COLORS[rarity] }}>
                          Unlocked {new Date(earned.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      )}
                    </View>
                    {isUnlocked ? (
                      <Text className="text-xl">✅</Text>
                    ) : (
                      <View className="items-end">
                        {ach.points_required && (
                          <Text className="text-[#4B5563] text-xs">{ach.points_required} pts</Text>
                        )}
                        <Text className="text-[#4B5563] text-xs">Locked</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
