import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';

type Period = 'weekly' | 'monthly' | 'all_time';

type LeaderboardRow = {
  id: string;
  user_id: string;
  period_type: string;
  period_key: string;
  rank: number;
  total_earnings: number;
  wins: number;
  losses: number;
  updated_at: string;
  user: { id: string; username: string; display_name: string | null; rank_tier: string; avatar_url: string | null } | null;
};

const PERIOD_LABELS: Record<Period, string> = {
  weekly: 'This Week', monthly: 'This Month', all_time: 'All Time',
};

const RANK_COLORS: Record<string, string> = {
  Bronze: '#CD7F32', Silver: '#C0C0C0', Gold: '#FFD700',
  Platinum: '#E5E4E2', Diamond: '#B9F2FF', Elite: '#F59E0B',
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

  const myEntry = entries?.find((e: any) => e.user?.id === profile?.id);

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">🏆 Leaderboard</Text>
      </View>

      {/* Period Tabs */}
      <View className="flex-row mx-5 bg-[#141414] rounded-xl p-1 mt-3 mb-4">
        {(['weekly', 'monthly', 'all_time'] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            className={`flex-1 py-2 rounded-lg items-center ${period === p ? 'bg-[#F59E0B]' : ''}`}
            onPress={() => setPeriod(p)}
          >
            <Text className={`text-xs font-bold ${period === p ? 'text-black' : 'text-[#71717A]'}`}>
              {PERIOD_LABELS[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* My rank banner */}
      {myEntry && (
        <View className="mx-5 mb-4 bg-[#1a1200] border border-[#F59E0B55] rounded-xl px-4 py-3 flex-row items-center">
          <Text className="text-[#F59E0B] font-black text-2xl mr-3">#{myEntry.rank}</Text>
          <View className="flex-1">
            <Text className="text-white font-bold">Your Rank</Text>
            <Text className="text-[#71717A] text-xs">
              {myEntry.wins}W · {formatCurrency(myEntry.total_earnings)} earned
            </Text>
          </View>
          <Text className="text-[#F59E0B] font-bold">{formatCurrency(myEntry.total_earnings)}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
        {isLoading ? (
          <ActivityIndicator color="#F59E0B" className="mt-16" />
        ) : (
          entries?.map((entry: any, index: number) => {
            const user = entry.user;
            const isMe = user?.id === profile?.id;
            const pos = entry.rank;
            const rankColor = RANK_COLORS[user?.rank_tier ?? 'Bronze'];

            return (
              <View
                key={entry.id}
                className="flex-row items-center rounded-xl px-4 py-3 mb-2"
                style={{
                  backgroundColor: isMe ? '#1a1200' : '#141414',
                  borderWidth: 1,
                  borderColor: isMe ? '#F59E0B55' : '#2E2E2E',
                }}
              >
                {/* Rank */}
                <View className="w-8 items-center mr-3">
                  {pos <= 3 ? (
                    <Text className="text-xl">{MEDAL[pos - 1]}</Text>
                  ) : (
                    <Text className="text-[#71717A] font-bold">#{pos}</Text>
                  )}
                </View>

                {/* Avatar */}
                <View
                  className="w-9 h-9 rounded-full bg-[#1E1E1E] border items-center justify-center mr-3"
                  style={{ borderColor: rankColor }}
                >
                  <Text className="text-sm font-bold" style={{ color: rankColor }}>
                    {user?.display_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>

                {/* Name */}
                <View className="flex-1">
                  <Text className="text-white font-bold text-sm">
                    {user?.display_name ?? user?.username}
                    {isMe ? ' (You)' : ''}
                  </Text>
                  <Text className="text-[#71717A] text-xs">{entry.wins}W {entry.losses}L</Text>
                </View>

                {/* Earnings */}
                <Text className="text-[#F59E0B] font-black text-base">
                  {formatCurrency(entry.total_earnings)}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
