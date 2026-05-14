import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency, formatFP } from '@/lib/utils';
import type { Matchup } from '@/lib/database.types';

type Tab = 'active' | 'pending' | 'history';

const STATUS_COLORS: Record<string, string> = {
  live:      '#EF4444',
  matched:   '#22C55E',
  pending:   '#F59E0B',
  completed: '#71717A',
  cancelled: '#71717A',
};

export default function MatchupsScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [tab, setTab] = useState<Tab>('active');

  const { data: matchups, isLoading, refetch } = useQuery({
    queryKey: ['matchups', profile?.id, tab],
    queryFn: async () => {
      if (!profile?.id) return [];
      const statuses: Record<Tab, string[]> = {
        active:  ['live', 'matched'],
        pending: ['pending'],
        history: ['completed', 'cancelled', 'refunded'],
      };
      const { data, error } = await supabase
        .from('matchups')
        .select('*')
        .or(`creator_id.eq.${profile.id},opponent_id.eq.${profile.id}`)
        .in('status', statuses[tab] as ('pending' | 'matched' | 'live' | 'completed' | 'cancelled' | 'refunded')[])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Matchup[];
    },
    enabled: !!profile?.id,
    refetchInterval: tab === 'active' ? 15_000 : undefined,
  });

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-4">
        <Text className="text-white text-2xl font-black">Matchups</Text>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/lineup')}
          className="bg-[#F59E0B] px-4 py-2 rounded-xl"
        >
          <Text className="text-black font-bold text-sm">+ ENTER</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View className="flex-row px-5 mb-4 gap-2">
        {(['active', 'pending', 'history'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            className="flex-1 py-2 rounded-xl items-center border"
            style={{
              backgroundColor: tab === t ? '#F59E0B' : 'transparent',
              borderColor: tab === t ? '#F59E0B' : '#2E2E2E',
            }}
          >
            <Text
              className="text-xs font-bold capitalize"
              style={{ color: tab === t ? '#000' : '#71717A' }}
            >
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#F59E0B" />
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 80 }}
      >
        {isLoading ? (
          <ActivityIndicator color="#F59E0B" className="mt-10" />
        ) : (matchups?.length ?? 0) === 0 ? (
          <EmptyState tab={tab} onEnter={() => router.push('/(tabs)/lineup')} />
        ) : (
          matchups?.map((m) => (
            <MatchupCard key={m.id} matchup={m} userId={profile?.id ?? ''} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MatchupCard({ matchup, userId }: { matchup: Matchup; userId: string }) {
  const router = useRouter();
  const isCreator = matchup.creator_id === userId;
  const myScore = isCreator ? matchup.creator_score : matchup.opponent_score;
  const oppScore = isCreator ? matchup.opponent_score : matchup.creator_score;
  const isWinner = matchup.winner_id === userId;
  const isCompleted = matchup.status === 'completed';
  const statusColor = STATUS_COLORS[matchup.status] ?? '#71717A';

  return (
    <TouchableOpacity
      onPress={() => router.push(`/matchup/${matchup.id}`)}
      className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-4 mb-3"
    >
      {/* Status + tier row */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
          <Text className="text-xs font-bold uppercase" style={{ color: statusColor }}>
            {matchup.status}
          </Text>
          <Text className="text-[#4B5563] text-xs">·</Text>
          <Text className="text-[#71717A] text-xs uppercase">{matchup.entry_tier} entry</Text>
        </View>
        {isCompleted && (
          <View
            className="px-2.5 py-1 rounded-lg"
            style={{ backgroundColor: isWinner ? '#052e16' : '#1c0505' }}
          >
            <Text
              className="text-xs font-black"
              style={{ color: isWinner ? '#22C55E' : '#EF4444' }}
            >
              {isWinner ? `+${formatCurrency(matchup.pot - matchup.rake_amount)}` : `-${formatCurrency(matchup.entry_fee)}`}
            </Text>
          </View>
        )}
      </View>

      {/* Score */}
      <View className="flex-row items-center justify-between">
        <View className="flex-1 items-center">
          <Text className="text-[#71717A] text-xs mb-1">You</Text>
          <Text className="text-white text-3xl font-black">{formatFP(myScore)}</Text>
        </View>
        <View className="items-center px-4">
          <Text className="text-[#4B5563] font-bold">vs</Text>
          <Text className="text-[#F59E0B] font-black text-sm mt-1">
            {formatCurrency(matchup.pot)}
          </Text>
        </View>
        <View className="flex-1 items-center">
          <Text className="text-[#71717A] text-xs mb-1">Opponent</Text>
          <Text className="text-white text-3xl font-black">{formatFP(oppScore)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function EmptyState({ tab, onEnter }: { tab: Tab; onEnter: () => void }) {
  const msgs: Record<Tab, { emoji: string; title: string; body: string }> = {
    active:  { emoji: '⚡', title: 'No active matchups', body: 'Enter a matchup to compete right now.' },
    pending: { emoji: '⏳', title: 'No pending matchups', body: 'Your queued entries will show here.' },
    history: { emoji: '📋', title: 'No history yet', body: 'Your past matchups will appear here.' },
  };
  const { emoji, title, body } = msgs[tab];

  return (
    <View className="items-center mt-16">
      <Text className="text-4xl mb-3">{emoji}</Text>
      <Text className="text-white font-black text-lg mb-2">{title}</Text>
      <Text className="text-[#71717A] text-center mb-6">{body}</Text>
      {tab !== 'history' && (
        <TouchableOpacity onPress={onEnter} className="bg-[#F59E0B] px-8 py-3 rounded-xl">
          <Text className="text-black font-black">ENTER MATCHUP</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
