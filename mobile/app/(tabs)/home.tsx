import { ScrollView, View, Text, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency, formatFP } from '@/lib/utils';
import type { TodayGame, Matchup } from '@/lib/database.types';

export default function HomeScreen() {
  const router = useRouter();
  const { profile, wallet } = useAuthStore();

  const { data: games, isLoading: gamesLoading, refetch: refetchGames } = useQuery({
    queryKey: ['todays_games'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mv_todays_games')
        .select('*')
        .order('tip_off_time', { ascending: true });
      if (error) throw error;
      return data as TodayGame[];
    },
    refetchInterval: 60_000, // refresh every minute
  });

  const { data: activeMatchups, refetch: refetchMatchups } = useQuery({
    queryKey: ['active_matchups', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('matchups')
        .select('*')
        .or(`creator_id.eq.${profile.id},opponent_id.eq.${profile.id}`)
        .in('status', ['pending', 'matched', 'live'])
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as Matchup[];
    },
    enabled: !!profile?.id,
  });

  const { data: notifications } = useQuery({
    queryKey: ['unread_notifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return 0;
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
      return count ?? 0;
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  function handleRefresh() {
    refetchGames();
    refetchMatchups();
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={gamesLoading}
            onRefresh={handleRefresh}
            tintColor="#F59E0B"
          />
        }
      >
        {/* ── Header ── */}
        <View className="flex-row items-center justify-between px-5 pt-2 pb-4">
          <View>
            <Text className="text-[#71717A] text-sm">Welcome back,</Text>
            <Text className="text-white text-xl font-black">
              {profile?.display_name ?? profile?.username ?? '—'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/notifications')} className="relative">
            <Text className="text-2xl">🔔</Text>
            {(notifications ?? 0) > 0 && (
              <View className="absolute -top-1 -right-1 w-4 h-4 bg-[#F59E0B] rounded-full items-center justify-center">
                <Text className="text-black text-[9px] font-bold">{notifications}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Wallet Banner ── */}
        <TouchableOpacity
          onPress={() => router.push('/wallet')}
          className="mx-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-5"
        >
          <View className="flex-row justify-between items-start">
            <View>
              <Text className="text-[#71717A] text-xs tracking-wider uppercase">Available Balance</Text>
              <Text className="text-white text-3xl font-black mt-1">
                {formatCurrency(wallet?.balance ?? 0)}
              </Text>
              {(wallet?.escrow_balance ?? 0) > 0 && (
                <Text className="text-[#71717A] text-sm mt-1">
                  {formatCurrency(wallet?.escrow_balance ?? 0)} in escrow
                </Text>
              )}
            </View>
            <View className="items-end">
              <View className="bg-[#F59E0B] rounded-lg px-3 py-1.5">
                <Text className="text-black font-bold text-sm">DEPOSIT</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Quick Enter ── */}
        <View className="px-5 mb-6">
          <Text className="text-white font-black text-lg mb-3">Quick Enter</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-0">
            {(['$1', '$5', '$10', '$20', '$50'] as const).map((tier) => (
              <TouchableOpacity
                key={tier}
                onPress={() => router.push({ pathname: '/lineup/build', params: { tier } })}
                className="bg-[#141414] border border-[#2E2E2E] rounded-2xl mr-3 px-5 py-4 items-center min-w-[80px]"
              >
                <Text className="text-[#F59E0B] text-lg font-black">{tier}</Text>
                <Text className="text-[#71717A] text-xs mt-1">entry</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Today's Games ── */}
        <View className="px-5 mb-6">
          <Text className="text-white font-black text-lg mb-3">Today's Games</Text>
          {gamesLoading ? (
            <ActivityIndicator color="#F59E0B" />
          ) : (games?.length ?? 0) === 0 ? (
            <View className="bg-[#141414] rounded-2xl p-5 items-center">
              <Text className="text-[#71717A]">No games scheduled today.</Text>
            </View>
          ) : (
            games?.map((game) => <GameCard key={game.id} game={game} />)
          )}
        </View>

        {/* ── Active Matchups ── */}
        {(activeMatchups?.length ?? 0) > 0 && (
          <View className="px-5 mb-6">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-white font-black text-lg">Active Matchups</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/matchups')}>
                <Text className="text-[#F59E0B] text-sm">See all</Text>
              </TouchableOpacity>
            </View>
            {activeMatchups?.map((m) => (
              <ActiveMatchupCard key={m.id} matchup={m} userId={profile?.id ?? ''} />
            ))}
          </View>
        )}

        {/* ── Stats Footer ── */}
        <View className="mx-5 mb-8 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5">
          <Text className="text-[#71717A] text-xs tracking-wider uppercase mb-3">Your Stats</Text>
          <View className="flex-row justify-between">
            <StatCell label="Wins" value={String(profile?.total_wins ?? 0)} color="#22C55E" />
            <StatCell label="Losses" value={String(profile?.total_losses ?? 0)} color="#EF4444" />
            <StatCell label="Win Rate" value={`${profile?.win_rate ?? 0}%`} color="#F59E0B" />
            <StatCell label="Earnings" value={formatCurrency(profile?.total_earnings ?? 0)} color="#A855F7" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function GameCard({ game }: { game: TodayGame }) {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const time = game.tip_off_time
    ? new Date(game.tip_off_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '--:--';

  return (
    <View className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-4 mb-3">
      <View className="flex-row items-center justify-between">
        {/* Away team */}
        <View className="flex-1 items-center">
          <Text className="text-white font-black text-lg">{game.away_team_abbreviation}</Text>
          {(isFinal || isLive) && (
            <Text className="text-white text-2xl font-black">{game.away_score}</Text>
          )}
        </View>

        {/* Center info */}
        <View className="items-center px-4">
          {isLive ? (
            <View className="flex-row items-center gap-1.5">
              <View className="w-2 h-2 rounded-full bg-[#EF4444]" />
              <Text className="text-[#EF4444] font-bold text-sm">LIVE</Text>
            </View>
          ) : isFinal ? (
            <Text className="text-[#71717A] text-sm font-bold">FINAL</Text>
          ) : (
            <Text className="text-[#A1A1AA] text-sm">{time}</Text>
          )}
          <Text className="text-[#4B5563] text-xs mt-1">vs</Text>
        </View>

        {/* Home team */}
        <View className="flex-1 items-center">
          <Text className="text-white font-black text-lg">{game.home_team_abbreviation}</Text>
          {(isFinal || isLive) && (
            <Text className="text-white text-2xl font-black">{game.home_score}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function ActiveMatchupCard({ matchup, userId }: { matchup: Matchup; userId: string }) {
  const router = useRouter();
  const isCreator = matchup.creator_id === userId;
  const myScore = isCreator ? matchup.creator_score : matchup.opponent_score;
  const oppScore = isCreator ? matchup.opponent_score : matchup.creator_score;
  const isLive = matchup.status === 'live';

  return (
    <TouchableOpacity
      onPress={() => router.push(`/matchup/${matchup.id}`)}
      className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-center justify-between">
        <View>
          <View className="flex-row items-center gap-2">
            {isLive && (
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                <Text className="text-[#EF4444] text-xs font-bold">LIVE</Text>
              </View>
            )}
            <Text className="text-[#71717A] text-xs uppercase tracking-wide">
              {matchup.entry_tier} matchup
            </Text>
          </View>
          <Text className="text-white font-black text-xl mt-1">
            {formatFP(myScore)} <Text className="text-[#71717A] font-medium text-base">vs</Text> {formatFP(oppScore)}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[#F59E0B] font-black text-lg">
            {formatCurrency(matchup.pot)}
          </Text>
          <Text className="text-[#71717A] text-xs">pot</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View className="items-center">
      <Text className="text-lg font-black" style={{ color }}>{value}</Text>
      <Text className="text-[#71717A] text-xs mt-0.5">{label}</Text>
    </View>
  );
}
