// =============================================================================
// BETTHAT — Achievements (Holy Grail V2)
// Progress bar + rarity-grouped grid. Locked items dimmed.
// =============================================================================

import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT } from '@/lib/holygrail';
import type { Achievement, UserAchievement } from '@/lib/database.types';

const RARITY_TINT: Record<string, string> = {
  common: HG.muted,
  rare: HG.sky,
  epic: '#A855F7',
  legendary: '#F5A524',
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

  const grouped = (['legendary', 'epic', 'rare', 'common'] as const)
    .map((rarity) => ({ rarity, items: (data?.all ?? []).filter((a) => a.rarity === rarity) }))
    .filter((g) => g.items.length > 0);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, marginLeft: 12 }}>Achievements</Text>
      </View>

      {/* Progress bar */}
      <View style={{ marginHorizontal: 18, marginTop: 8, marginBottom: 18, padding: 18, backgroundColor: HG.surface, borderRadius: 16, borderWidth: 1, borderColor: HG.hairline }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: HG.ink }}>
            {earnedCount} / {totalCount} Unlocked
          </Text>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.sky }}>{pct}%</Text>
        </View>
        <View style={{ height: 8, backgroundColor: HG.hairline, borderRadius: 999, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${pct}%`, backgroundColor: HG.sky, borderRadius: 999 }} />
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={HG.sky} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 80 }}>
          {grouped.map(({ rarity, items }) => (
            <View key={rarity} style={{ marginBottom: 28 }}>
              {/* Divider with rarity label */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: HG.hairline }} />
                <Text style={{ marginHorizontal: 10, fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 1.8, color: RARITY_TINT[rarity], textTransform: 'uppercase' }}>
                  {RARITY_LABELS[rarity]}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: HG.hairline }} />
              </View>

              {items.map((ach) => {
                const earned = earnedMap.get(ach.id);
                const unlocked = !!earned;
                return (
                  <View
                    key={ach.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      backgroundColor: HG.surface, borderRadius: 14,
                      paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
                      borderWidth: 1,
                      borderColor: unlocked ? RARITY_TINT[rarity] + '55' : HG.hairline,
                      opacity: unlocked ? 1 : 0.45,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>{ach.name}</Text>
                      <Text numberOfLines={2} style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted, marginTop: 3 }}>
                        {ach.description}
                      </Text>
                      {unlocked && earned?.earned_at && (
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: RARITY_TINT[rarity], marginTop: 5 }}>
                          Unlocked {new Date(earned.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      )}
                    </View>
                    <View style={{ marginLeft: 12, alignItems: 'center', justifyContent: 'center', width: 64 }}>
                      {unlocked ? (
                        <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 1, color: HG.sky, textTransform: 'uppercase' }}>
                          ✓ Done
                        </Text>
                      ) : (
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, textTransform: 'uppercase' }}>Locked</Text>
                      )}
                    </View>
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

