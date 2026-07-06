// =============================================================================
// BETTHAT — Player Market (Holy Grail V2, Screen 04)
// The trading floor. Browse every player playing tonight, watch prices move,
// build a lineup of 3 within the $500 cap.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtPct, priceDirectionColor,
  playerInitials, playerLastName, SALARY_CAP, LINEUP_SIZE,
} from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { Ticker, type TickerEntry } from '@/components/holygrail/Ticker';
import { SectionHead } from '@/components/holygrail/SectionHead';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import { Sparkline } from '@/components/holygrail/Sparkline';
import {
  usePlayerMarket,
  useLivePlayerStats,
  useUpcomingSlates,
  type PlayerMarketRow,
  type TrendingRow,
  type InProgressLineup,
} from '@/hooks/holygrail/usePlayerMarket';
import { recomputeLineupCap } from '@/hooks/holygrail/lineupOps';

const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = (typeof POSITIONS)[number];

// Price filter buckets — UI only. Values are inclusive lower / exclusive upper.
const PRICE_BUCKETS = [
  { key: 'any',     label: 'Any',         lo: 0,   hi: Infinity },
  { key: 'lt50',    label: 'Under $50',   lo: 0,   hi: 50 },
  { key: '50to100', label: '$50–$100',    lo: 50,  hi: 100 },
  { key: '100to150',label: '$100–$150',   lo: 100, hi: 150 },
  { key: 'gt150',   label: 'Over $150',   lo: 150, hi: Infinity },
] as const;
type PriceBucketKey = (typeof PRICE_BUCKETS)[number]['key'];

