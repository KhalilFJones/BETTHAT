// =============================================================================
// BETTHAT — Draft Market (Figma redesign)
// The trading floor. Browse every player playing tonight, watch prices move,
// build a lineup of 3 within the $500 cap.
//
// Pixel spec sourced directly from Figma dev-mode CSS export for frames
// 40002070:14569/14570 ("Draft Market") and 40002070:15453/15454 (the
// mid-selection state — structurally identical browse list; only the
// bottom sheet, which the export didn't include, differs). Two full-bleed
// white cards (radius 20, shadow 0 2px 8px rgba(21,21,23,.05)) on the
// Greyscale/50 (#F4F4F4) page background: a fixed Top Bar card (title,
// dark ticker strip, search, position chips) and a scrolling "All Active
// Players" card. Row content per the spec's "Stock" component: ticker
// handle (primary), full name + position (secondary), an 80x40 dashed-
// midline/gradient-area graph, price, and a triangle + colored % change.
// Price-direction green/red here are the exact spec tokens (#36A34C /
// #F05D5D row-level — these equal theme.gain/theme.danger, NOT
// theme.up/theme.down, which are the older Holy Grail neon shades).
// =============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, FlatList, ActivityIndicator,
  RefreshControl, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, playerLastName, SALARY_CAP, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { PlayerAvatar } from '@/components/market/PlayerAvatar';
import { PriceGraph } from '@/components/market/PriceGraph';
import { MarketTicker } from '@/components/market/MarketTicker';
import {
  usePlayerMarket,
  useUpcomingSlates,
  type PlayerMarketRow,
  type TrendingRow,
  type InProgressLineup,
} from '@/hooks/holygrail/usePlayerMarket';
import { recomputeLineupCap } from '@/hooks/holygrail/lineupOps';

const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = (typeof POSITIONS)[number];

const PRICE_BUCKETS = [
  { key: 'any',      label: 'Any' },
  { key: 'lt50',     label: 'Under $50' },
  { key: '50to100',  label: '$50–$100' },
  { key: '100to150', label: '$100–$150' },
  { key: 'gt150',    label: 'Over $150' },
] as const;
type PriceBucketKey = (typeof PRICE_BUCKETS)[number]['key'];
const BUCKET_RANGE: Record<PriceBucketKey, { lo: number; hi: number }> = {
  any: { lo: 0, hi: Infinity },
  lt50: { lo: 0, hi: 50 },
  '50to100': { lo: 50, hi: 100 },
  '100to150': { lo: 100, hi: 150 },
  gt150: { lo: 150, hi: Infinity },
};

const SORT_OPTIONS = [
  { key: 'price', label: 'Price' },
  { key: 'fpts', label: 'Fantasy pts' },
  { key: 'name', label: 'A–Z' },
  { key: 'trending', label: 'Trending' },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

const TREND_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'rising', label: 'Rising' },
  { key: 'falling', label: 'Falling' },
] as const;
type TrendKey = (typeof TREND_OPTIONS)[number]['key'];

