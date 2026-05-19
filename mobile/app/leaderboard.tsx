import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency, RANK_COLORS, COLORS } from '@/lib/utils';
import type { LeaderboardEntry } from '@/lib/database.types';

type Period = 'weekly' | 'monthly' | 'all_time';

// Schema columns: score (decimal, total winnings), calculated_at (timestamp).
type LeaderboardRow = LeaderboardEntry & {
  user: {
    id: string;
    username: string;
    display_name: string | null;
    rank_tier: string | null;
    avatar_url: string | null;
  } | null;
};

const PERIOD_LABELS: Record<Period, string> = {
  weekly: 'This Week', monthly: 'This Month', all_time: 'All Time',
};

const MEDAL = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [period, setPeriod] = useState<Period>('weekly');

  const { data: entries, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leaderboard_entries')
        .select(`
          *,
          user:profiles(id, username, display_name, rank_tier, avatar_url)
        `)
        .eq('period_type', period)
        .order('rank', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
    staleTime: 60_000,
  });

  const myEntry = entries?.find((e) => e.user?.id === profile?.id);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-text-primary font-bold text-xl">Leaderboard</Text>
      </View>

      <View className="flex-row mx-5 bg-surface rounded-xl p-1 mt-3 mb-4">
        {(['weekly', 'monthly', 'all_time'] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            className="flex-1 py-2 rounded-lg items-center"
            style={{ backgroundColor: period === p ? '#F5A524' : 'transparent' }}
            onPress={() => setPeriod(p)}
          >
            <Text
              className="text-xs font-bold"
              style={{ color: period === p ? '#0A0A0C' : '#71717A' }}
            >
              {PERIOD_LABELS[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {myEntry && (
        <View className="mx-5 mb-4 bg-brandTint border border-brand rounded-xl px-4 py-3 flex-row items-center">
          <Text className="text-brand font-mono font-bold text-2xl mr-3">#{myEntry.rank}</Text>
          <View className="flex-1">
            <Text className="text-text-primary font-bold">Your Rank</Text>
            <Text className="text-text-muted text-xs font-mono">
              {myEntry.wins}W · {formatCurrency(Number(myEntry.score))} earned
            </Text>
          </View>
          <Text className="text-brand font-mono font-bold">{formatCurrency(Number(myEntry.score))}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brand} className="mt-16" />
        ) : (
          entries?.map((entry) => {
            const user = entry.user;
            const isMe = user?.id === profile?.id;
            const pos = entry.rank;
            const rankColor = RANK_COLORS[user?.rank_tier ?? 'Bronze'];

            return (
              <View
                key={entry.id}
                className="flex-row items-center rounded-xl px-4 py-3 mb-2 border"
                style={{
                  backgroundColor: isMe ? '#1a1200' : COLORS.surface,
                  borderColor: isMe ? '#F5A52455' : COLORS.border,
                }}
              >
                <View className="w-8 items-center mr-3">
                  {pos <= 3 ? (
                    <Text className="text-xl">{MEDAL[pos - 1]}</Text>
                  ) : (
                    <Text className="text-text-muted font-mono font-bold">#{pos}</Text>
                  )}
                </View>

                <View
                  className="w-9 h-9 rounded-full bg-surface-raised border items-center justify-center mr-3"
                  style={{ borderColor: rankColor }}
                >
                  <Text className="text-sm font-bold" style={{ color: rankColor }}>
                    {user?.display_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>

                <View className="flex-1">
                  <Text className="text-text-primary font-bold text-sm">
                    {user?.display_name ?? user?.username}
                    {isMe ? ' (You)' : ''}
                  </Text>
                  <Text className="text-text-muted text-xs font-mono">{entry.wins}W {entry.losses}L</Text>
                </View>

                <Text className="text-brand font-mono font-bold text-base">
                  {formatCurrency(Number(entry.score))}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
