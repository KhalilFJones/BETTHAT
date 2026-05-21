// =============================================================================
// BETTHAT — Home (Holy Grail V2, Screen 03)
// The hub. Live ticker, yesterday's breakout, trending players, tonight's games.
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
import { SectionHead } from '@/components/holygrail/SectionHead';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

const TRENDING_RANGE_OPTIONS = [
  { key: '1h',      label: '1h' },
  { key: '4h',      label: '4h' },
  { key: '24h',     label: '24h' },
  { key: '7d',      label: '7 days' },
  { key: 'alltime', label: 'All time' },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { profile, wallet } = useAuthStore();
  const [trendingRange, setTrendingRange] = useState<'1h' | '4h' | '24h' | '7d' | 'alltime'>('1h');

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['home', profile?.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Find the most recent game date ≤ today so we don't show empty state
      // when data hasn't been refreshed for a day or two.
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
          .select(`
            current_price, price_change_pct_24h,
            nba_players!inner(ticker_handle, last_name)
          `)
          .order('demand_count_1h', { ascending: false })
          .limit(20),

        supabase
          .from('nba_games')
          .select('*')
          .eq('game_date', slateDate)
          .order('tip_off_time', { ascending: true }),

        supabase
          .from('player_game_stats')
          .select(`
            fantasy_points, points, rebounds, assists,
            nba_players!inner(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation),
            nba_games!inner(game_date)
          `)
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

  // ── Live game scores — polls every 1 second when a game is live ──────────
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

  // Merge live scores into the static game list (live scores override stale values)
  type LiveScore = { id: string; status: string; period: number | null; game_clock: string | null; home_score: number | null; away_score: number | null };
  const liveScoreMap = useMemo(() => {
    const m = new Map<string, LiveScore>();
    for (const g of (liveScores ?? [])) m.set(g.id, g);
    return m;
  }, [liveScores]);

  const games = useMemo(
    () =>
      (data?.games ?? []).map((g: any) => {
        const live = liveScoreMap.get(g.id);
        if (!live) return g;
        return { ...g, status: live.status, period: live.period, game_clock: live.game_clock, home_score: live.home_score, away_score: live.away_score };
      }),
    [data?.games, liveScoreMap],
  );

  const { data: trendingData } = useQuery({
    queryKey: ['home-trending', trendingRange, profile?.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: todayPlayers } = await supabase
        .from('player_game_availability')
        .select('player_id')
        .eq('game_date', today)
        .eq('is_draftable', true);

      const todayIds = (todayPlayers ?? []).map((row) => row.player_id);

      // Base query — filter to today's players if available, otherwise show all active players
      let q = supabase
        .from('player_prices')
        .select(`
          player_id, current_price, price_change_pct_24h, demand_count_1h, demand_count_4h, total_selections,
          nba_players!inner(id, full_name, first_name, last_name, jersey_number, team_abbreviation, position, is_active)
        `)
        .eq('nba_players.is_active', true);

      if (todayIds.length > 0) {
        q = q.in('player_id', todayIds);
      }

      if (trendingRange === '1h') {
        const { data } = await q
          .order('demand_count_1h', { ascending: false })
          .limit(12);
        return data ?? [];
      }

      if (trendingRange === '4h') {
        // Use demand_count_4h if available, otherwise fall back to demand_count_1h * 4 approximation
        const { data } = await q
          .order('demand_count_1h', { ascending: false })
          .limit(20);
        return (data ?? [])
          .sort((a: any, b: any) =>
            Number(b.demand_count_4h ?? b.demand_count_1h ?? 0) -
            Number(a.demand_count_4h ?? a.demand_count_1h ?? 0)
          )
          .slice(0, 12);
      }

      if (trendingRange === '24h') {
        const { data } = await q.order('price_change_pct_24h', { ascending: false });
        return (data ?? [])
          .sort((a: any, b: any) => Math.abs(Number(b.price_change_pct_24h ?? 0)) - Math.abs(Number(a.price_change_pct_24h ?? 0)))
          .slice(0, 12);
      }

      if (trendingRange === '7d') {
        // 7-day trending = highest total_selections (all-time demand across a week window)
        const { data } = await q
          .order('total_selections', { ascending: false })
          .limit(12);
        return data ?? [];
      }

      // alltime
      const { data } = await q
        .order('total_selections', { ascending: false })
        .limit(12);
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  // Active matchup query (polls every 30s)
  const { data: activeMatchup } = useQuery({
    queryKey: ['home-active-matchup', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('matchups')
        .select('id, status, user1_score, user2_score, user1_final_score, user2_final_score, user1_id, pot_amount')
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .in('status', ['matched', 'in_progress', 'live'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  // Active promo balance query
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
      return {
        credit_amount: Number(activePromo.credit_amount ?? 0),
        expires_at: activePromo.promo_codes?.expires_at ?? null,
      } as { credit_amount: number; expires_at: string | null };
    },
    enabled: !!profile?.id,
  });

  const tickerEntries = useMemo<TickerEntry[]>(
    () =>
      (data?.ticker ?? [])
        .filter((t: any) => t.nba_players?.ticker_handle && t.price_change_pct_24h != null)
        .map((t: any) => ({
          ticker: t.nba_players.ticker_handle,
          price: Number(t.current_price),
          pctChange: Number(t.price_change_pct_24h ?? 0),
        })),
    [data?.ticker]
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />
      <Ticker entries={tickerEntries} />

      {/* Active matchup banner */}
      {activeMatchup && (
        <Pressable
          onPress={() => router.push(`/matchup/${activeMatchup.id}` as any)}
          style={{
            marginHorizontal: 18, marginTop: 10, marginBottom: 2,
            paddingHorizontal: 16, paddingVertical: 12,
            backgroundColor: HG.sky + '18', borderRadius: 14,
            borderWidth: 1, borderColor: HG.sky + '55',
            flexDirection: 'row', alignItems: 'center',
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HG.sky, marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.2, color: HG.sky, textTransform: 'uppercase' }}>
              Live Matchup
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.ink, marginTop: 2 }}>
              {(() => {
                const meIs1 = activeMatchup.user1_id === profile?.id;
                const myScore = Number(meIs1 ? (activeMatchup.user1_final_score ?? activeMatchup.user1_score) : (activeMatchup.user2_final_score ?? activeMatchup.user2_score));
                const oppScore = Number(meIs1 ? (activeMatchup.user2_final_score ?? activeMatchup.user2_score) : (activeMatchup.user1_final_score ?? activeMatchup.user1_score));
                return `You ${myScore.toFixed(1)} · Opp ${oppScore.toFixed(1)}  ·  ${fmtPrice(activeMatchup.pot_amount)} pot`;
              })()}
            </Text>
          </View>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.sky} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m9 18 6-6-6-6" />
          </Svg>
        </Pressable>
      )}

      {/* Promo credit banner */}
      {promoCredit && Number(promoCredit.credit_amount) > 0 && (
        <View style={{
          marginHorizontal: 18, marginTop: 8, marginBottom: 2,
          paddingHorizontal: 16, paddingVertical: 12,
          backgroundColor: HG.up + '18', borderRadius: 14,
          borderWidth: 1, borderColor: HG.up + '44',
          flexDirection: 'row', alignItems: 'center',
        }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, letterSpacing: 1.2, color: HG.up, marginRight: 6 }}>🎁</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.2, color: HG.up, textTransform: 'uppercase' }}>
              Promo Credit
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.ink, marginTop: 2 }}>
              {fmtPrice(promoCredit.credit_amount)} available{promoCredit.expires_at ? ` · expires ${new Date(promoCredit.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={HG.sky} />}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* Hero — Yesterday's breakout */}
        {isLoading ? (
          <View style={{ padding: 80, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
        ) : data?.breakout ? (
          <BreakoutHero row={data.breakout} onPress={() => router.push(`/player/${(data.breakout as any).nba_players.id}` as any)} />
        ) : null}

        {/* Trending */}
        {trendingData && trendingData.length > 0 ? (
          <>
            <SectionHead
              word=""
              emphasis="Trending"
              emphasisFirst
              label={TRENDING_RANGE_OPTIONS.find((option) => option.key === trendingRange)?.label ?? '1h'}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 8, gap: 8 }}
            >
              {TRENDING_RANGE_OPTIONS.map((option) => {
                const active = trendingRange === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setTrendingRange(option.key)}
                    style={{
                      height: 30,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: active ? HG.skySoft : HG.surface,
                      borderWidth: 1,
                      borderColor: active ? HG.skyEdge : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: active ? FONT.monoBold : FONT.monoMedium, fontSize: 10, letterSpacing: 0.7, color: active ? HG.sky : HG.muted }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingBottom: 4 }}
            >
              {trendingData.map((t: any) => {
                const p = t.nba_players;
                return (
                  <Pressable
                    key={t.player_id}
                    onPress={() => router.push(`/player/${p.id}` as any)}
                    style={{
                      width: 168,
                      padding: 14,
                      backgroundColor: HG.surface,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: HG.hairline,
                      gap: 10,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
                          {p.full_name}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: HG.ink }}>{fmtPrice(t.current_price)}</Text>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: priceDirectionColor(t.price_change_pct_24h) }}>
                        {fmtPct(t.price_change_pct_24h)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {/* Active Games */}
        <SectionHead word="Tonight's" emphasis="games" label={`${games.length}`} />
        <View style={{ paddingHorizontal: 18, gap: 8 }}>
          {games.map((g: any) => (
            <GameRow key={g.id} game={g} onPress={() => router.push('/(tabs)/lineup' as any)} />
          ))}
          {!isLoading && games.length === 0 ? (
            <View style={{ padding: 24, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center' }}>
                No games scheduled tonight.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// BREAKOUT HERO
// =============================================================================
function BreakoutHero({ row, onPress }: { row: any; onPress: () => void }) {
  const p = row.nba_players;
  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: 18, marginTop: 22, marginBottom: 8, padding: 24, borderRadius: 20, backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, overflow: 'hidden' }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 10 }}>
        Yesterday's breakout
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 26, color: HG.ink, lineHeight: 30, letterSpacing: -0.4 }}>
            {p.full_name}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.sky, letterSpacing: 0.6, marginTop: 4 }}>
            {p.team_abbreviation} · {p.position}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 22 }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 56, color: HG.ink, letterSpacing: -1 }}>
          {fmtFP(row.fantasy_points)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          fantasy total
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
        <Stat label="PTS" value={String(row.points ?? 0)} />
        <Stat label="REB" value={String(row.rebounds ?? 0)} />
        <Stat label="AST" value={String(row.assists ?? 0)} />
      </View>
    </Pressable>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: HG.ink, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

// =============================================================================
// GAME ROW
// =============================================================================
function GameRow({ game, onPress }: { game: any; onPress: () => void }) {
  const live = game.status === 'live';
  return (
    <Pressable onPress={onPress} style={{ padding: 16, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: HG.ink, letterSpacing: 0.6 }}>
            {game.away_team_abbreviation}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>@</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: HG.ink, letterSpacing: 0.6 }}>
            {game.home_team_abbreviation}
          </Text>
        </View>
        {live ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: HG.sky }} />
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 0.8 }}>
              LIVE Q{game.period} {game.game_clock}
            </Text>
          </View>
        ) : game.status === 'final' ? (
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.8 }}>FINAL</Text>
        ) : (
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.4 }}>
            {fmtTime(game.tip_off_time)}
          </Text>
        )}
      </View>
      {(live || game.status === 'final') && game.home_score != null && game.away_score != null ? (
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: HG.ink2, marginTop: 6 }}>
          {game.away_score}  —  {game.home_score}
        </Text>
      ) : null}
    </Pressable>
  );
}