const SORT_OPTIONS = [
  { key: 'price', label: 'Price ↓' },
  { key: 'fpts', label: 'FPTS' },
  { key: 'name', label: 'A–Z' },
  { key: 'trending', label: 'Trending 🔥' },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

// Price direction filter
const TREND_OPTIONS = [
  { key: 'all',     label: 'All' },
  { key: 'rising',  label: '↑ Rising' },
  { key: 'falling', label: '↓ Falling' },
] as const;
type TrendKey = (typeof TREND_OPTIONS)[number]['key'];

export default function PlayerMarketScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();
  const userId = profile?.id;

  const today = new Date().toISOString().slice(0, 10);
  // 'today' or 'upnext'
  const [activeTab, setActiveTab] = useState<'today' | 'upnext'>('today');

  const { data: slates } = useUpcomingSlates();

  // Derive selected slate date from the active tab
  const todaySlate = slates?.find((s) => s.label === 'Today');
  const upNextSlate = slates?.find((s) => s.label === 'Up Next');
  const selectedSlate = activeTab === 'upnext' && upNextSlate
    ? upNextSlate.game_date
    : today;

  const { data, isLoading, isRefetching, refetch } = usePlayerMarket(userId, selectedSlate);

  // Auto-switch to Up Next if today has no playable players
  useEffect(() => {
    if (!slates || slates.length === 0) return;
    if ((data?.tonight ?? []).length === 0 && activeTab === 'today' && upNextSlate) {
      setActiveTab('upnext');
    }
  }, [slates, data?.tonight]);

  // Live stats — polls every 1 second when games are live
  const tonightIds = useMemo(() => (data?.tonight ?? []).map((p) => p.id), [data?.tonight]);
  const { data: liveStats } = useLivePlayerStats(tonightIds);

  const [position, setPosition] = useState<Position>('ALL');
  const [priceBucket, setPriceBucket] = useState<PriceBucketKey>('any');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('price');
  const [search, setSearch] = useState('');
  const [trendFilter, setTrendFilter] = useState<TrendKey>('all');
  const [hideInjured, setHideInjured] = useState(false);

  const lineup = data?.lineup ?? null;
  const pickedIds = useMemo(() => {
    const s = new Set<string>();
    if (lineup) for (const lp of lineup.lineup_players) s.add(lp.nba_players.id);
    return s;
  }, [lineup]);

  const teams = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of (data?.tonight ?? [])) {
      if (!seen.has(p.team_abbreviation)) {
        seen.add(p.team_abbreviation);
        list.push(p.team_abbreviation);
      }
    }
    return list.sort();
  }, [data?.tonight]);

  // Filter + sort
  const players = useMemo(() => {
    if (!data?.tonight) return [];
    const q = search.trim().toLowerCase();
    const bucket = PRICE_BUCKETS.find((b) => b.key === priceBucket)!;
    return data.tonight
      .filter((p) => p.player_prices != null)
      .filter((p) => {
        if (position !== 'ALL' && p.position !== position) return false;
        if (teamFilter !== 'ALL' && p.team_abbreviation !== teamFilter) return false;
        if (q && !`${p.full_name} ${p.team_abbreviation}`.toLowerCase().includes(q)) return false;
        const price = Number(p.player_prices!.current_price);
        if (price < bucket.lo || price >= bucket.hi) return false;
        // Injury filter
        if (hideInjured && p.is_injured) return false;
        // Price trend direction filter
        if (trendFilter === 'rising' && Number(p.player_prices!.price_change_pct_24h ?? 0) <= 0) return false;
        if (trendFilter === 'falling' && Number(p.player_prices!.price_change_pct_24h ?? 0) >= 0) return false;
        return true;
      })
      .sort((a, b) => {
        const al = a.player_prices!.is_locked ? 1 : 0;
        const bl = b.player_prices!.is_locked ? 1 : 0;
        if (al !== bl) return al - bl;
        if (sortBy === 'price') return Number(b.player_prices!.current_price) - Number(a.player_prices!.current_price);
        if (sortBy === 'fpts') return Number(b.last5_avg_fpts ?? 0) - Number(a.last5_avg_fpts ?? 0);
        if (sortBy === 'trending') return Number(b.player_prices!.demand_count_1h ?? 0) - Number(a.player_prices!.demand_count_1h ?? 0);
        return (a.full_name ?? '').localeCompare(b.full_name ?? '');
      });
  }, [data?.tonight, position, teamFilter, priceBucket, search, sortBy, trendFilter, hideInjured]);

  // Ticker = top 16 absolute movers in tonight's slate
  const tickerEntries = useMemo<TickerEntry[]>(() => {
    if (!data?.tonight) return [];
    return data.tonight
      .filter((p) => p.player_prices?.price_change_pct_24h != null)
      .map((p) => ({
        ticker: p.full_name || `${p.first_name} ${p.last_name}`,
        price: Number(p.player_prices!.current_price),
        pctChange: Number(p.player_prices!.price_change_pct_24h ?? 0),
      }))
      .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
      .slice(0, 16);
  }, [data?.tonight]);

  // Add / remove player mutation
  const addMutation = useMutation({
    mutationFn: async (vars: { player: PlayerMarketRow; price: number }) => {
      if (!userId) throw new Error('Not signed in');
      const lineupId = await ensureBuildingLineup(userId, lineup, selectedSlate);
      const usedSlots = new Set((lineup?.lineup_players ?? []).map((lp) => lp.slot_number));
      const nextSlot = [1, 2, 3].find((n) => !usedSlots.has(n));
      if (!nextSlot) throw new Error('Lineup full');
      const { error } = await supabase.from('lineup_players').insert({
        lineup_id: lineupId,
        player_id: vars.player.id,
        slot_number: nextSlot,
        frozen_price: vars.price,
      });
      if (error) throw error;
      // Always sum from the source of truth — never math on stale cache.
      await recomputeLineupCap(lineupId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-market'] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (playerId: string) => {
      if (!lineup) return;
      const { error } = await supabase
        .from('lineup_players')
        .delete()
        .eq('lineup_id', lineup.id)
        .eq('player_id', playerId);
      if (error) throw error;
      await recomputeLineupCap(lineup.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-market'] }),
  });

  const picked = lineup?.lineup_players ?? [];
  const isFull = picked.length >= LINEUP_SIZE;

  // Build projection map: playerId → last5_avg_fpts for sticky bar total
  const projMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of (data?.tonight ?? [])) {
      if (p.last5_avg_fpts != null) m.set(p.id, Number(p.last5_avg_fpts));
    }
    return m;
  }, [data?.tonight]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />
      <Ticker entries={tickerEntries} />

      <FlatList
        data={players}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={HG.sky}
            colors={[HG.sky]}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Today / Up Next tab toggle */}
            <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4 }}>
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: HG.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: HG.hairline,
                  overflow: 'hidden',
                }}
              >
                {/* Today tab */}
                <Pressable
                  onPress={() => setActiveTab('today')}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: activeTab === 'today' ? HG.sky : 'transparent',
                    borderRadius: 12,
                  }}
                >
                  <Text style={{
                    fontFamily: activeTab === 'today' ? FONT.monoBold : FONT.monoMedium,
                    fontSize: 12,
                    letterSpacing: 0.7,
                    color: activeTab === 'today' ? HG.jet : HG.muted,
                  }}>
                    {todaySlate?.has_live ? '🔴 LIVE' : 'Today'}
                  </Text>
                  {todaySlate && todaySlate.game_count > 0 && (
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: activeTab === 'today' ? HG.jet + 'cc' : HG.muted + '88', marginTop: 1 }}>
                      {todaySlate.game_count} game{todaySlate.game_count !== 1 ? 's' : ''}
                    </Text>
                  )}
                </Pressable>

                {/* Up Next tab */}
                {upNextSlate ? (
                  <Pressable
                    onPress={() => setActiveTab('upnext')}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: activeTab === 'upnext' ? HG.sky : 'transparent',
                      borderRadius: 12,
                    }}
                  >
                    <Text style={{
                      fontFamily: activeTab === 'upnext' ? FONT.monoBold : FONT.monoMedium,
                      fontSize: 12,
                      letterSpacing: 0.7,
                      color: activeTab === 'upnext' ? HG.jet : HG.muted,
                    }}>
                      Up Next
                    </Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: activeTab === 'upnext' ? HG.jet + 'cc' : HG.muted + '88', marginTop: 1 }}>
                      {upNextSlateLabel(upNextSlate.game_date)} · {upNextSlate.game_count}G
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Search */}
            <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  height: 44,
                  paddingHorizontal: 14,
                  gap: 10,
                  backgroundColor: HG.inputBg,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: HG.hairline,
                }}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
                  <Path d="m21 21-4.3-4.3" />
                </Svg>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search players..."
                  placeholderTextColor={HG.muted}
                  style={{
                    flex: 1,
                    color: HG.ink,
                    fontFamily: FONT.sans,
                    fontSize: 14,
                    height: '100%',
                    padding: 0,
                  }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* Position chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6, gap: 8 }}
            >
              {POSITIONS.map((p) => {
                const active = position === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setPosition(p)}
                    style={{
                      height: 32,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: active ? HG.sky : HG.surface,
                      borderWidth: 1,
                      borderColor: active ? HG.sky : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 11,
                        letterSpacing: 0.9,
                        color: active ? HG.jet : HG.muted,
                      }}
                    >
                      {p === 'ALL' ? 'All' : p}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Price filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 6, gap: 8 }}
            >
              {PRICE_BUCKETS.map((b) => {
                const active = priceBucket === b.key;
                return (
                  <Pressable
                    key={b.key}
                    onPress={() => setPriceBucket(b.key)}
                    style={{
                      height: 28,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      backgroundColor: active ? HG.skySoft : 'transparent',
                      borderWidth: 1,
                      borderColor: active ? HG.skyEdge : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: active ? HG.sky : HG.muted,
                      }}
                    >
                      {b.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Team filters */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 6, gap: 8 }}
            >
              {['ALL', ...teams].map((team) => {
                const active = teamFilter === team;
                return (
                  <Pressable
                    key={team}
                    onPress={() => setTeamFilter(team)}
                    style={{
                      height: 28,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      backgroundColor: active ? HG.skySoft : 'transparent',
                      borderWidth: 1,
                      borderColor: active ? HG.skyEdge : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: active ? HG.sky : HG.muted,
                      }}
                    >
                      {team === 'ALL' ? 'All Teams' : team}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Sort chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 4, gap: 8 }}
            >
              {SORT_OPTIONS.map((option) => {
                const active = sortBy === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setSortBy(option.key)}
                    style={{
                      height: 28,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      backgroundColor: active ? HG.skySoft : 'transparent',
                      borderWidth: 1,
                      borderColor: active ? HG.skyEdge : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: active ? HG.sky : HG.muted,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Price trend direction chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 4, gap: 8 }}
            >
              {TREND_OPTIONS.map((option) => {
                const active = trendFilter === option.key;
                const accent = option.key === 'rising' ? HG.up : option.key === 'falling' ? HG.down : null;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setTrendFilter(option.key)}
                    style={{
                      height: 28,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      backgroundColor: active && accent ? accent + '18' : active ? HG.skySoft : 'transparent',
                      borderWidth: 1,
                      borderColor: active && accent ? accent + '55' : active ? HG.skyEdge : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: active && accent ? accent : active ? HG.sky : HG.muted,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Injury & availability filters */}
            <View style={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setHideInjured((v) => !v)}
                style={{
                  height: 28,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: hideInjured ? HG.downSoft : 'transparent',
                  borderWidth: 1,
                  borderColor: hideInjured ? HG.down + '55' : HG.hairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: hideInjured ? FONT.monoBold : FONT.monoMedium, fontSize: 10, letterSpacing: 0.6, color: hideInjured ? HG.down : HG.muted }}>
                  {hideInjured ? 'Hiding OUT/INJ' : 'Show All'}
                </Text>
              </Pressable>
            </View>

            {/* Trending carousel */}
            {data?.trending && data.trending.length > 0 && position === 'ALL' && !search ? (
              <>
                <SectionHead word="" emphasis="Trending" emphasisFirst label={activeTab === 'today' ? 'Tonight' : 'Up Next'} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingBottom: 4 }}
                >
                  {data.trending.slice(0, 6).map((t) => (
                    <TrendCard key={t.player_id} row={t} onPress={() => router.push(`/player/${t.player_id}` as any)} />
                  ))}
                </ScrollView>
              </>
            ) : null}

            <SectionHead word="Playing" emphasis={activeTab === 'today' ? 'Tonight' : 'Up Next'} label={`${players.length} players`} />
          </View>
        }
        renderItem={({ item }) => (
          <PlayerRow
            player={item}
            sparkPrices={data?.history.get(item.id) ?? []}
            isPicked={pickedIds.has(item.id)}
            disabled={isFull && !pickedIds.has(item.id)}
            onAdd={() => addMutation.mutate({ player: item, price: Number(item.player_prices!.current_price) })}
            onRemove={() => removeMutation.mutate(item.id)}
            onTap={() => router.push(`/player/${item.id}` as any)}
          />
        )}
        contentContainerStyle={{ paddingBottom: lineup && picked.length > 0 ? 240 : 120 }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 60, alignItems: 'center' }}>
              <ActivityIndicator color={HG.sky} />
            </View>
          ) : (
            <View style={{ padding: 60 }}>
              <Text style={{ color: HG.muted, fontFamily: FONT.sans, fontSize: 13, textAlign: 'center' }}>
                No players match your filter.
              </Text>
            </View>
          )
        }
      />

      {/* Sticky lineup builder */}
      {picked.length > 0 ? (
        <StickyLineupBar
          lineup={lineup}
          projMap={projMap}
          onPlaceOrder={() => router.push('/matchup/create' as any)}
          onRemove={(playerId) => removeMutation.mutate(playerId)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

/** Returns a short date label for the Up Next tab sub-label, e.g. "Fri May 22" */
function upNextSlateLabel(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Tip-off time a player's price locks, e.g. "7:30 PM". Null if no scheduled tip. */
function fmtLockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Returns a human-readable label for the selected slate date. */
function slateLabel(date: string, today: string): string {
  if (date === today) return 'Tonight';
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (date === tomorrow) return 'Tomorrow';
  // e.g. "Thu May 22"
  const d = new Date(date + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function ensureBuildingLineup(userId: string, existing: InProgressLineup | null, slateDate: string): Promise<string> {
  if (existing?.id) return existing.id;
  // Create a new in-progress lineup. entry_tier must be a valid tier (1,5,10,20,50);
  // use 5 as a placeholder since max_wager is the authoritative wager source.
  const { data, error } = await supabase
    .from('lineups')
    .insert({
      user_id: userId,
      entry_tier: 5,
      status: 'building',
      total_cap_used: 0,
      game_date: slateDate,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// =============================================================================
// TRENDING CARD
// =============================================================================

function TrendCard({ row, onPress }: { row: TrendingRow; onPress: () => void }) {
  const p = row.nba_players;
  const dir = priceDirectionColor(row.price_change_pct_24h);
  return (
    <Pressable
      onPress={onPress}
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
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink, lineHeight: 16 }}>
            {p.full_name}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: HG.ink }}>
          {fmtPrice(row.current_price)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: dir }}>
          {fmtPct(row.price_change_pct_24h)}
        </Text>
      </View>
    </Pressable>
  );
}

// =============================================================================
// PLAYER ROW
// =============================================================================

function PlayerRow({
  player, sparkPrices, isPicked, disabled, liveFpts, onAdd, onRemove, onTap,
}: {
  player: PlayerMarketRow;
  sparkPrices: number[];
  isPicked: boolean;
  disabled: boolean;
  liveFpts?: number | null;
  onAdd: () => void;
  onRemove: () => void;
  onTap: () => void;
}) {
  const pp = player.player_prices!;
  const isLocked = pp.is_locked;
  // 'live' = price frozen because the game tipped off; 'injury' = OUT/inactive.
  const lockKind: 'live' | 'injury' | null = !isLocked
    ? null
    : pp.lock_reason === 'game_live'
      ? 'live'
      : 'injury';
  const lockLabel = lockKind === 'live' ? 'LOCKED' : 'OUT';
  const dirColor = priceDirectionColor(pp.price_change_pct_24h);
  const addLabel = isLocked ? (lockKind === 'live' ? 'Locked' : 'Out') : isPicked ? 'Added' : '+ Add';
  const addState: 'add' | 'added' | 'locked' = isLocked ? 'locked' : isPicked ? 'added' : 'add';
  const lockHint = !isLocked ? fmtLockTime(player.game_tip_off) : null;
  const isLive = liveFpts != null;
  const proj = isLive ? null : player.last5_avg_fpts != null ? Number(player.last5_avg_fpts).toFixed(1) : null;

  return (
    <Pressable
      onPress={onTap}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderColor: HG.hairline,
        opacity: isLocked ? 0.55 : 1,
      }}
    >
      <MonogramTile initials={playerInitials(player)} jersey={player.jersey_number} size={52} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: HG.ink, flexShrink: 1 }}
          >
            {player.full_name}
          </Text>
          {lockKind ? (
            <View style={{ backgroundColor: lockKind === 'live' ? HG.navySoft : HG.downSoft, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, color: lockKind === 'live' ? HG.muted : HG.down, letterSpacing: 0.6 }}>{lockLabel}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted }}>
            {player.team_abbreviation} · {player.position}
          </Text>
          {isLive ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: HG.upSoft, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 8, color: HG.up, letterSpacing: 0.6 }}>LIVE</Text>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.up }}>{Number(liveFpts).toFixed(1)}</Text>
            </View>
          ) : proj !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2 }}>proj</Text>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.ink2 }}>{proj}</Text>
            </View>
          ) : null}
          <DemandChip count={pp.demand_count_1h} />
          {lockHint ? (
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted2, letterSpacing: 0.4 }}>
              Locks {lockHint}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Sparkline prices={sparkPrices} width={48} height={20} />
        <View style={{ alignItems: 'flex-end', minWidth: 56 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: HG.ink }}>{fmtPrice(pp.current_price)}</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: dirColor, marginTop: 1 }}>
            {fmtPct(pp.price_change_pct_24h)}
          </Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            if (addState === 'locked') return;
            if (addState === 'added') onRemove();
            else if (!disabled) onAdd();
          }}
          disabled={disabled || isLocked}
          hitSlop={6}
          style={{
            height: 32,
            paddingHorizontal: 12,
            minWidth: 64,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: addState === 'added' ? HG.sky : HG.surface,
            borderWidth: 1,
            borderColor: addState === 'added' ? HG.sky : addState === 'locked' ? HG.hairline : HG.hairline2,
            opacity: disabled || isLocked ? 0.6 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: FONT.monoBold,
              fontSize: 11,
              letterSpacing: 0.9,
              color: addState === 'added' ? HG.jet : addState === 'locked' ? HG.muted2 : HG.ink2,
            }}
          >
            {addLabel}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// =============================================================================