export default function PlayerMarketScreen() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();
  const userId = profile?.id;

  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<'today' | 'upnext'>('today');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const { data: slates } = useUpcomingSlates();
  const todaySlate = slates?.find((sl) => sl.label === 'Today');
  const upNextSlate = slates?.find((sl) => sl.label === 'Up Next');
  const selectedSlate = activeTab === 'upnext' && upNextSlate ? upNextSlate.game_date : today;

  const { data, isLoading, isError, isRefetching, refetch } = usePlayerMarket(userId, selectedSlate);

  useEffect(() => {
    // Guard on `data` actually being loaded (not just `isLoading` false) —
    // `data?.tonight ?? []` is `[]` while the query is still in flight, which
    // was flipping the tab to Up Next on every cold load even when Today
    // genuinely has games, before the real fetch had a chance to land.
    if (!slates || slates.length === 0 || !data) return;
    if (data.tonight.length === 0 && activeTab === 'today' && upNextSlate) {
      setActiveTab('upnext');
    }
  }, [slates, data, activeTab, upNextSlate]);

  const [position, setPosition] = useState<Position>('ALL');
  const [priceBucket, setPriceBucket] = useState<PriceBucketKey>('any');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('price');
  const [search, setSearch] = useState('');
  const [trendFilter, setTrendFilter] = useState<TrendKey>('all');
  const [hideInjured, setHideInjured] = useState(false);

  const activeFilterCount =
    (priceBucket !== 'any' ? 1 : 0) +
    (teamFilter !== 'ALL' ? 1 : 0) +
    (sortBy !== 'price' ? 1 : 0) +
    (trendFilter !== 'all' ? 1 : 0) +
    (hideInjured ? 1 : 0);

  const lineup = data?.lineup ?? null;
  const pickedIds = useMemo(() => {
    const set = new Set<string>();
    if (lineup) for (const lp of lineup.lineup_players) set.add(lp.nba_players.id);
    return set;
  }, [lineup]);

  const teams = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of data?.tonight ?? []) {
      if (!seen.has(p.team_abbreviation)) { seen.add(p.team_abbreviation); list.push(p.team_abbreviation); }
    }
    return list.sort();
  }, [data?.tonight]);

  const players = useMemo(() => {
    if (!data?.tonight) return [];
    const q = search.trim().toLowerCase();
    const bucket = BUCKET_RANGE[priceBucket];
    return data.tonight
      .filter((p) => p.player_prices != null)
      .filter((p) => {
        if (position !== 'ALL' && p.position !== position) return false;
        if (teamFilter !== 'ALL' && p.team_abbreviation !== teamFilter) return false;
        if (q && !`${p.full_name} ${p.team_abbreviation} ${p.ticker_handle ?? ''}`.toLowerCase().includes(q)) return false;
        const price = Number(p.player_prices!.current_price);
        if (price < bucket.lo || price >= bucket.hi) return false;
        if (hideInjured && p.is_injured) return false;
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

  const tickerEntries = useMemo(() => {
    if (!data?.tonight) return [];
    return data.tonight
      .filter((p) => p.player_prices?.price_change_pct_24h != null)
      .map((p) => ({
        ticker: (p.ticker_handle ?? p.full_name ?? '').toUpperCase(),
        price: Number(p.player_prices!.current_price),
        pctChange: Number(p.player_prices!.price_change_pct_24h ?? 0),
      }))
      .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
      .slice(0, 16);
  }, [data?.tonight]);

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
      await recomputeLineupCap(lineupId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-market'] }),
    onError: (err: any) => Alert.alert('Could not add player', err?.message ?? 'Try again.'),
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
    onError: (err: any) => Alert.alert('Could not remove player', err?.message ?? 'Try again.'),
  });

  const picked = lineup?.lineup_players ?? [];
  const isFull = picked.length >= LINEUP_SIZE;

  // If the lineup empties out while the sticky sheet is expanded (bar itself
  // unmounts since it's only rendered for picked.length > 0), don't leave the
  // "expanded" flag set — otherwise re-adding a player later pops the full
  // modal open with no tap from the user.
  useEffect(() => {
    if (picked.length === 0 && sheetExpanded) setSheetExpanded(false);
  }, [picked.length, sheetExpanded]);

  const projMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.tonight ?? []) {
      if (p.last5_avg_fpts != null) m.set(p.id, Number(p.last5_avg_fpts));
    }
    return m;
  }, [data?.tonight]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      {/* Top Bar card: title, ticker strip, search, position chips */}
      <View style={s.card}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <RoundIconBtn onPress={() => router.push('/friends' as any)} label="Friends" theme={theme}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m15 18-6-6 6-6" />
              </Svg>
            </RoundIconBtn>
            <Text style={s.title}>Draft Market</Text>
            <Pressable onPress={() => router.push('/wallet' as any)} accessibilityLabel="Open wallet" style={s.walletBtn}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
                <Path d="M12 7V2M12 22v-5" />
              </Svg>
            </Pressable>
          </View>
        </View>

        <MarketTicker entries={tickerEntries} />

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 }}>
          {/* Today / Up Next segmented control */}
          <View style={s.segWrap}>
            <Pressable onPress={() => setActiveTab('today')} style={s.segItem(activeTab === 'today', theme)}>
              <Text style={s.segLabel(activeTab === 'today', theme)}>
                {todaySlate?.has_live ? '● Live' : 'Today'}
              </Text>
              {todaySlate && todaySlate.game_count > 0 && (
                <Text style={s.segSub(activeTab === 'today', theme)}>
                  {todaySlate.game_count} game{todaySlate.game_count !== 1 ? 's' : ''}
                </Text>
              )}
            </Pressable>
            {upNextSlate ? (
              <Pressable onPress={() => setActiveTab('upnext')} style={s.segItem(activeTab === 'upnext', theme)}>
                <Text style={s.segLabel(activeTab === 'upnext', theme)}>Up Next</Text>
                <Text style={s.segSub(activeTab === 'upnext', theme)}>
                  {upNextSlateLabel(upNextSlate.game_date)} · {upNextSlate.game_count}G
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Search + Filters */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={[s.searchWrap, { flex: 1 }]}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
                <Path d="m21 21-4.3-4.3" />
              </Svg>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search players..."
                placeholderTextColor={theme.muted}
                style={{ flex: 1, color: theme.ink, fontFamily: FONT.sans, fontSize: 14, height: '100%', padding: 0 }}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <Pressable onPress={() => setFiltersOpen(true)} style={s.filterBtn}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M4 6h16M7 12h10M10 18h4" />
              </Svg>
              {activeFilterCount > 0 ? (
                <View style={s.filterBadge}>
                  <Text style={{ fontFamily: FONT.sansBold, fontSize: 9, color: theme.onAccent }}>{activeFilterCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* Position chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {POSITIONS.map((p) => {
              const active = position === p;
              return (
                <Pressable key={p} onPress={() => setPosition(p)} style={s.chip(active)}>
                  <Text style={s.chipLabel(active)}>{p === 'ALL' ? 'All' : p}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      <View style={{ height: 8 }} />

      {/* All Active Players card */}
      <View style={[s.card, { flex: 1 }]}>
        <View style={{ flex: 1, borderRadius: 20, overflow: 'hidden' }}>
          <FlatList
            data={players}
            keyExtractor={(p) => p.id}
            style={{ backgroundColor: theme.surface }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} colors={[theme.accent]} />
            }
            ListHeaderComponent={
              <View>
                {data?.trending && data.trending.length > 0 && position === 'ALL' && !search ? (
                  <>
                    <SectionRow theme={theme} title="Trending" meta={activeTab === 'today' ? 'Tonight' : 'Up Next'} />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 12 }}
                    >
                      {data.trending.slice(0, 6).map((t) => (
                        <TrendCard key={t.player_id} row={t} theme={theme} onPress={() => router.push(`/player/${t.player_id}` as any)} />
                      ))}
                    </ScrollView>
                  </>
                ) : null}
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  <Text style={s.sectionTitle}>All Active Players</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <PlayerRow
                player={item}
                theme={theme}
                sparkPrices={data?.history.get(item.id) ?? []}
                isPicked={pickedIds.has(item.id)}
                // Disabling every row while an add/remove is in flight closes two
                // races: (1) double-tapping the same row before the first insert
                // resolves — `pickedIds` is still stale, so a second tap would
                // read "not picked" and fire another insert; (2) tapping two
                // different empty rows back-to-back before `lineup` refetches —
                // both calls would see lineup=null and each create their own
                // 'building' lineup row (the exact duplicate-lineup bug seen in
                // this same session's DB seeding pass).
                disabled={(isFull && !pickedIds.has(item.id)) || addMutation.isPending || removeMutation.isPending}
                // Rows now open the Player Details page instead of toggling
                // add/remove directly — that action lives on the detail
                // page's own Add/Remove button now, per the Figma spec.
                onPress={() => router.push(`/player/${item.id}` as any)}
              />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: lineup && picked.length > 0 ? 220 : 24 }}
            ListEmptyComponent={
              isLoading ? (
                <View style={{ padding: 60, alignItems: 'center' }}>
                  <ActivityIndicator color={theme.accent} />
                </View>
              ) : isError ? (
                <View style={{ padding: 60, alignItems: 'center', gap: 12 }}>
                  <Text style={{ color: theme.ink, fontFamily: FONT.sansBold, fontSize: 14, textAlign: 'center' }}>
                    Couldn't load the market.
                  </Text>
                  <Text style={{ color: theme.muted, fontFamily: FONT.sans, fontSize: 13, textAlign: 'center' }}>
                    Check your connection and try again.
                  </Text>
                  <Pressable onPress={() => refetch()} style={{ paddingHorizontal: 16, height: 36, borderRadius: 999, backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accentEdge, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: theme.ink }}>Retry</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ padding: 60 }}>
                  <Text style={{ color: theme.muted, fontFamily: FONT.sans, fontSize: 13, textAlign: 'center' }}>
                    No players match your filters.
                  </Text>
                </View>
              )
            }
          />
        </View>
      </View>

      {/* Sticky lineup builder */}
      {picked.length > 0 ? (
        <StickyLineupBar
          theme={theme}
          lineup={lineup}
          projMap={projMap}
          expanded={sheetExpanded}
          onToggleExpand={() => setSheetExpanded((v) => !v)}
          onPlaceOrder={() => { setSheetExpanded(false); router.push('/matchup/create' as any); }}
          onRemove={(playerId) => removeMutation.mutate(playerId)}
          onPlayerPress={(playerId) => { setSheetExpanded(false); router.push(`/player/${playerId}` as any); }}
        />
      ) : null}

      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        theme={theme}
        priceBucket={priceBucket} setPriceBucket={setPriceBucket}
        teamFilter={teamFilter} setTeamFilter={setTeamFilter}
        teams={teams}
        sortBy={sortBy} setSortBy={setSortBy}
        trendFilter={trendFilter} setTrendFilter={setTrendFilter}
        hideInjured={hideInjured} setHideInjured={setHideInjured}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function upNextSlateLabel(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function ensureBuildingLineup(userId: string, existing: InProgressLineup | null, slateDate: string): Promise<string> {
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from('lineups')
    .insert({ user_id: userId, entry_tier: 5, status: 'building', total_cap_used: 0, game_date: slateDate })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Row-level price-direction color — exact Figma tokens (== theme.gain / theme.danger). */
function dirColor(pct: number | string | null | undefined, theme: Theme): string {
  if (pct == null) return theme.muted;
  const v = typeof pct === 'number' ? pct : Number(pct);
  if (!Number.isFinite(v) || v === 0) return theme.muted;
  return v > 0 ? theme.gain : theme.danger;
}

// =============================================================================
// TOP BAR PIECES
// =============================================================================

function RoundIconBtn({ children, onPress, label, theme }: { children: ReactNode; onPress: () => void; label: string; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
      }}
    >
      {children}
    </Pressable>
  );
}

function SectionRow({ theme, title, meta }: { theme: Theme; title: string; meta?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4, marginBottom: 10 }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 17, color: theme.ink, letterSpacing: -0.2 }}>{title}</Text>
      {meta ? <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>{meta}</Text> : null}
    </View>
  );
}

