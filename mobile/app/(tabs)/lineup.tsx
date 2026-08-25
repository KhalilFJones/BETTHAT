// =============================================================================
// BETTHAT — Draft Market (Figma redesign)
// The trading floor. Browse every player playing tonight, watch prices move,
// build a lineup of 3 within the $500 cap.
//
// Pixel spec from the Figma dev-mode export for the "Market" frame. Two
// full-bleed white cards (radius 20, shadow 0 2px 8px rgba(21,21,23,.05)) on
// the Greyscale/50 (#F4F4F4) page background:
//   1. Top Bar card — back / "Draft Market" / help round buttons, the dark
//      full-bleed price ticker, a 48px "Search index" field with a trailing
//      glyph, and a "Filter" label beside five multi-select position chips.
//   2. "All Active Players" card — a 3-up grid of 110-wide player cards, each
//      carrying position / name / team, price + % change, five form dots over
//      the last-5 average, and a "+ Add" pill.
// A docked "Your lineup" sheet sits over the bottom once a pick is made:
// grab handle, title, a 122-wide cap track with "Cap left : x", and the
// picked players as the shared Stock rows when expanded.
//
// Price-direction green/red are the spec's row-level tokens (#36A34C /
// #F05D5D == theme.gain / theme.danger), NOT theme.up/theme.down.
// =============================================================================

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, FlatList, ActivityIndicator,
  RefreshControl, Modal, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, SALARY_CAP, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { MarketTicker } from '@/components/market/MarketTicker';
import { StockRow } from '@/components/market/StockRow';
import { PlayerHeadshot } from '@/components/media/PlayerHeadshot';
import { TeamLogo } from '@/components/media/TeamLogo';
import {
  usePlayerMarket,
  useUpcomingSlates,
  type PlayerMarketRow,
  type InProgressLineup,
} from '@/hooks/holygrail/usePlayerMarket';
import { recomputeLineupCap } from '@/hooks/holygrail/lineupOps';

// The export's filter row is five position chips with no "All" — an empty
// selection means no position filter, and chips multi-select (PG + SG are
// both active in the reference frame).
const NAV_CLEARANCE = 120; // docked nav pill + safe area

// Shared empty array — a new [] per render would break PlayerCard's memo.
const EMPTY_FORM: number[] = [];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = (typeof POSITIONS)[number];

