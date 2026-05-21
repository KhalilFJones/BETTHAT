// =============================================================================
// BETTHAT â€” Home (Holy Grail V2, Screen 03)
// Redesigned: greeting, stats row, action CTA, improved game cards,
// trending players, breakout hero, recent results.
// =============================================================================

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtPct, fmtFP, fmtTime,
  priceDirectionColor, playerInitials,
} from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { Ticker, type TickerEntry } from '@/components/holygrail/Ticker';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

const TRENDING_RANGE_OPTIONS = [
  { key: '1h',      label: '1h' },
  { key: '4h',      label: '4h' },
  { key: '24h',     label: '24h' },
  { key: '7d',      label: '7d' },
  { key: 'alltime', label: 'All time' },
] as const;

function greeting(name: string) {
  const h = new Date().getHours();
  const salutation = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${salutation}, ${name.split(' ')[0]}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const { profile, wallet } = useAuthStore();
  const [trendingRange, setTrendingRange] = useState<'1h' | '4h' | '24h' | '7d' | 'alltime'>('1h');

  // â”€â”€ Main data (games, ticker, breakout) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['home', profile?.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: dateRow } = await supabase
        .from('nba_games')
        .select('game_date')
        .lte('game_date', today)
        .order('game_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const slateDate = (dateRow as any)?.game_date ?? today;
      const prevDate = new Date(new Date(slateDate).getTime() - 24 * 3600 * 1000)
        .toISOString().slice(0, 10);

      const [tickerQ, gamesQ, breakoutQ] = await Promise.all([
        supabase
          .from('player_prices')
          .select(`current_price, price_change_pct_24h, nba_players!inner(ticker_handle, last_name)`)
          .order('demand_count_1h', { ascending: false })
          .limit(20),
        supabase
          .from('nba_games')
          .select('*')
          .eq('game_date', slateDate)
          .order('tip_off_time', { ascending: true }),
        supabase
          .from('player_game_stats')
          .select(`fantasy_points, points, rebounds, assists, steals, blocks,
            nba_players!inner(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation),
            nba_games!inner(game_date)`)
          .eq('nba_games.game_date', prevDate)
          .order('fantasy_points', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        ticker: tickerQ.data ?? [],
        games: gamesQ.data ?? [],
        breakout: breakoutQ.data,
      };
    },
    enabled: !!profile?.id,
    refetchInterval: 60_000,
  });

  // â”€â”€ Live scores (1s poll when game is live) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: liveScores } = useQuery({
    queryKey: ['live-game-scores'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('nba_games')
        .select('id, status, period, game_clock, home_score, away_score')
        .eq('game_date', today);
      return (data ?? []) as Array<{
        id: string; status: string; period: number | null;
        game_clock: string | null; home_score: number | null; away_score: number | null;
      }>;
    },
    refetchInterval: (query) => {
      const scores = query.state.data ?? [];
      return scores.some((g) => g.status === 'live') ? 1_000 : 30_000;
    },
  });

  const liveScoreMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const g of (liveScores ?? [])) m.set(g.id, g);
    return m;
  }, [liveScores]);

  const games = useMemo(
    () => (data?.games ?? []).map((g: any) => {
      const live = liveScoreMap.get(g.id);
      return live ? { ...g, status: live.status, period: live.period, game_clock: live.game_clock, home_score: live.home_score, away_score: live.away_score } : g;
    }),
    [data?.games, liveScoreMap],
  );

  // â”€â”€ Trending â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: trendingData } = useQuery({
    queryKey: ['home-trending', trendingRange, profile?.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: todayPlayers } = await supabase
        .from('player_game_availability')
        .select('player_id')
        .eq('game_date', today)
        .eq('is_draftable', true);
      const todayIds = (todayPlayers ?? []).map((r) => r.player_id);
      let q = supabase
        .from('player_prices')
        .select(`player_id, current_price, price_change_pct_24h, demand_count_1h, demand_count_4h, total_selections,
          nba_players!inner(id, full_name, first_name, last_name, jersey_number, team_abbreviation, position, is_active)`)
        .eq('nba_players.is_active', true);
      if (todayIds.length > 0) q = q.in('player_id', todayIds);

      if (trendingRange === '1h') {
        const { data } = await q.order('demand_count_1h', { ascending: false }).limit(12);
        return data ?? [];
      }
      if (trendingRange === '4h') {
        const { data } = await q.order('demand_count_1h', { ascending: false }).limit(20);
        return (data ?? []).sort((a: any, b: any) =>
          Number(b.demand_count_4h ?? b.demand_count_1h ?? 0) - Number(a.demand_count_4h ?? a.demand_count_1h ?? 0)
        ).slice(0, 12);
      }
      if (trendingRange === '24h') {
        const { data } = await q.order('price_change_pct_24h', { ascending: false });
        return (data ?? []).sort((a: any, b: any) =>
          Math.abs(Number(b.price_change_pct_24h ?? 0)) - Math.abs(Number(a.price_change_pct_24h ?? 0))
        ).slice(0, 12);
      }
      const { data } = await q.order('total_selections', { ascending: false }).limit(12);
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  // â”€â”€ Active matchup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: activeMatchup } = useQuery({
    queryKey: ['home-active-matchup', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('matchups')
        .select('id, status, user1_score, user2_score, user1_final_score, user2_final_score, user1_id, user2_id, pot_amount, settled_wager')
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .in('status', ['matched', 'in_progress', 'live', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  // â”€â”€ User record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: record } = useQuery({
    queryKey: ['home-record', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return { wins: 0, losses: 0, earnings: 0 };
      const { data } = await supabase
        .from('matchups')
        .select('winner_user_id, payout_amount, settled_wager')
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .eq('status', 'completed');
      const rows = data ?? [];
      const wins = rows.filter((r: any) => r.winner_user_id === profile.id).length;
      const losses = rows.filter((r: any) => r.winner_user_id && r.winner_user_id !== profile.id).length;
      const earnings = rows.reduce((s: number, r: any) => {
        if (r.winner_user_id === profile.id) return s + Number(r.payout_amount ?? 0) - Number(r.settled_wager ?? 0);
        if (r.winner_user_id) return s - Number(r.settled_wager ?? 0);
        return s;
      }, 0);
      return { wins, losses, earnings };
    },
    enabled: !!profile?.id,
  });

  // â”€â”€ Recent results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: recentResults } = useQuery({
    queryKey: ['home-recent-results', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('matchups')
        .select(`id, status, winner_user_id, user1_id, payout_amount, settled_wager, completed_at,
          u1:profiles!user1_id(username, display_name),
          u2:profiles!user2_id(username, display_name)`)
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(3);
      return (data ?? []) as any[];
    },
    enabled: !!profile?.id,
  });

  // â”€â”€ Promo credit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: promoCredit } = useQuery({
    queryKey: ['home-promo-credit', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const now = new Date();
      const { data } = await supabase
        .from('user_promo_redemptions' as never)
        .select('credit_amount, status, promo_codes(expires_at), created_at')
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      const rows = (data ?? []) as any[];
      const activePromo = rows.find((row) => {
        const expiresAt = row.promo_codes?.expires_at;
        return !expiresAt || new Date(expiresAt) > now;
      });
      if (!activePromo) return null;
      return { credit_amount: Number(activePromo.credit_amount ?? 0), expires_at: activePromo.promo_codes?.expires_at ?? null };
    },
    enabled: !!profile?.id,
  });

  const tickerEntries = useMemo<TickerEntry[]>(
    () => (data?.ticker ?? [])
      .filter((t: any) => t.nba_players?.ticker_handle && t.price_change_pct_24h != null)
      .map((t: any) => ({
        ticker: t.nba_players.ticker_handle,
        price: Number(t.current_price),
        pctChange: Number(t.price_change_pct_24h ?? 0),
      })),
    [data?.ticker]
  );

  const liveGames = games.filter((g: any) => g.status === 'live');
  const upcomingGames = games.filter((g: any) => !['live', 'final', 'completed'].includes(g.status));
  const completedGames = games.filter((g: any) => ['final', 'completed'].includes(g.status));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />
      <Ticker entries={tickerEntries} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={HG.sky} />}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* â”€â”€ Greeting + Stats Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 4 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 28, color: HG.ink, letterSpacing: -0.4 }}>
            {greeting(profile?.display_name ?? profile?.username ?? 'Baller')}
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, marginTop: 2 }}>
            {games.length > 0
              ? `${liveGames.length > 0 ? `${liveGames.length} game${liveGames.length > 1 ? 's' : ''} live Â· ` : ''}${upcomingGames.length} upcoming tonight`
              : 'No games tonight'}
          </Text>
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 18, marginTop: 14, gap: 8 }}>
          <StatPill
            label="Balance"
            value={fmtPrice(wallet?.balance ?? 0)}
            accent={HG.sky}
            onPress={() => router.push('/wallet' as any)}
          />
          <StatPill
            label="Record"
            value={`${record?.wins ?? 0}W Â· ${record?.losses ?? 0}L`}
            accent={HG.up}
          />
          <StatPill
            label="Earnings"
            value={fmtPrice(record?.earnings ?? 0)}
            accent={(record?.earnings ?? 0) >= 0 ? HG.up : HG.down}
          />
        </View>

        {/* â”€â”€ Promos banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {promoCredit && Number(promoCredit.credit_amount) > 0 && (
          <Pressable
            onPress={() => router.push('/promos' as any)}
            style={{
              marginHorizontal: 18, marginTop: 12,
              paddingHorizontal: 16, paddingVertical: 12,
              backgroundColor: HG.up + '14', borderRadius: 14,
              borderWidth: 1, borderColor: HG.up + '33',
              flexDirection: 'row', alignItems: 'center', gap: 10,
            }}
          >
            <Text style={{ fontSize: 16 }}>ðŸŽ</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.2, color: HG.up, textTransform: 'uppercase' }}>
                Promo Credit Available
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.ink, marginTop: 2 }}>
                {fmtPrice(promoCredit.credit_amount)}{promoCredit.expires_at ? ` Â· expires ${new Date(promoCredit.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
              </Text>
            </View>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={HG.up} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m9 18 6-6-6-6" />
            </Svg>
          </Pressable>
        )}

        {/* â”€â”€ Active / Pending matchup card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeMatchup && (
          <Pressable
            onPress={() => router.push(activeMatchup.status === 'pending' ? '/matchup/create' as any : `/matchup/${activeMatchup.id}` as any)}
            style={{
              marginHorizontal: 18, marginTop: 14,
              padding: 18,
              backgroundColor: HG.surface,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: activeMatchup.status === 'pending' ? HG.skyEdge : HG.sky + '55',
              overflow: 'hidden',
            }}
          >
            {activeMatchup.status === 'pending' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HG.muted }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.2, color: HG.muted, textTransform: 'uppercase' }}>
                    Searching for opponent
                  </Text>
                  <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.ink2, marginTop: 2 }}>
                    Wager {fmtPrice(activeMatchup.settled_wager ?? activeMatchup.pot_amount)} Â· In queue
                  </Text>
                </View>
                <ActivityIndicator size="small" color={HG.sky} />
              </View>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HG.sky }} />
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.4, color: HG.sky, textTransform: 'uppercase' }}>
                    {activeMatchup.status === 'matched' ? 'Matchup Confirmed' : 'Live Matchup'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  {(['You', 'Opp'] as const).map((label, i) => {
                    const meIs1 = activeMatchup.user1_id === profile?.id;
                    const score = Number(
                      i === 0
                        ? (meIs1 ? (activeMatchup.user1_final_score ?? activeMatchup.user1_score) : (activeMatchup.user2_final_score ?? activeMatchup.user2_score))
                        : (meIs1 ? (activeMatchup.user2_final_score ?? activeMatchup.user2_score) : (activeMatchup.user1_final_score ?? activeMatchup.user1_score))
                    );
                    return (
                      <View key={label} style={{ alignItems: i === 0 ? 'flex-start' : 'flex-end', flex: 1 }}>
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
                        <Text style={{ fontFamily: FONT.hero, fontSize: 48, color: HG.ink, lineHeight: 52, marginTop: 2 }}>
                          {score.toFixed(1)}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={{ paddingHorizontal: 16, alignItems: 'center' }}>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>vs</Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.sky, marginTop: 4 }}>{fmtPrice(activeMatchup.pot_amount)}</Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 0.8, textTransform: 'uppercase' }}>pot</Text>
                  </View>
                </View>
              </>
            )}
          </Pressable>
        )}

        {/* â”€â”€ Quick Action CTAs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 18, marginTop: 14, gap: 10 }}>
          <Pressable
            onPress={() => router.push('/(tabs)/lineup' as any)}
            style={{
              flex: 1, height: 52, borderRadius: 14,
              backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row', gap: 8,
            }}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.jet} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 5v14M5 12h14" />
            </Svg>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Build Lineup
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/matchups' as any)}
            style={{
              flex: 1, height: 52, borderRadius: 14,
              backgroundColor: HG.surface, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: HG.hairline2,
              flexDirection: 'row', gap: 8,
            }}
          >
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </Svg>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.ink2, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              My Matchups
            </Text>
          </Pressable>
        </View>

        {/* â”€â”€ Tonight's Games â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={{ marginTop: 28 }}>
          <View style={{ paddingHorizontal: 18, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
                Tonight's Games
              </Text>
              <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, marginTop: 1 }}>
                {liveGames.length > 0 ? (
                  <><Text style={{ color: HG.sky }}>{liveGames.length} Live</Text>{upcomingGames.length > 0 ? ` Â· ${upcomingGames.length} upcoming` : ''}</>
                ) : (
                  `${games.length} ${games.length === 1 ? 'game' : 'games'}`
                )}
              </Text>
            </View>
            {games.length > 0 && (
              <Pressable
                onPress={() => router.push('/(tabs)/lineup' as any)}
                style={{ paddingHorizontal: 14, height: 32, borderRadius: 999, backgroundColor: HG.skySoft, borderWidth: 1, borderColor: HG.skyEdge, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.sky, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  Pick Players
                </Text>
              </Pressable>
            )}
          </View>

          {isLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
          ) : games.length === 0 ? (
            <View style={{ marginHorizontal: 18, padding: 24, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center' }}>No games scheduled tonight.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 18, gap: 8 }}>
              {liveGames.map((g: any) => <GameCard key={g.id} game={g} onPress={() => router.push('/(tabs)/lineup' as any)} />)}
              {upcomingGames.map((g: any) => <GameCard key={g.id} game={g} onPress={() => router.push('/(tabs)/lineup' as any)} />)}
              {completedGames.map((g: any) => <GameCard key={g.id} game={g} onPress={() => router.push('/(tabs)/lineup' as any)} />)}
            </View>
          )}
        </View>

        {/* â”€â”€ Trending Players â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {trendingData && trendingData.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={{ paddingHorizontal: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>Trending</Text>
                <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, marginTop: 1 }}>
                  Players
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 18 }}>
                {TRENDING_RANGE_OPTIONS.map((option) => {
                  const active = trendingRange === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setTrendingRange(option.key)}
                      style={{
                        height: 28, paddingHorizontal: 12, borderRadius: 999,
                        backgroundColor: active ? HG.skySoft : HG.surface,
                        borderWidth: 1, borderColor: active ? HG.skyEdge : HG.hairline,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: active ? FONT.monoBold : FONT.monoMedium, fontSize: 10, letterSpacing: 0.7, color: active ? HG.sky : HG.muted }}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 10 }}>
              {trendingData.map((t: any) => {
                const p = t.nba_players;
                const pct = Number(t.price_change_pct_24h ?? 0);
                const color = priceDirectionColor(pct);
                return (
                  <Pressable
                    key={t.player_id}
                    onPress={() => router.push(`/player/${p.id}` as any)}
                    style={{ width: 156, padding: 14, backgroundColor: HG.surface, borderRadius: 16, borderWidth: 1, borderColor: HG.hairline, gap: 12 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>{p.full_name}</Text>
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 1 }}>{p.team_abbreviation} Â· {p.position}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: HG.ink }}>{fmtPrice(t.current_price)}</Text>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: color + '18' }}>
                        <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color, letterSpacing: 0.4 }}>{fmtPct(pct)}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* â”€â”€ Yesterday's Breakout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {data?.breakout && (
          <BreakoutHero
            row={data.breakout}
            onPress={() => router.push(`/player/${(data.breakout as any).nba_players.id}` as any)}
          />
        )}

        {/* â”€â”€ Recent Results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {recentResults && recentResults.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={{ paddingHorizontal: 18, marginBottom: 12 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>Recent Results</Text>
              <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, marginTop: 1 }}>My Matchups</Text>
            </View>
            <View style={{ paddingHorizontal: 18, gap: 8 }}>
              {recentResults.map((m: any) => {
                const won = m.winner_user_id === profile?.id;
                const tied = !m.winner_user_id;
                const opp = m.user1_id === profile?.id ? m.u2 : m.u1;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => router.push(`/matchup/${m.id}` as any)}
                    style={{
                      padding: 16, backgroundColor: HG.surface, borderRadius: 14,
                      borderWidth: 1, borderColor: won ? HG.up + '33' : tied ? HG.hairline : HG.loss,
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: won ? HG.up + '18' : tied ? HG.surface : HG.surfaceRaised,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontSize: 16 }}>{won ? 'ðŸ†' : tied ? 'ðŸ¤' : 'ðŸ’€'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
                        vs {opp?.display_name ?? opp?.username ?? 'Opponent'}
                      </Text>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, marginTop: 2 }}>
                        {won ? `+${fmtPrice(Number(m.payout_amount) - Number(m.settled_wager))}` : tied ? 'Tie' : `-${fmtPrice(m.settled_wager)}`}
                        {m.completed_at ? ` Â· ${new Date(m.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                      </Text>
                    </View>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: won ? HG.up + '18' : tied ? HG.surface : HG.surfaceRaised }}>
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: won ? HG.up : HG.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                        {won ? 'Win' : tied ? 'Tie' : 'Loss'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => router.push('/(tabs)/matchups' as any)}
                style={{ alignItems: 'center', paddingVertical: 10 }}
              >
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.sky, letterSpacing: 1, textTransform: 'uppercase' }}>
                  View All Matchups â†’
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// STAT PILL
// =============================================================================
function StatPill({ label, value, accent, onPress }: { label: string; value: string; accent: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, paddingVertical: 12, paddingHorizontal: 14,
        backgroundColor: HG.surface, borderRadius: 14,
        borderWidth: 1, borderColor: HG.hairline,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: accent, letterSpacing: 0.4 }}>{value}</Text>
    </Pressable>
  );
}

// =============================================================================
// GAME CARD â€” improved with full team names & score layout
// =============================================================================
function GameCard({ game, onPress }: { game: any; onPress: () => void }) {
  const isLive = game.status === 'live';
  const isFinal = ['final', 'completed'].includes(game.status);
  const hasScore = (isLive || isFinal) && game.home_score != null && game.away_score != null;

  // Determine winner for styling
  const homeWon = isFinal && game.home_score > game.away_score;
  const awayWon = isFinal && game.away_score > game.home_score;

  return (
    <Pressable
      onPress={onPress}
      style={{
        padding: 0, backgroundColor: HG.surface, borderRadius: 16,
        borderColor: isLive ? HG.sky + '44' : HG.hairline, borderWidth: 1,
        overflow: 'hidden',
      }}
    >
      {/* Status bar */}
      <View style={{
        paddingHorizontal: 14, paddingVertical: 7,
        backgroundColor: isLive ? HG.sky + '14' : HG.surfaceRaised,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderBottomWidth: 1, borderBottomColor: HG.hairline,
      }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          NBA - {game.game_date}
        </Text>
        {isLive ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: HG.sky }} />
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, color: HG.sky, letterSpacing: 1 }}>
              LIVE Q{game.period}{game.game_clock ? ` ${game.game_clock}` : ''}
            </Text>
          </View>
        ) : isFinal ? (
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, color: HG.muted, letterSpacing: 1 }}>FINAL</Text>
        ) : (
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 0.8 }}>
            {fmtTime(game.tip_off_time)}
          </Text>
        )}
      </View>

      {/* Teams & scores */}
      <View style={{ padding: 14, gap: 10 }}>
        {[
          { abbr: game.away_team_abbreviation, score: game.away_score, won: awayWon },
          { abbr: game.home_team_abbreviation, score: game.home_score, won: homeWon },
        ].map((team, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: HG.surfaceRaised,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: HG.hairline,
              }}>
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, color: HG.ink, letterSpacing: 0.4 }}>
                  {team.abbr}
                </Text>
              </View>
              <View>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: team.won ? HG.ink : isFinal ? HG.muted : HG.ink }}>
                  {team.abbr ?? 'â€”'}
                </Text>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted2, marginTop: 1 }}>
                  {i === 0 ? 'Away' : 'Home'}
                </Text>
              </View>
            </View>
            {hasScore && (
              <Text style={{
                fontFamily: team.won ? FONT.monoBold : FONT.monoMedium,
                fontSize: 22, color: team.won ? HG.ink : HG.muted,
                letterSpacing: -0.5,
              }}>
                {team.score}
              </Text>
            )}
          </View>
        ))}
      </View>

      {/* Pick players button */}
      {!isFinal && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <View style={{ height: 1, backgroundColor: HG.hairline, marginBottom: 10 }} />
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
            Tap to pick players â†’
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// =============================================================================
// BREAKOUT HERO
// =============================================================================
function BreakoutHero({ row, onPress }: { row: any; onPress: () => void }) {
  const p = row.nba_players;
  return (
    <Pressable
      onPress={onPress}
      style={{ marginHorizontal: 18, marginTop: 28, marginBottom: 4, padding: 22, borderRadius: 20, backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, overflow: 'hidden' }}
    >
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 14 }}>
        Yesterday's Top Performer
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={60} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, lineHeight: 28, letterSpacing: -0.4 }}>{p.full_name}</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.sky, letterSpacing: 0.6, marginTop: 4 }}>
            {p.team_abbreviation} Â· {p.position}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: FONT.hero, fontSize: 52, color: HG.ink, lineHeight: 56 }}>{fmtFP(row.fantasy_points)}</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase' }}>FPTS</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 0, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: HG.hairline }}>
        {[
          { label: 'PTS', value: row.points ?? 0 },
          { label: 'REB', value: row.rebounds ?? 0 },
          { label: 'AST', value: row.assists ?? 0 },
          { label: 'STL', value: row.steals ?? 0 },
          { label: 'BLK', value: row.blocks ?? 0 },
        ].map((stat, i) => (
          <View
            key={stat.label}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              backgroundColor: i % 2 === 0 ? HG.surfaceRaised : HG.surface,
              borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: HG.hairline,
            }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: HG.ink }}>{stat.value}</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase', marginTop: 3 }}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