// =============================================================================
// TRENDING CARD
// =============================================================================

function TrendCard({ row, theme, onPress }: { row: TrendingRow; theme: Theme; onPress: () => void }) {
  const p = row.nba_players;
  const color = dirColor(row.price_change_pct_24h, theme);
  return (
    <Pressable onPress={onPress} style={{ width: 160, padding: 14, backgroundColor: theme.surfaceSunken, borderRadius: 16, borderWidth: 1, borderColor: theme.hairline, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar player={p} theme={theme} size={36} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink, lineHeight: 16 }}>{p.full_name}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{fmtPrice(row.current_price)}</Text>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color }}>{Number(row.price_change_pct_24h ?? 0).toFixed(2)}%</Text>
      </View>
    </Pressable>
  );
}

// =============================================================================
// PLAYER ROW — Figma "Stock" component
// No separate Add button in the spec — the whole row toggles add/remove;
// picked state reads as an accent-tinted row instead of a relabeled button.
// =============================================================================

function PlayerRow({
  player, theme, sparkPrices, isPicked, disabled, onPress,
}: {
  player: PlayerMarketRow; theme: Theme; sparkPrices: number[]; isPicked: boolean; disabled: boolean; onPress: () => void;
}) {
  const pp = player.player_prices!;
  const isLocked = pp.is_locked;
  const lockKind: 'live' | 'injury' | null = !isLocked ? null : pp.lock_reason === 'game_live' ? 'live' : 'injury';
  const color = dirColor(pp.price_change_pct_24h, theme);
  const pct = Number(pp.price_change_pct_24h ?? 0);
  const primaryLabel = (player.ticker_handle ?? playerLastName(player)).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`View ${player.full_name}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 10, paddingHorizontal: isPicked ? 10 : 0, marginHorizontal: isPicked ? -10 : 0,
        borderRadius: isPicked ? 12 : 0,
        backgroundColor: isPicked ? theme.accentSoft : 'transparent',
        opacity: isLocked || disabled ? 0.5 : 1,
      }}
    >
      <PlayerAvatar player={player} theme={theme} size={40} />

      <View style={{ width: 116 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>
            {primaryLabel}
          </Text>
          {lockKind ? (
            <View style={{ backgroundColor: lockKind === 'live' ? theme.surfaceSunken : theme.gainSoft, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 8, color: lockKind === 'live' ? theme.muted : theme.danger, letterSpacing: 0.5 }}>
                {lockKind === 'live' ? 'LOCKED' : 'OUT'}
              </Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 1 }}>
          {player.full_name} {player.position}
        </Text>
      </View>

      <View style={{ flex: 1, alignItems: 'center' }}>
        <PriceGraph prices={sparkPrices} theme={theme} width={80} height={40} />
      </View>

      <View style={{ alignItems: 'flex-end', minWidth: 89 }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>{fmtPrice(pp.current_price)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
          <Svg width={8} height={7} viewBox="0 0 8 7">
            <Path d={pct >= 0 ? 'M4 0 L8 7 L0 7 Z' : 'M0 0 L8 0 L4 7 Z'} fill={color} />
          </Svg>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color }}>{Math.abs(pct).toFixed(2)}%</Text>
        </View>
      </View>
    </Pressable>
  );
}

// =============================================================================
// STICKY LINEUP BAR — collapsed summary ⇄ expanded full sheet
// =============================================================================

function StickyLineupBar({
  theme, lineup, projMap, expanded, onToggleExpand, onPlaceOrder, onRemove, onPlayerPress,
}: {
  theme: Theme; lineup: InProgressLineup | null; projMap: Map<string, number>; expanded: boolean;
  onToggleExpand: () => void; onPlaceOrder: () => void; onRemove: (playerId: string) => void;
  onPlayerPress: (playerId: string) => void;
}) {
  const picked = lineup?.lineup_players ?? [];
  const capUsed = Number(lineup?.total_cap_used ?? 0);
  const capLeft = SALARY_CAP - capUsed;
  const remaining = LINEUP_SIZE - picked.length;
  const ready = remaining === 0;
  const slots = Array.from({ length: LINEUP_SIZE }, (_, i) => picked[i] ?? null);

  const totalProj = picked.reduce((sum, p) => sum + (projMap.get(p.nba_players.id) ?? 0), 0);
  const hasProj = picked.some((p) => projMap.has(p.nba_players.id));
  const capPct = Math.max(0, Math.min(100, (capUsed / SALARY_CAP) * 100));

  const cta = remaining === 1 ? 'Pick 1 more player' : remaining > 0 ? `Pick ${remaining} more players` : 'Continue to Wager →';

  const panel = (
      <View
        style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderTopWidth: 1,
          borderColor: theme.hairline,
          paddingHorizontal: 18,
          paddingTop: 10,
          paddingBottom: 22,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowOffset: { width: 0, height: -6 },
          shadowRadius: 16,
        }}
      >
        <Pressable onPress={onToggleExpand} style={{ alignItems: 'center', paddingVertical: 6 }} accessibilityLabel={expanded ? 'Collapse lineup' : 'Expand lineup'}>
          <View style={{ width: 40, height: 5, borderRadius: 999, backgroundColor: theme.hairline2 }} />
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink }}>Your lineup</Text>
            <View style={{ backgroundColor: theme.accentSoft, borderColor: theme.accentEdge, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.ink, letterSpacing: 0.4 }}>{picked.length} / {LINEUP_SIZE}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            {hasProj && (
              <>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted }}>proj FP</Text>
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.ink }}>{totalProj.toFixed(1)}</Text>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.hairline2 }}>·</Text>
              </>
            )}
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted }}>Cap left</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.ink }}>${capLeft.toFixed(0)}</Text>
          </View>
        </View>

        {/* Cap usage progress track */}
        <View style={{ height: 4, borderRadius: 999, backgroundColor: theme.surfaceSunken, overflow: 'hidden', marginBottom: 14 }}>
          <View style={{ width: `${capPct}%`, height: '100%', backgroundColor: theme.accent }} />
        </View>

        {expanded ? (
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {picked.map((lp) => (
              <Pressable
                key={lp.nba_players.id}
                onPress={() => onPlayerPress(lp.nba_players.id)}
                accessibilityLabel={`View ${lp.nba_players.full_name}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: theme.hairline }}
              >
                <PlayerAvatar player={lp.nba_players} theme={theme} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>{lp.nba_players.full_name}</Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, marginTop: 2 }}>
                    {lp.nba_players.team_abbreviation} · {lp.nba_players.position}
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: theme.ink }}>{fmtPrice(lp.frozen_price)}</Text>
                <Pressable
                  onPress={(e) => { e.stopPropagation(); onRemove(lp.nba_players.id); }}
                  hitSlop={8}
                  style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}
                >
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: theme.muted, lineHeight: 14 }}>×</Text>
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            {slots.map((sl, i) => {
              if (!sl) {
                return (
                  <View key={i} style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: theme.surfaceSunken, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.hairline2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2, letterSpacing: 1.2 }}>PICK</Text>
                  </View>
                );
              }
              return (
                <Pressable
                  key={sl.nba_players.id}
                  onPress={() => onPlayerPress(sl.nba_players.id)}
                  accessibilityLabel={`View ${playerLastName(sl.nba_players)}`}
                  style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.accentEdge, paddingHorizontal: 8, justifyContent: 'center', gap: 1, position: 'relative' }}
                >
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.ink, paddingRight: 14 }}>{playerLastName(sl.nba_players)}</Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted }}>{fmtPrice(sl.frozen_price)}</Text>
                  <Pressable
                    onPress={(e) => { e.stopPropagation(); onRemove(sl.nba_players.id); }}
                    hitSlop={6}
                    accessibilityLabel={`Remove ${playerLastName(sl.nba_players)} from lineup`}
                    style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 999, backgroundColor: theme.surfaceSunken, borderWidth: 1, borderColor: theme.hairline2, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.muted, lineHeight: 12 }}>×</Text>
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable
          onPress={ready ? onPlaceOrder : undefined}
          disabled={!ready}
          style={{ height: 50, borderRadius: 999, backgroundColor: ready ? theme.accent : theme.surfaceSunken, borderWidth: ready ? 0 : 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: ready ? theme.onAccent : theme.muted2 }}>{cta}</Text>
        </Pressable>
      </View>
  );

  // Collapsed: plain docked bar so touches on the list/filters above it still work.
  if (!expanded) {
    return <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{panel}</View>;
  }

  // Expanded: full-screen backdrop modal, dismiss on tap-outside or swipe-down handle.
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onToggleExpand}>
      <Pressable onPress={onToggleExpand} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()}>{panel}</Pressable>
      </Pressable>
    </Modal>
  );
}