// Form-dot tones from the export: at/above the player's own season average
// reads green, within 25% of it amber, below that red.
const FORM_GOOD = '#36A34C';
const FORM_OK = '#FFEFA4';
const FORM_BAD = '#C0645F';
const GREY_400 = '#AAAAAC'; // "Filter" label + inactive chip fill in the export

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
  const { profile } = useAuthStore();
  const userId = profile?.id;

  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<'today' | 'upnext'>('today');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const { data: slates } = useUpcomingSlates();
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

  const [positions, setPositions] = useState<Set<Position>>(() => new Set());
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
        if (positions.size > 0 && !positions.has(p.position as Position)) return false;
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
  }, [data?.tonight, positions, teamFilter, priceBucket, search, sortBy, trendFilter, hideInjured]);

  // Cards are flex:1 inside a 3-up row, so a trailing row holding 1 or 2 of
  // them would stretch those to full width. Pad to a multiple of 3 and render
  // invisible spacers for the tail.
  const gridData = useMemo(() => {
    if (players.length === 0) return players;
    const pad = (3 - (players.length % 3)) % 3;
    return pad === 0 ? players : [...players, ...Array(pad).fill(null)];
  }, [players]);

  const tickerEntries = useMemo(() => {
    if (!data?.tonight) return [];
    return data.tonight
      .filter((p) => p.player_prices?.price_change_pct_24h != null)
      .map((p) => ({
        name: p.full_name,
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
    onError: (err: any, vars) => {
      const raw = err?.message ?? '';
      // reject_started_game_pick() names the player by uuid, which is useless
      // in an alert. Say who it was and refresh so the tile shows LOCKED.
      if (/already started|is locked/i.test(raw)) {
        qc.invalidateQueries({ queryKey: ['player-market'] });
        Alert.alert(
          'Too late for this one',
          `${vars.player.full_name}'s game has already tipped off, so they can't be drafted.`,
        );
        return;
      }
      Alert.alert('Could not add player', raw || 'Try again.');
    },
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
  const mutating = addMutation.isPending || removeMutation.isPending;

  // Disabling every card while an add/remove is in flight closes two races:
  // (1) double-tapping the same card before the first insert resolves —
  // `pickedIds` is still stale, so a second tap would read "not picked" and
  // fire another insert; (2) tapping two different cards back-to-back before
  // `lineup` refetches — both calls would see lineup=null and each create
  // their own 'building' lineup row.
  const openPlayer = useCallback(
    (id: string) => router.push(`/player/${id}` as any),
    [router],
  );

  const togglePlayer = useCallback((player: PlayerMarketRow) => {
    if (pickedIds.has(player.id)) removeMutation.mutate(player.id);
    else addMutation.mutate({ player, price: Number(player.player_prices!.current_price) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedIds]);

  const renderPlayer = useCallback(
    ({ item }: { item: PlayerMarketRow | null }) =>
      item == null ? (
        <View style={{ flex: 1 }} />
      ) : (
        <PlayerCard
          player={item}
          theme={theme}
          form={data?.form.get(item.id) ?? EMPTY_FORM}
          isPicked={pickedIds.has(item.id)}
          disabled={mutating || (isFull && !pickedIds.has(item.id))}
          onPress={openPlayer}
          onToggle={togglePlayer}
        />
      ),
    [theme, data?.form, pickedIds, mutating, isFull, openPlayer, togglePlayer],
  );

  // If the lineup empties out while the sticky sheet is expanded (bar itself
  // unmounts since it's only rendered for picked.length > 0), don't leave the
  // "expanded" flag set — otherwise re-adding a player later pops the full
  // sheet open with no tap from the user.
  useEffect(() => {
    if (picked.length === 0 && sheetExpanded) setSheetExpanded(false);
  }, [picked.length, sheetExpanded]);

  function togglePosition(p: Position) {
    setPositions((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      {/* ═══ Top Bar card ═══════════════════════════════════════════════════ */}
      <View style={s.card}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <RoundIconBtn theme={theme} label="Back to home" onPress={() => router.replace('/(tabs)/home' as any)}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m15 18-6-6 6-6" />
            </Svg>
          </RoundIconBtn>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, lineHeight: 23.4, color: theme.ink, letterSpacing: -0.18 }}>Draft Market</Text>
          <RoundIconBtn theme={theme} label="Help" onPress={() => setHelpOpen(true)}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
              <Path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.6" />
              <Path d="M12 17h.01" />
            </Svg>
          </RoundIconBtn>
        </View>

        <MarketTicker entries={tickerEntries} />

        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 16 }}>
          {/* Search index */}
          <View style={s.searchWrap}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search index"
              placeholderTextColor={theme.muted2}
              style={{ flex: 1, color: theme.ink, fontFamily: FONT.sans, fontSize: 16, padding: 0 }}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.muted2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
              <Path d="m21 21-4.3-4.3" />
            </Svg>
          </View>

          {/* Filter label + position chips. The label is the entry point to
              the sort / team / price sheet — the export gives it no button of
              its own, and those filters would otherwise be unreachable. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => setFiltersOpen(true)} hitSlop={8} accessibilityLabel="More filters">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1, color: GREY_400 }}>Filter</Text>
                {activeFilterCount > 0 ? (
                  <View style={s.filterBadge}>
                    <Text style={{ fontFamily: FONT.sansBold, fontSize: 8, color: theme.onAccent }}>{activeFilterCount}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
              {POSITIONS.map((p) => {
                const active = positions.has(p);
                return (
                  <Pressable
                    key={p}
                    onPress={() => togglePosition(p)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[s.chip, active ? s.chipOn : s.chipOff]}
                  >
                    {active ? (
                      <Svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round">
                        <Path d="M18 6 6 18M6 6l12 12" />
                      </Svg>
                    ) : null}
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 9, lineHeight: 13.95, color: active ? '#FFFFFF' : theme.ink }}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      <View style={{ height: 8 }} />

      {/* ═══ All Active Players card ════════════════════════════════════════ */}
      <View style={[s.card, { flex: 1, padding: 16, gap: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={s.sectionTitle}>All Active Players</Text>
          {/* Slate switcher. Not in the export — it only ever appears when
              there genuinely is a next slate to draft for, so the reference
              frame's single-slate layout is unchanged. */}
          {upNextSlate ? (
            <View style={s.segWrap}>
              <Pressable onPress={() => setActiveTab('today')} style={s.segItem(activeTab === 'today', theme)}>
                <Text style={s.segLabel(activeTab === 'today', theme)}>Today</Text>
              </Pressable>
              <Pressable onPress={() => setActiveTab('upnext')} style={s.segItem(activeTab === 'upnext', theme)}>
                <Text style={s.segLabel(activeTab === 'upnext', theme)}>{upNextSlateLabel(upNextSlate.game_date)}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <FlatList
          data={gridData}
          keyExtractor={(p, i) => p?.id ?? `pad-${i}`}
          numColumns={3}
          style={{ flex: 1 }}
          columnWrapperStyle={{ gap: 16 }}
          contentContainerStyle={{ gap: 16, paddingBottom: picked.length > 0 ? 250 : NAV_CLEARANCE }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} colors={[theme.accent]} />
          }
          renderItem={renderPlayer}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
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

      {/* ═══ "Your lineup" sheet ════════════════════════════════════════════ */}
      {picked.length > 0 ? (
        <LineupSheet
          theme={theme}
          lineup={lineup}
          history={data?.history}
          expanded={sheetExpanded}
          mutating={mutating}
          onToggleExpand={() => setSheetExpanded((v) => !v)}
          onPlaceOrder={() => { setSheetExpanded(false); router.push('/matchup/create' as any); }}
          onPlayerPress={(playerId) => { setSheetExpanded(false); router.push(`/player/${playerId}` as any); }}
          onRemove={(playerId) => removeMutation.mutate(playerId)}
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

      <HelpSheet theme={theme} visible={helpOpen} onClose={() => setHelpOpen(false)} />
    </SafeAreaView>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function upNextSlateLabel(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
}

async function ensureBuildingLineup(userId: string, existing: InProgressLineup | null, slateDate: string): Promise<string> {
  // Only reuse a draft that belongs to the slate being viewed. Reusing one
  // from an earlier date is what produced "their game has already started":
  // reject_started_game_pick() checks the LINEUP's game_date, so yesterday's
  // lineup rejects every one of today's players.
  if (existing?.id && existing.game_date === slateDate) return existing.id;
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

/** Form dot tone — each game's fantasy points against the player's season average. */
function formColor(fp: number, seasonAvg: number | null | undefined, theme: Theme): string {
  const avg = Number(seasonAvg ?? 0);
  if (!avg) return theme.hairline2;
  const ratio = fp / avg;
  if (ratio >= 1) return FORM_GOOD;
  if (ratio >= 0.75) return FORM_OK;
  return FORM_BAD;
}

/** Figma "Button/Secondary" — 40x40 pill with the Greyscale/100 hairline. */
function RoundIconBtn({ theme, label, onPress, children }: { theme: Theme; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      style={{
        width: 40, height: 40, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
      }}
    >
      {children}
    </Pressable>
  );
}

// =============================================================================
// PLAYER CARD — the export's 110x116 grid tile
// =============================================================================

// memo(): the grid holds ~190 of these, so a parent re-render (a keystroke in
// search, a 60s refetch) would otherwise rebuild every card — each with an
// image, a crest and an SVG. Callbacks take the player so their identity can
// stay stable across renders.
const PlayerCard = memo(function PlayerCard({
  player, theme, form, isPicked, disabled, onPress, onToggle,
}: {
  player: PlayerMarketRow; theme: Theme; form: number[]; isPicked: boolean; disabled: boolean;
  onPress: (playerId: string) => void; onToggle: (player: PlayerMarketRow) => void;
}) {
  const pp = player.player_prices!;
  const isLocked = pp.is_locked;
  const color = dirColor(pp.price_change_pct_24h, theme);
  const pct = Number(pp.price_change_pct_24h ?? 0);
  const addDisabled = disabled || isLocked;

  return (
    <Pressable
      onPress={() => onPress(player.id)}
      accessibilityLabel={`View ${player.full_name}`}
      style={{
        flex: 1, minHeight: 150, padding: 12, gap: 5, borderRadius: 16, overflow: 'hidden',
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: isPicked ? theme.accentEdge : theme.hairline,
        opacity: isLocked ? 0.5 : 1,
      }}
    >
      {/* Club crest, watermarked into the top-right corner of the tile. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', right: -8, top: -6, opacity: theme.mode === 'light' ? 0.07 : 0.13 }}
      >
        <TeamLogo abbreviation={player.team_abbreviation} size={62} theme={theme} />
      </View>

      {/* Identity */}
      <PlayerHeadshot player={player} theme={theme} size={38} shape="rounded" showTeamCrest />
      <View>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 7, lineHeight: 10.5, color: theme.muted2 }}>
          {player.position || ' '}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansBold, fontSize: 12, lineHeight: 18, color: theme.ink }}>
          {player.full_name}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 7, lineHeight: 10.5, color: theme.muted2 }}>
          {isLocked ? (pp.lock_reason === 'game_live' ? 'LOCKED' : 'OUT') : player.team_abbreviation}
        </Text>
      </View>

      {/* Price */}
      <View>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansBold, fontSize: 14, lineHeight: 21, color: theme.ink }}>
          {fmtPrice(pp.current_price)}
        </Text>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 8, lineHeight: 12, color }}>
          {pct >= 0 ? '' : '-'}{Math.abs(pct).toFixed(2)}%
        </Text>
      </View>

      {/* Form dots + last-5 average, with the Add pill trailing */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4, marginTop: 'auto' }}>
        <View style={{ minWidth: 0 }}>
          <View style={{ flexDirection: 'row', gap: 2.75, height: 6, marginBottom: 2 }}>
            {form.length > 0
              ? form.map((fp, i) => (
                  <View key={i} style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: formColor(fp, player.season_avg_fpts, theme) }} />
                ))
              : null}
          </View>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 7, lineHeight: 11, letterSpacing: 0.06, color: theme.muted2 }}>
            {player.last5_avg_fpts != null ? `Avg ${Number(player.last5_avg_fpts).toFixed(1)} pts` : 'No recent games'}
          </Text>
        </View>

        <Pressable
          onPress={(e) => { e.stopPropagation(); if (!addDisabled) onToggle(player); }}
          disabled={addDisabled}
          hitSlop={6}
          accessibilityLabel={isPicked ? `Remove ${player.full_name} from lineup` : `Add ${player.full_name} to lineup`}
          style={{
            height: 16, paddingHorizontal: 6, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
            backgroundColor: isPicked ? theme.accent : addDisabled ? theme.surfaceSunken : theme.ink,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontFamily: FONT.sansMedium, fontSize: 7, lineHeight: 10.85,
              color: isPicked ? theme.onAccent : addDisabled ? theme.muted2 : theme.surface,
            }}
          >
            {isPicked ? '✓ Added' : '+ Add'}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

// =============================================================================
// "YOUR LINEUP" SHEET — docked header ⇄ expanded roster
// =============================================================================

function LineupSheet({
  theme, lineup, history, expanded, mutating, onToggleExpand, onPlaceOrder, onPlayerPress, onRemove,
}: {
  theme: Theme; lineup: InProgressLineup | null; history: Map<string, number[]> | undefined;
  expanded: boolean; mutating: boolean; onToggleExpand: () => void; onPlaceOrder: () => void;
  onPlayerPress: (playerId: string) => void; onRemove: (playerId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const picked = lineup?.lineup_players ?? [];
  const capUsed = Number(lineup?.total_cap_used ?? 0);
  const capLeft = SALARY_CAP - capUsed;
  const capPct = Math.max(0, Math.min(100, (capUsed / SALARY_CAP) * 100));
  const remaining = LINEUP_SIZE - picked.length;
  const ready = remaining === 0;
  const cta = remaining === 1 ? 'Pick 1 more player' : remaining > 0 ? `Pick ${remaining} more players` : 'Next';

  return (
    <View
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: theme.surface,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        borderWidth: 1, borderColor: theme.hairline2,
        paddingTop: 16, paddingHorizontal: 16,
        // Clear the floating nav pill (bottom: insets.bottom + 8, height 56)
        // plus a little breathing room, so the CTA is never underneath it.
        paddingBottom: insets.bottom + 76,
        gap: 10,
      }}
    >
      <Pressable onPress={onToggleExpand} hitSlop={12} accessibilityLabel={expanded ? 'Collapse lineup' : 'Expand lineup'} style={{ alignItems: 'center' }}>
        <View style={{ width: 48, height: 6, borderRadius: 100, backgroundColor: theme.hairline }} />
      </Pressable>

      {/* Title + cap track */}
      <Pressable onPress={onToggleExpand} style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, lineHeight: 23.4, color: theme.ink }}>Your lineup</Text>
        <View style={{ width: 122 }}>
          <View style={{ height: 3, borderRadius: 10, backgroundColor: theme.hairline, overflow: 'hidden' }}>
            <View style={{ width: `${capPct}%`, height: 3, borderRadius: 10, backgroundColor: theme.accent }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, lineHeight: 15.6, color: theme.ink }}>Cap left :</Text>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, lineHeight: 15.6, color: theme.ink }}>{capLeft.toFixed(2)}</Text>
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
          {picked.map((lp) => (
            <StockRow
              key={lp.nba_players.id}
              theme={theme}
              player={lp.nba_players}
              price={lp.frozen_price}
              prices={history?.get(lp.nba_players.id) ?? []}
              secondary={lp.nba_players.position}
              onPress={() => onPlayerPress(lp.nba_players.id)}
              onRemove={() => onRemove(lp.nba_players.id)}
              removeDisabled={mutating}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* The export's collapsed sheet stops at the header — the CTA lives in
          the expanded state. It's also surfaced collapsed once the lineup is
          full, so a complete lineup is never a dead end behind a gesture. */}
      {expanded || ready ? (
        <Pressable
          onPress={ready ? onPlaceOrder : onToggleExpand}
          style={{
            height: 48, borderRadius: 100, alignItems: 'center', justifyContent: 'center', marginTop: 4,
            backgroundColor: ready ? theme.ink : theme.surfaceSunken,
          }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: ready ? theme.surface : theme.muted2 }}>
            {cta}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// =============================================================================
// FILTER SHEET — reached from the "Filter" label
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
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }}>Done</Text>
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
// HELP SHEET
// =============================================================================

function HelpSheet({ theme, visible, onClose }: { theme: Theme; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 }}>
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <View style={{ width: 40, height: 5, borderRadius: 100, backgroundColor: theme.hairline2 }} />
          </View>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink, marginBottom: 14 }}>How the Draft Market works</Text>
          <HelpRow theme={theme} title="Prices move" body="Every player is priced by demand. The ticker up top runs the biggest movers on tonight's slate, and the price you draft at is the price you're locked into." />
          <HelpRow theme={theme} title="Form dots" body="The five dots on each card are that player's last 5 games against their own season average — green at or above it, amber within 25%, red below." />
          <HelpRow theme={theme} title="Salary cap" body={`Pick ${LINEUP_SIZE} players that fit inside the $${SALARY_CAP} cap. The sheet at the bottom tracks what you have left.`} last />
          <Pressable onPress={onClose} style={{ height: 48, borderRadius: 100, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', marginTop: 20 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.surface }}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HelpRow({ theme, title, body, last }: { theme: Theme; title: string; body: string; last?: boolean }) {
  return (
    <View style={{ paddingBottom: last ? 0 : 14, marginBottom: last ? 0 : 14, borderBottomWidth: last ? 0 : 1, borderColor: theme.hairline }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: theme.ink, marginBottom: 4 }}>{title}</Text>
      <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, lineHeight: 19 }}>{body}</Text>
    </View>
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
    sectionTitle: { fontFamily: FONT.sansBold, fontSize: 18, lineHeight: 27, color: t.ink },
    searchWrap: {
      flexDirection: 'row' as const, alignItems: 'center' as const, height: 48, paddingHorizontal: 12, gap: 8,
      backgroundColor: t.surfaceSunken, borderRadius: 8,
    },
    filterBadge: {
      minWidth: 14, height: 14, borderRadius: 7,
      backgroundColor: t.accent, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 3,
    },
    chip: {
      flex: 1, height: 22, borderRadius: 100, flexDirection: 'row' as const,
      alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4, paddingHorizontal: 6,
    },
    chipOn: { backgroundColor: GREY_400 },
    chipOff: { backgroundColor: t.surfaceSunken },
    segWrap: { flexDirection: 'row' as const, backgroundColor: t.surfaceSunken, borderRadius: 100, padding: 2 },
    segItem: (active: boolean, theme: Theme) => ({
      paddingVertical: 5, paddingHorizontal: 12, borderRadius: 100, alignItems: 'center' as const,
      backgroundColor: active ? theme.surface : 'transparent',
      borderWidth: active ? 1 : 0, borderColor: theme.hairline,
    }),
    segLabel: (active: boolean, theme: Theme) => ({
      fontFamily: active ? FONT.sansBold : FONT.sansMedium, fontSize: 11, color: active ? theme.ink : theme.muted,
    }),
  };
}
