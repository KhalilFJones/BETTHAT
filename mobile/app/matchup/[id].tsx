import { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency, formatFP } from '@/lib/utils';
import type { Matchup, LineupPlayer } from '@/lib/database.types';

export default function MatchupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuthStore();

  const { data: matchup, isLoading } = useQuery({
    queryKey: ['matchup', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchups')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Matchup;
    },
  });

  // Subscribe to live score updates via Supabase Realtime
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`matchup:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matchups', filter: `id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['matchup', id] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const { data: myLineupPlayers } = useQuery({
    queryKey: ['lineup_players', id, profile?.id],
    queryFn: async () => {
      if (!profile?.id || !id) return [];
      // Get lineup for this matchup by this user
      const { data: lineup } = await supabase
        .from('lineups')
        .select('id')
        .eq('matchup_id', id)
        .eq('user_id', profile.id)
        .single();
      if (!lineup) return [];

      const { data, error } = await supabase
        .from('lineup_players')
        .select(`
          *,
          player:nba_players(full_name, position, team_abbreviation),
          stats:player_game_stats(points, rebounds, assists, steals, blocks, turnovers, fantasy_points, is_final)
        `)
        .eq('lineup_id', lineup.id);
      if (error) return [];
      return data;
    },
    enabled: !!profile?.id && !!id,
    refetchInterval: matchup?.status === 'live' ? 30_000 : undefined,
  });

  if (isLoading || !matchup) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0a0a] items-center justify-center">
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  const isCreator = matchup.creator_id === profile?.id;
  const myScore = isCreator ? matchup.creator_score : matchup.opponent_score;
  const oppScore = isCreator ? matchup.opponent_score : matchup.creator_score;
  const isWinner = matchup.winner_id === profile?.id;
  const isCompleted = matchup.status === 'completed';
  const isLive = matchup.status === 'live';
  const isPending = matchup.status === 'pending';

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-base flex-1">
          {matchup.entry_tier} Matchup
        </Text>
        <View className="flex-row items-center gap-1.5">
          {isLive && <View className="w-2 h-2 rounded-full bg-[#EF4444]" />}
          <Text
            className="text-xs font-bold uppercase"
            style={{ color: isLive ? '#EF4444' : isCompleted ? '#71717A' : '#F59E0B' }}
          >
            {matchup.status}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Score Hero ── */}
        <View className="mx-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-6 mb-5">
          {/* Result banner */}
          {isCompleted && (
            <View
              className="rounded-xl py-2 items-center mb-4"
              style={{ backgroundColor: isWinner ? '#052e16' : '#1c0505' }}
            >
              <Text
                className="font-black text-lg"
                style={{ color: isWinner ? '#22C55E' : '#EF4444' }}
              >
                {isWinner
                  ? `YOU WON ${formatCurrency(matchup.pot - matchup.rake_amount)} 🏆`
                  : `YOU LOST ${formatCurrency(matchup.entry_fee)} 💔`}
              </Text>
            </View>
          )}

          {isPending && (
            <View className="bg-[#1a1200] border border-[#F59E0B33] rounded-xl py-2 items-center mb-4">
              <Text className="text-[#F59E0B] font-bold">⏳ Waiting for opponent...</Text>
            </View>
          )}

          {/* Scores */}
          <View className="flex-row items-center justify-between">
            <View className="flex-1 items-center">
              <Text className="text-[#71717A] text-xs mb-1">You</Text>
              <Text className="text-white text-5xl font-black">{formatFP(myScore)}</Text>
            </View>
            <View className="items-center px-6">
              <Text className="text-[#4B5563] text-xl font-black">vs</Text>
              <Text className="text-[#F59E0B] font-black text-base mt-2">
                {formatCurrency(matchup.pot)}
              </Text>
              <Text className="text-[#71717A] text-xs">pot</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-[#71717A] text-xs mb-1">Opponent</Text>
              <Text className="text-white text-5xl font-black">{formatFP(oppScore)}</Text>
            </View>
          </View>
        </View>

        {/* ── My Lineup breakdown ── */}
        {(myLineupPlayers?.length ?? 0) > 0 && (
          <View className="px-5">
            <Text className="text-white font-black text-lg mb-3">My Lineup</Text>
            {myLineupPlayers?.map((lp: any) => {
              const stats = Array.isArray(lp.stats) ? lp.stats[0] : lp.stats;
              const player = Array.isArray(lp.player) ? lp.player[0] : lp.player;
              return (
                <View
                  key={lp.id}
                  className="flex-row items-center bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 mb-2"
                >
                  <View className="flex-1">
                    <Text className="text-white font-bold">{player?.full_name ?? '—'}</Text>
                    <Text className="text-[#71717A] text-xs">
                      {player?.position ?? '?'} · {player?.team_abbreviation ?? '—'}
                    </Text>
                  </View>

                  {stats ? (
                    <View className="items-end">
                      <Text className="text-[#F59E0B] font-black text-lg">
                        {formatFP(stats.fantasy_points)}
                      </Text>
                      <Text className="text-[#71717A] text-xs">
                        {stats.points}pts {stats.rebounds}reb {stats.assists}ast
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-[#71717A] text-sm">TBD</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