// =============================================================================
// FILTER SHEET
// =============================================================================

function FilterSheet({
  visible, onClose, theme,
  priceBucket, setPriceBucket, teamFilter, setTeamFilter, teams,
  sortBy, setSortBy, trendFilter, setTrendFilter, hideInjured, setHideInjured,
}: {
  visible: boolean; onClose: () => void; theme: Theme;
  priceBucket: PriceBucketKey; setPriceBucket: (v: PriceBucketKey) => void;
  teamFilter: string; setTeamFilter: (v: string) => void; teams: string[];
  sortBy: SortKey; setSortBy: (v: SortKey) => void;
  trendFilter: TrendKey; setTrendFilter: (v: TrendKey) => void;
  hideInjured: boolean; setHideInjured: (v: boolean) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 32, maxHeight: '82%' }}>
          <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <View style={{ width: 40, height: 5, borderRadius: 999, backgroundColor: theme.hairline2 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink }}>Filters</Text>
            <Pressable onPress={onClose}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.accent }}>Done</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <FilterGroup theme={theme} label="Price">
              {PRICE_BUCKETS.map((b) => (
                <FilterChip key={b.key} label={b.label} active={priceBucket === b.key} onPress={() => setPriceBucket(b.key)} theme={theme} />
              ))}
            </FilterGroup>

            <FilterGroup theme={theme} label="Team">
              {['ALL', ...teams].map((team) => (
                <FilterChip key={team} label={team === 'ALL' ? 'All Teams' : team} active={teamFilter === team} onPress={() => setTeamFilter(team)} theme={theme} />
              ))}
            </FilterGroup>

            <FilterGroup theme={theme} label="Sort by">
              {SORT_OPTIONS.map((o) => (
                <FilterChip key={o.key} label={o.label} active={sortBy === o.key} onPress={() => setSortBy(o.key)} theme={theme} />
              ))}
            </FilterGroup>

            <FilterGroup theme={theme} label="Price trend">
              {TREND_OPTIONS.map((o) => (
                <FilterChip key={o.key} label={o.label} active={trendFilter === o.key} onPress={() => setTrendFilter(o.key)} theme={theme} />
              ))}
            </FilterGroup>

            <FilterGroup theme={theme} label="Availability">
              <FilterChip label={hideInjured ? 'Hiding OUT/INJ' : 'Show all players'} active={hideInjured} onPress={() => setHideInjured(!hideInjured)} theme={theme} />
            </FilterGroup>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterGroup({ theme, label, children }: { theme: Theme; label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

function FilterChip({ label, active, onPress, theme }: { label: string; active: boolean; onPress: () => void; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ height: 34, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.accentSoft : theme.surfaceSunken, borderWidth: 1, borderColor: active ? theme.accentEdge : theme.hairline }}
    >
      <Text style={{ fontFamily: active ? FONT.sansBold : FONT.sansMedium, fontSize: 12, color: active ? theme.ink : theme.muted }}>{label}</Text>
    </Pressable>
  );
}

