// =============================================================================
// BETTHAT — Home (Holy Grail V2, Screen 03)
// The hub. Live ticker, yesterday's breakout, trending players, tonight's games.
// =============================================================================

import { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtPct, fmtFP, fmtTime,
  priceDirectionColor, playerInitials, playerLastName,
} from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { Ticker, type TickerEntry } from '@/components/holygrail/Ticker';
import { SectionHead } from '@/components/holygrail/SectionHead';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

export default function HomeScreen() {
  const router = useRouter();
  const { profile, wallet } = useAuthStore();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['home', profile?.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

      const [tickerQ, gamesQ, breakoutQ, trendingQ] = await Promise.all([
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
          .eq('game_date', today)
          .order('tip_off_time', { ascending: true }),

        supabase
          .from('player_game_stats')
          .select(`
            fantasy_points, points, rebounds, assists,
            nba_players!inner(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation),
            nba_games!inner(game_date)
          `)
          .eq('nba_games.game_date', yesterday)
          .order('fantasy_points', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('player_prices')
          .select(`
            player_id, current_price, price_change_pct_24h, demand_count_1h,
            nba_players!inner(id, full_name, first_name, last_name, ticker_handle, jersey_number, team_abbreviation, position)
          `)
          .order('demand_count_1h', { ascending: false })
          .limit(8),
      ]);

      return {
        ticker: tickerQ.data ?? [],
        games: gamesQ.data ?? [],
        breakout: breakoutQ.data,
        trending: trendingQ.data ?? [],
      };
    },
    enabled: !!profile?.id,
    refetchInterval: 60_000,
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
        {data?.trending && data.trending.length > 0 ? (
          <>
            <SectionHead word="" emphasis="Trending" emphasisFirst label="Last 4h" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingBottom: 4 }}
            >
              {data.trending.slice(0, 6).map((t: any) => {
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
                          {playerLastName(p)}
                        </Text>
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4, marginTop: 2 }}>
                          {p.ticker_handle ?? ''}
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
        <SectionHead word="Tonight's" emphasis="games" label={`${data?.games?.length ?? 0}`} />
        <View style={{ paddingHorizontal: 18, gap: 8 }}>
          {(data?.games ?? []).map((g: any) => (
            <GameRow key={g.id} game={g} onPress={() => router.push('/(tabs)/lineup' as any)} />
          ))}
          {!isLoading && (data?.games ?? []).length === 0 ? (
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
            {p.ticker_handle ?? ''} · {p.team_abbreviation} · {p.position}
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
