import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { COLORS } from '@/lib/utils';
import type { Achievement, UserAchievement } from '@/lib/database.types';

const RARITY_COLORS: Record<string, string> = {
  common:    COLORS.textMuted,
  rare:      COLORS.info,
  epic:      '#A855F7',
  legendary: COLORS.brand,
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
        // Schema columns: name, description, icon_url, rarity, category.
        supabase.from('achievements').select('*').order('rarity').order('name'),
        supabase.from('user_achievements').select('*').eq('user_id', profile.id),
      ]);
      return {
        all: (allRes.data ?? []) as Achievement[],
        earned: (earnedRes.data ?? []) as UserAchievement[],
      };
    },
    enabled: !!profile?.id,
  });

  const earnedMap = new Map(data?.earned.map((e) => [e.achievement_id, e]) ?? []);
  const earnedCount = earnedMap.size;
  const totalCount = data?.all.length ?? 0;
  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  const grouped = (['legendary', 'epic', 'rare', 'common'] as const).map((rarity) => ({
    rarity,
    items: (data?.all ?? []).filter((a) => a.rarity === rarity),
  })).filter((g) => g.items.length > 0);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-text-primary font-bold text-xl">Achievements</Text>
      </View>

      <View className="mx-5 mt-4 mb-5 bg-surface border border-surface-border rounded-2xl p-5">
        <View className="flex-row justify-between mb-2">
          <Text className="text-text-primary font-bold font-mono">
            {earnedCount} / {totalCount} Unlocked
          </Text>
          <Text className="text-brand font-mono font-bold">{pct}%</Text>
        </View>
        <View className="h-3 bg-surface-border rounded-full overflow-hidden">
          <View
            className="h-full bg-brand rounded-full"
            style={{ width: `${pct}%` }}
          />
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.brand} className="mt-10" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
          {grouped.map(({ rarity, items }) => (
            <View key={rarity} className="mb-6">
              <View className="flex-row items-center mb-3">
                <View className="flex-1 h-px bg-surface-border" />
                <Text
                  className="mx-3 text-xs font-bold tracking-widest uppercase font-sans"
                  style={{ color: RARITY_COLORS[rarity] }}
                >
                  {RARITY_LABELS[rarity]}
                </Text>
                <View className="flex-1 h-px bg-surface-border" />
              </View>

              {items.map((ach) => {
                const earned = earnedMap.get(ach.id);
                const isUnlocked = !!earned;
                return (
                  <View
                    key={ach.id}
                    className="flex-row items-center bg-surface rounded-xl px-4 py-3.5 mb-2 border"
                    style={{
                      borderColor: isUnlocked ? RARITY_COLORS[rarity] + '55' : COLORS.border,
                      opacity: isUnlocked ? 1 : 0.45,
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-text-primary font-bold text-sm">{ach.name}</Text>
                      <Text className="text-text-muted text-xs mt-0.5 font-sans" numberOfLines={2}>
                        {ach.description}
                      </Text>
                      {isUnlocked && earned?.earned_at && (
                        <Text className="text-xs mt-1 font-mono" style={{ color: RARITY_COLORS[rarity] }}>
                          Unlocked {new Date(earned.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      )}
                    </View>
                    {isUnlocked ? (
                      <Text className="text-win font-bold text-xs">UNLOCKED</Text>
                    ) : (
                      <Text className="text-text-muted text-xs font-sans">Locked</Text>
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