// =============================================================================
// STYLES
// =============================================================================

function styles(t: Theme) {
  return {
    card: {
      backgroundColor: t.surface,
      borderRadius: 20,
      shadowColor: '#151517',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: t.mode === 'light' ? 0.05 : 0,
      shadowRadius: 8,
      elevation: t.mode === 'light' ? 2 : 0,
    },
    title: { fontFamily: FONT.sansMedium, fontSize: 18, color: t.ink, letterSpacing: -0.2 },
    sectionTitle: { fontFamily: FONT.sansBold, fontSize: 18, color: t.ink },
    walletBtn: {
      width: 40, height: 40, borderRadius: 999, alignItems: 'center' as const, justifyContent: 'center' as const,
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.hairline,
    },
    segWrap: { flexDirection: 'row' as const, backgroundColor: t.surfaceSunken, borderRadius: 14, padding: 4 },
    segItem: (active: boolean, theme: Theme) => ({
      flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' as const,
      backgroundColor: active ? theme.surface : 'transparent',
      borderWidth: active ? 1 : 0, borderColor: theme.hairline,
    }),
    segLabel: (active: boolean, theme: Theme) => ({
      fontFamily: active ? FONT.sansBold : FONT.sansMedium, fontSize: 12, color: active ? theme.ink : theme.muted,
    }),
    segSub: (active: boolean, theme: Theme) => ({
      fontFamily: FONT.monoMedium, fontSize: 9, color: active ? theme.muted : theme.muted2, marginTop: 1,
    }),
    searchWrap: {
      flexDirection: 'row' as const, alignItems: 'center' as const, height: 48, paddingHorizontal: 12, gap: 8,
      backgroundColor: t.surfaceSunken, borderRadius: 8,
    },
    filterBtn: {
      width: 48, height: 48, borderRadius: 8, backgroundColor: t.surfaceSunken,
      alignItems: 'center' as const, justifyContent: 'center' as const, position: 'relative' as const,
    },
    filterBadge: {
      position: 'absolute' as const, top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8,
      backgroundColor: t.accent, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 3,
    },
    chip: (active: boolean) => ({
      height: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center' as const, justifyContent: 'center' as const,
      backgroundColor: active ? t.accent : t.surfaceSunken, borderWidth: active ? 0 : 1, borderColor: t.hairline,
    }),
    chipLabel: (active: boolean) => ({
      fontFamily: active ? FONT.sansBold : FONT.sansMedium, fontSize: 12, letterSpacing: 0.3,
      color: active ? t.onAccent : t.muted,
    }),
  };
}