// STICKY LINEUP BAR
// =============================================================================

function StickyLineupBar({
  lineup,
  projMap,
  onPlaceOrder,
  onRemove,
}: {
  lineup: InProgressLineup | null;
  projMap: Map<string, number>;
  onPlaceOrder: () => void;
  onRemove: (playerId: string) => void;
}) {
  const picked = lineup?.lineup_players ?? [];
  const capUsed = Number(lineup?.total_cap_used ?? 0);
  const capLeft = SALARY_CAP - capUsed;
  const remaining = LINEUP_SIZE - picked.length;
  const ready = remaining === 0;
  const slots = Array.from({ length: LINEUP_SIZE }, (_, i) => picked[i] ?? null);

  const totalProj = picked.reduce((sum, p) => sum + (projMap.get(p.nba_players.id) ?? 0), 0);
  const hasProj = picked.some((p) => projMap.has(p.nba_players.id));

  const cta =
    remaining === 1 ? 'Pick 1 more player'
    : remaining > 0 ? `Pick ${remaining} more players`
    : 'Place Order';

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: HG.surface,
        borderTopWidth: 1,
        borderTopColor: HG.hairline,
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 14,
        shadowColor: '#000',
        shadowOpacity: 0.6,
        shadowOffset: { width: 0, height: -8 },
        shadowRadius: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, letterSpacing: 1.6, color: HG.muted, textTransform: 'uppercase' }}>
            Your lineup
          </Text>
          <View
            style={{
              backgroundColor: HG.navySoft,
              borderColor: HG.skyEdge,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.ink, letterSpacing: 0.4 }}>
              {picked.length} / {LINEUP_SIZE}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          {hasProj && (
            <>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>proj FP</Text>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky }}>{totalProj.toFixed(1)}</Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.hairline2 }}>·</Text>
            </>
          )}
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>Cap left</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink }}>${capLeft.toFixed(0)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {slots.map((s, i) => {
          if (!s) {
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: HG.inputBg,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: HG.hairline2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, letterSpacing: 1.2 }}>PICK</Text>
              </View>
            );
          }
          return (
            <Pressable
              key={s.nba_players.id}
              onPress={() => onRemove(s.nba_players.id)}
              accessibilityLabel={`Remove ${playerLastName(s.nba_players)} from lineup`}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 10,
                backgroundColor: HG.surface,
                borderWidth: 1,
                borderColor: HG.skyEdge,
                paddingHorizontal: 8,
                justifyContent: 'center',
                gap: 1,
                position: 'relative',
              }}
            >
              <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: HG.ink, paddingRight: 14 }}>
                {playerLastName(s.nba_players)}
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>
                {fmtPrice(s.frozen_price)}
              </Text>
              {/* Tap-to-remove × badge */}
              <View
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  backgroundColor: HG.jet,
                  borderWidth: 1,
                  borderColor: HG.hairline2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.muted, lineHeight: 12 }}>×</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={ready ? onPlaceOrder : undefined}
        disabled={!ready}
        style={{
          height: 48,
          borderRadius: 999,
          backgroundColor: ready ? HG.sky : HG.surface,
          borderWidth: ready ? 0 : 1,
          borderColor: HG.hairline,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: FONT.monoBold,
            fontSize: 12,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: ready ? HG.jet : HG.muted2,
          }}
        >
          {cta}
        </Text>
      </Pressable>
    </View>
  );
}

// =============================================================================
// DEMAND CHIP — LOW / MED / HIGH visibility indicator
// Thresholds (1h demand count): 0-4 = LOW, 5-14 = MED, 15+ = HIGH
// =============================================================================

function DemandChip({ count }: { count: number | null | undefined }) {
  if (count == null) return null;
  const n = Number(count);
  let label: string;
  let color: string;
  let bg: string;
  if (n >= 15) {
    label = 'HIGH';
    color = HG.up;
    bg = HG.upSoft;
  } else if (n >= 5) {
    label = 'MED';
    color = HG.sky;
    bg = HG.skySoft;
  } else {
    return null; // LOW demand — show nothing to avoid noise
  }
  return (
    <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: bg }}>
      <Text style={{ fontFamily: FONT.monoBold, fontSize: 8, color, letterSpacing: 0.8 }}>{label}</Text>
    </View>
  );
}
