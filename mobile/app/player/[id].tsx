// =============================================================================
// BETTHAT — Player Details ("Detail Stock", Figma redesign)
// Light theme (matches Draft Market / Game Setup / Order Details): a dark
// "Tips off in…" countdown card, Stock Information (avatar + ticker/name +
// Add/Remove button), a Value container (price / base price / change pill),
// an interactive price graph (draggable indicator dot + floating tooltip,
// dashed gridlines, time-range segments), a Tonight's Matchup card, a Last 5
// Games dual-axis bar+line combo chart with a full stats table, and a fixed
// bottom "Draft to Lineup" action.
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, PanResponder, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Circle, Line, Rect, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, playerLastName, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { recomputeLineupCap } from '@/hooks/holygrail/lineupOps';

const TIME_RANGES = ['1D', '1W', '1M', '3M', '1Y'] as const;
type Range = (typeof TIME_RANGES)[number];
const RANGE_LOOKBACK_MS: Record<Range, number> = {
  '1D': 24 * 3600 * 1000,
  '1W': 7 * 24 * 3600 * 1000,
  '1M': 30 * 24 * 3600 * 1000,
  '3M': 90 * 24 * 3600 * 1000,
  '1Y': 365 * 24 * 3600 * 1000,
};

// Matches the "Container" shadow used across every white card in the spec
// (shadowColor #151517 @ 5%, offset 0/2, radius 8, cornerRadius 20) — same
// values as app/matchup/create.tsx's cardShadow().
// Shadow-only — deliberately excludes backgroundColor. The hero card's outer
// shadow-casting layer needs to be dark (#151517) when the tips-off banner is
// showing and white otherwise, so callers set backgroundColor themselves
// instead of getting a hardcoded white from here (which used to bleed a
// sliver of white behind the dark card's rounded corners).
function cardShadow(theme: Theme) {
  return {
    borderRadius: 20,
    shadowColor: '#151517',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: theme.mode === 'light' ? 0.05 : 0,
    shadowRadius: 8,
    elevation: theme.mode === 'light' ? 2 : 0,
  } as const;
}

// =============================================================================
// DATA
// =============================================================================

async function fetchPlayerDetail(playerId: string, userId: string | undefined) {
  const today = new Date().toISOString().slice(0, 10);

  const [playerQ, gameQ, lineupQ, historyQ, last5Q] = await Promise.all([
    supabase.from('nba_players').select('*, player_prices(*)').eq('id', playerId).single(),

    supabase
      .from('player_game_availability')
      .select(`
        game_date,
        nba_games(id, tip_off_time, status, home_score, away_score,
          home_team_abbreviation, away_team_abbreviation, home_team_id, away_team_id, season)
      `)
      .eq('player_id', playerId)
      .eq('game_date', today)
      .maybeSingle(),

    userId
      ? supabase
          .from('lineups')
          .select('id, total_cap_used, lineup_players(player_id, slot_number, frozen_price)')
          .eq('user_id', userId)
          .eq('status', 'building')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('player_id', playerId)
      .order('recorded_at', { ascending: true }),

    supabase
      .from('player_game_stats')
      .select(`
        points, rebounds, assists, steals, blocks, turnovers, fantasy_points, is_final,
        nba_games!inner(game_date, home_team_abbreviation, away_team_abbreviation)
      `)
      .eq('player_id', playerId)
      .eq('is_final', true)
      .order('game_date', { foreignTable: 'nba_games', ascending: false })
      .limit(5),
  ]);

  if (playerQ.error) throw playerQ.error;
  const player: any = playerQ.data;

  const gameRow: any = gameQ.data;
  const game = gameRow?.nba_games ?? null;

  // Opponent + tonight's matchup context.
  let matchup: { isHome: boolean; oppAbbr: string; oppFullName: string; tipOff: string | null; oppRecord: string | null } | null = null;
  if (game) {
    const isHome = player.team_abbreviation === game.home_team_abbreviation;
    const oppAbbr = isHome ? game.away_team_abbreviation : game.home_team_abbreviation;
    const oppTeamId = isHome ? game.away_team_id : game.home_team_id;

    let oppFullName = oppAbbr;
    let oppRecord: string | null = null;
    if (oppTeamId) {
      const [teamQ, recordQ] = await Promise.all([
        supabase.from('nba_teams').select('full_name').eq('id', oppTeamId).maybeSingle(),
        supabase
          .from('nba_games')
          .select('home_team_id, away_team_id, home_score, away_score')
          .eq('season', game.season)
          .eq('status', 'final')
          .or(`home_team_id.eq.${oppTeamId},away_team_id.eq.${oppTeamId}`),
      ]);
      if (teamQ.data?.full_name) oppFullName = teamQ.data.full_name;
      const finals = (recordQ.data ?? []) as any[];
      let w = 0, l = 0;
      for (const g of finals) {
        const oppIsHome = g.home_team_id === oppTeamId;
        const oppScore = oppIsHome ? g.home_score : g.away_score;
        const otherScore = oppIsHome ? g.away_score : g.home_score;
        if (oppScore == null || otherScore == null) continue;
        if (oppScore > otherScore) w++; else l++;
      }
      if (w + l > 0) oppRecord = `${w}-${l}`;
    }

    matchup = { isHome, oppAbbr, oppFullName, tipOff: game.tip_off_time ?? null, oppRecord };
  }

  // Last 5 games, each row's opponent derived the same way.
  const last5 = ((last5Q.data ?? []) as any[]).map((row) => {
    const g = row.nba_games;
    const isHome = g ? player.team_abbreviation === g.home_team_abbreviation : true;
    const opp = g ? (isHome ? g.away_team_abbreviation : g.home_team_abbreviation) : '—';
    return {
      date: g?.game_date ?? null,
      opp,
      pts: row.points ?? 0,
      reb: row.rebounds ?? 0,
      ast: row.assists ?? 0,
      stl: row.steals ?? 0,
      to: row.turnovers ?? 0,
      fp: Number(row.fantasy_points ?? 0),
    };
  });

  const history = ((historyQ.data ?? []) as any[]).map((h) => ({
    price: Number(h.price),
    at: h.recorded_at as string,
  }));

  return {
    player,
    matchup,
    lineup: lineupQ.data as any,
    history,
    last5,
  };
}

// =============================================================================
// SCREEN
// =============================================================================

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuthStore();
  const theme = useTheme();
  const [range, setRange] = useState<Range>('1D');

  const { data, isLoading } = useQuery({
    queryKey: ['player-detail', id, profile?.id],
    queryFn: () => fetchPlayerDetail(id!, profile?.id),
    enabled: !!id,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !data) throw new Error('Not ready');
      const p: any = data.player;
      const pp = Array.isArray(p.player_prices) ? p.player_prices[0] : p.player_prices;
      if (!pp) throw new Error('No price');

      let lineupId = data.lineup?.id;
      if (!lineupId) {
        const { data: l, error } = await supabase
          .from('lineups')
          .insert({
            user_id: profile.id,
            entry_tier: 25,
            status: 'building',
            total_cap_used: 0,
            game_date: new Date().toISOString().slice(0, 10),
          })
          .select('id')
          .single();
        if (error) throw error;
        lineupId = l.id;
      }
      const used = new Set((data.lineup?.lineup_players ?? []).map((lp: any) => lp.slot_number));
      const slot = [1, 2, 3].find((n) => !used.has(n));
      if (!slot) throw new Error('Lineup full');
      const { error: insErr } = await supabase.from('lineup_players').insert({
        lineup_id: lineupId,
        player_id: p.id,
        slot_number: slot,
        frozen_price: pp.current_price,
      });
      if (insErr) throw insErr;
      await recomputeLineupCap(lineupId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-detail', id] });
      qc.invalidateQueries({ queryKey: ['player-market'] });
    },
    onError: (err: any) => Alert.alert('Could not add player', err?.message ?? 'Try again.'),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!data?.lineup?.id) return;
      const p: any = data.player;
      const { error } = await supabase
        .from('lineup_players')
        .delete()
        .eq('lineup_id', data.lineup.id)
        .eq('player_id', p.id);
      if (error) throw error;
      await recomputeLineupCap(data.lineup.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-detail', id] });
      qc.invalidateQueries({ queryKey: ['player-market'] });
    },
    onError: (err: any) => Alert.alert('Could not remove player', err?.message ?? 'Try again.'),
  });

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  const p: any = data.player;
  const pp = Array.isArray(p.player_prices) ? p.player_prices[0] : p.player_prices;
  const isInLineup = (data.lineup?.lineup_players ?? []).some((lp: any) => lp.player_id === p.id);
  const isFull = (data.lineup?.lineup_players ?? []).length >= LINEUP_SIZE;
  const isLocked = !!pp?.is_locked;

  const ctaLabel =
    isLocked ? 'Locked — Not Draftable' :
    isInLineup ? 'Remove from Lineup' :
    isFull ? 'Lineup Full' :
    'Draft to Lineup';
  const ctaDisabled = isLocked || (isFull && !isInLineup) || addMutation.isPending || removeMutation.isPending;

  const priceChange = pp ? Number(pp.current_price) - Number(pp.base_price ?? pp.current_price) : 0;
  const basePrice = Number(pp?.base_price ?? pp?.current_price ?? 0);
  const pctChange = basePrice !== 0 ? (priceChange / basePrice) * 100 : 0;
  const priceColor = pctChange >= 0 ? theme.gain : theme.danger;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      {/* Top Bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, color: theme.ink, letterSpacing: -0.2 }}>Player Details</Text>
        <Pressable
          onPress={() => Share.share({ message: `${p.full_name} · ${fmtPrice(pp?.current_price)} on BETTHAT` })}
          hitSlop={12}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
            <Path d="M16 6l-4-4-4 4" />
            <Path d="M12 2v13" />
          </Svg>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        {/* Dark hero wrapper — the "Tips off" strip and the white Stock
            Information card below it are one continuous rounded container
            per the spec (the dark card's corners are all you see behind the
            white card, not a separate bordered banner). Falls back to a
            plain white card when there's no game today to count down to. */}
        <View
          style={{
            marginHorizontal: 16, marginTop: 12,
            backgroundColor: data.matchup?.tipOff ? '#151517' : theme.surface,
            ...cardShadow(theme),
          }}
        >
        <View
          style={{
            borderRadius: 20, overflow: 'hidden',
            backgroundColor: data.matchup?.tipOff ? '#151517' : theme.surface,
          }}
        >
          {data.matchup?.tipOff ? <TipOffBanner theme={theme} tipOff={data.matchup.tipOff} /> : null}

          <View style={{ backgroundColor: theme.surface, padding: 16 }}>
            {/* Stock Information + Button */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>
                  {(p.ticker_handle ?? p.full_name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.muted }}>
                  {(p.ticker_handle ?? playerLastName(p)).toUpperCase()}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.ink, marginTop: 2 }}>
                  {p.full_name}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  if (ctaDisabled) return;
                  if (isInLineup) removeMutation.mutate();
                  else addMutation.mutate();
                }}
                disabled={ctaDisabled}
                style={{
                  height: 40, paddingHorizontal: 16, borderRadius: 999,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: ctaDisabled ? theme.surfaceSunken : theme.ink,
                  borderWidth: 1, borderColor: theme.hairline,
                }}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={ctaDisabled ? theme.muted2 : '#FFFFFF'} strokeWidth={2} strokeLinecap="round">
                  {isInLineup ? <Path d="M5 12h14" /> : <Path d="M12 5v14M5 12h14" />}
                </Svg>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: ctaDisabled ? theme.muted2 : '#FFFFFF' }}>
                  {isLocked ? 'Locked' : isInLineup ? 'Remove' : isFull ? 'Full' : 'Add'}
                </Text>
              </Pressable>
            </View>

            {/* Value container */}
            <View style={{ marginTop: 18 }}>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 32, color: theme.ink, letterSpacing: -0.3 }}>
                {fmtPrice(pp?.current_price)}
              </Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 10, color: '#AAAAAC', marginTop: 2 }}>
                Base Price {fmtPrice(basePrice)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: pctChange >= 0 ? theme.gainSoft : 'rgba(240,93,93,0.12)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: priceColor }}>
                    {pctChange >= 0 ? '+' : ''}{fmtPrice(priceChange)} ({pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%)
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.muted }}>Today</Text>
              </View>
            </View>

            <PriceHistoryGraph history={data.history} theme={theme} range={range} color={priceColor} />

            <TimeRangeSegments value={range} onChange={setRange} theme={theme} />
          </View>
        </View>
        </View>

        {data.matchup ? <TonightsMatchupCard theme={theme} matchup={data.matchup} /> : null}

        {data.last5.length > 0 ? (
          <Last5GamesCard theme={theme} rows={data.last5} seasonAvg={Number(p.season_avg_fpts ?? 0)} />
        ) : null}

        <PriceOverviewCard theme={theme} pp={pp} history={data.history} />
      </ScrollView>

      {/* Bottom Action */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24,
          backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.hairline,
        }}
      >
        <Pressable
          onPress={() => {
            if (ctaDisabled) return;
            if (isInLineup) removeMutation.mutate();
            else addMutation.mutate();
          }}
          disabled={ctaDisabled}
          style={{
            height: 52, borderRadius: 999,
            backgroundColor: ctaDisabled ? theme.surfaceSunken : theme.ink,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: ctaDisabled ? theme.muted2 : theme.bg }}>
            {ctaLabel}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// =============================================================================
// TIPS-OFF COUNTDOWN BANNER (dark card)
// =============================================================================

function TipOffBanner({ theme, tipOff }: { theme: Theme; tipOff: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, new Date(tipOff).getTime() - now);
  const h = Math.floor(remainingMs / 3600_000);
  const m = Math.floor((remainingMs % 3600_000) / 60_000);
  const s = Math.floor((remainingMs % 60_000) / 1000);
  const label = remainingMs > 0 ? `Tips off in ${h}h ${m}m ${s}s` : 'Game in progress';

  return (
    <View style={{ height: 45, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={12} cy={12} r={9} />
        <Path d="M12 7v6l4 2" />
      </Svg>
      <Text style={{ flex: 1, fontFamily: FONT.sansMedium, fontSize: 14, color: '#FFFFFF' }}>{label}</Text>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={12} cy={12} r={9} />
        <Path d="M12 16v-5M12 8h.01" />
      </Svg>
    </View>
  );
}

// =============================================================================
// INTERACTIVE PRICE GRAPH — draggable indicator dot + floating tooltip
// =============================================================================

function PriceHistoryGraph({
  history, theme, range, color,
}: {
  history: Array<{ price: number; at: string }>; theme: Theme; range: Range; color: string;
}) {
  const [w, setW] = useState(0);
  const [touchIdx, setTouchIdx] = useState<number | null>(null);
  const H = 160;
  const padT = 10, padB = 22;

  // Filter to the selected lookback window, then downsample to evenly
  // TIME-spaced points. The live-sync cron writes a tick roughly every
  // second, so the raw array is overwhelmingly today's ticks regardless of
  // range — picking axis labels by array position (first/middle/last) then
  // just repeats "today" for every range past 1D. Bucketing by real elapsed
  // time (not index) makes the 1W/1M/3M/1Y axis labels — and the line itself
  // — actually reflect that range's calendar span.
  const series = useMemo(() => {
    if (history.length === 0) return [];
    const now = Date.now();
    const earliest = new Date(history[0].at).getTime();
    // Don't stretch the window earlier than our oldest real tick — a 1Y
    // range with 2 months of data should show those 2 months, not fabricate
    // empty space before them.
    const start = Math.max(now - RANGE_LOOKBACK_MS[range], earliest);
    const windowed = history.filter((h) => new Date(h.at).getTime() >= start);
    if (windowed.length < 2) return history.slice(-2);

    const BUCKETS = 28;
    const span = now - start || 1;
    const out: typeof windowed = [];
    let cursor = 0;
    for (let b = 0; b <= BUCKETS; b++) {
      const target = start + (span * b) / BUCKETS;
      while (cursor < windowed.length - 1 && new Date(windowed[cursor + 1].at).getTime() <= target) cursor++;
      out.push(windowed[cursor]);
    }
    // Drop consecutive duplicate picks (happens near the sparse end of the window).
    return out.filter((h, i) => i === 0 || h.at !== out[i - 1].at);
  }, [history, range]);

  const geom = useMemo(() => {
    if (w === 0 || series.length < 2) return null;
    const vals = series.map((h) => h.price);
    let min = Math.min(...vals), max = Math.max(...vals);
    const spread = max - min || Math.abs(max) || 1;
    min -= spread * 0.15; max += spread * 0.15;
    const innerH = H - padT - padB;
    const x = (i: number) => (i / (series.length - 1)) * w;
    const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
    const line = series.map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(h.price).toFixed(1)}`).join(' ');
    const area = `${line} L${x(series.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L0,${(H - padB).toFixed(1)} Z`;
    const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => max - f * (max - min));
    return { x, y, line, area, gridVals };
  }, [w, series]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => scrub(e.nativeEvent.locationX),
        onPanResponderMove: (e) => scrub(e.nativeEvent.locationX),
        onPanResponderRelease: () => setTouchIdx(null),
        onPanResponderTerminate: () => setTouchIdx(null),
        // Without this, the parent ScrollView steals the touch the moment the
        // drag drifts vertically even slightly — that fires onPanResponderTerminate
        // mid-gesture and snaps the dot back to its default position while the
        // finger is still down. Refusing the release keeps this responder in
        // control for the whole drag; it lets go on its own via onPanResponderRelease.
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, series.length],
  );

  function scrub(localX: number) {
    if (w === 0 || series.length < 2) return;
    const frac = localX / w;
    const idx = Math.round(Math.max(0, Math.min(1, frac)) * (series.length - 1));
    setTouchIdx(idx);
  }

  if (series.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>No price history yet.</Text>
      </View>
    );
  }

  const activeIdx = touchIdx ?? series.length - 1;
  // `geom` is still null on the very first render — `series.length >= 2` is
  // true but the container hasn't been measured by onLayout yet (w === 0).
  const ix = geom ? geom.x(activeIdx) : 0;
  const iy = geom ? geom.y(series[activeIdx].price) : 0;
  const isTimeOfDay = range === '1D';
  // 5 evenly time-spaced labels (matches the spec's axis density) — indices
  // into `series`, which is itself already bucketed to even time intervals,
  // so these correctly span the selected range instead of clustering on
  // whichever moment has the most raw ticks.
  const axisLabelIdxs = [0, 1, 2, 3, 4].map((i) => Math.round((i / 4) * (series.length - 1)));

  return (
    <View style={{ marginTop: 16 }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: H }} {...panResponder.panHandlers}>
        {geom && w > 0 && (
          <>
            <Svg width={w} height={H}>
              <Defs>
                <LinearGradient id="playerPriceGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                  <Stop offset="1" stopColor={color} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {geom.gridVals.map((gv, i) => (
                <Line key={i} x1={0} y1={geom.y(gv)} x2={w} y2={geom.y(gv)} stroke={theme.hairline2} strokeWidth={1} strokeDasharray="3 5" />
              ))}
              <Path d={geom.area} fill="url(#playerPriceGrad)" />
              <Path d={geom.line} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              {touchIdx != null && (
                <Line x1={ix} y1={0} x2={ix} y2={H - padB} stroke={theme.hairline2} strokeWidth={1} strokeDasharray="3 4" />
              )}
              <Circle cx={ix} cy={iy} r={6} fill={color} />
              <Circle cx={ix} cy={iy} r={4} fill={theme.surface} />
            </Svg>

            {/* Floating value tooltip */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', top: 0,
                left: Math.max(0, Math.min(w - 96, ix - 48)),
                backgroundColor: theme.ink, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
              }}
            >
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: theme.bg, textAlign: 'center' }}>
                {fmtPrice(series[activeIdx].price)}
              </Text>
            </View>
          </>
        )}
      </View>
      {/* Time-of-day / date axis labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {axisLabelIdxs.map((idx, i) => (
          <Text key={i} style={{ fontFamily: FONT.mono, fontSize: 9, color: theme.muted2 }}>
            {formatAxisLabel(series[idx].at, isTimeOfDay)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function formatAxisLabel(iso: string, timeOfDay: boolean): string {
  const d = new Date(iso);
  if (timeOfDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TimeRangeSegments({ value, onChange, theme }: { value: Range; onChange: (r: Range) => void; theme: Theme }) {
  return (
    <View style={{ marginTop: 14, flexDirection: 'row', backgroundColor: theme.surfaceSunken, borderRadius: 999, padding: 2 }}>
      {TIME_RANGES.map((r) => {
        const active = r === value;
        return (
          <Pressable key={r} onPress={() => onChange(r)} style={{ flex: 1, paddingVertical: 7, borderRadius: 999, alignItems: 'center', backgroundColor: active ? theme.surface : 'transparent', borderWidth: active ? 1 : 0, borderColor: theme.hairline }}>
            <Text style={{ fontFamily: active ? FONT.sansMedium : FONT.sans, fontSize: 12, color: active ? theme.ink : theme.muted }}>{r}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// =============================================================================
// TONIGHT'S MATCHUP
// =============================================================================

function TonightsMatchupCard({
  theme, matchup,
}: {
  theme: Theme;
  matchup: { isHome: boolean; oppFullName: string; tipOff: string | null; oppRecord: string | null };
}) {
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, padding: 16, backgroundColor: theme.surface, ...cardShadow(theme) }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink, marginBottom: 10 }}>Tonight's Matchup</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
        {matchup.isHome ? 'Home' : 'Away'}
      </Text>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink, marginTop: 2 }}>
        vs. {matchup.oppFullName}{matchup.oppRecord ? ` (${matchup.oppRecord})` : ''}
      </Text>
      {matchup.tipOff ? (
        <Text style={{ fontFamily: FONT.mono, fontSize: 12, color: theme.muted, marginTop: 6 }}>
          {new Date(matchup.tipOff).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} ET
        </Text>
      ) : null}
    </View>
  );
}

// =============================================================================
// LAST 5 GAMES — dual-axis bar (FP) + connected-dot (% of season avg) combo
// =============================================================================

interface Last5Row { date: string | null; opp: string; pts: number; reb: number; ast: number; stl: number; to: number; fp: number; }

// Figma one-off accents not in the shared theme ramp — the "Additional/Graph"
// teal used only for this line+dot series, and two greyscale rungs (300/400)
// this table needs that theme.ts doesn't define (it only covers 0/50/100/200/
// 500/600/700/800/900).
const GRAPH_TEAL = '#47ADA6';
const GREY_300 = '#C4C4C5';
const GREY_400 = '#AAAAAC';

function Last5GamesCard({ theme, rows, seasonAvg }: { theme: Theme; rows: Last5Row[]; seasonAvg: number }) {
  const chrono = [...rows].reverse(); // oldest → newest, G1..G5
  // Left axis is fantasy points in nice round steps of 10 up to the next
  // multiple of 10 above the max (matches the spec's fixed 0/10/20/30/40/50F
  // ladder); right axis is always a fixed 0-100% ladder — the bars (FP) and
  // the line (each game's FP as a % of season average) share the same 6
  // gridline rows but read off two different scales.
  const maxFp = Math.max(10, Math.ceil(Math.max(...chrono.map((r) => r.fp), 1) / 10) * 10);
  const W = 320, H = 190, padB = 24, padT = 10, padL = 28, padR = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const gap = innerW / chrono.length;
  const barW = gap * 0.42;
  const barX = (i: number) => padL + i * gap + (gap - barW) / 2;
  const yForFp = (v: number) => padT + innerH * (1 - v / maxFp);
  const barH = (v: number) => innerH - (yForFp(v) - padT);
  const yForPct = (pct: number) => padT + innerH * (1 - pct / 100);
  const ratio = (fp: number) => (seasonAvg > 0 ? Math.min(200, (fp / seasonAvg) * 100) : 0);
  const dotCx = (i: number) => padL + i * gap + gap / 2;
  const linePath = chrono.map((r, i) => `${i === 0 ? 'M' : 'L'}${dotCx(i).toFixed(1)},${yForPct(ratio(r.fp)).toFixed(1)}`).join(' ');

  const avg = (key: keyof Last5Row) => (chrono.reduce((s, r) => s + Number(r[key] ?? 0), 0) / chrono.length);

  // 6 evenly spaced gridline rows — F-scale descending on the left, %-scale
  // descending on the right, both anchored to the same row position.
  const gridRows = [5, 4, 3, 2, 1, 0].map((step) => ({
    y: padT + innerH * (1 - step / 5),
    fLabel: `${Math.round((maxFp / 5) * step)}F`,
    pctLabel: `${step * 20}%`,
  }));

  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, padding: 16, backgroundColor: theme.surface, ...cardShadow(theme) }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink, marginBottom: 4 }}>Last 5 Games</Text>

      {/* Legend — yellow (bars) = Fantasy Avg, teal (line) = Season Average Ratio */}
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }} />
          <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.ink }}>Fantasy Avg</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GRAPH_TEAL }} />
          <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.ink }}>Season Average Ratio</Text>
        </View>
      </View>

      <View style={{ width: '100%', aspectRatio: W / H }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          {gridRows.map((g, i) => (
            <React.Fragment key={i}>
              <Line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={theme.hairline2} strokeWidth={1} strokeDasharray="3 4" />
              <SvgText x={padL - 6} y={g.y + 3.5} fontSize={9} fontFamily={FONT.mono} fill={theme.muted2} textAnchor="end">{g.fLabel}</SvgText>
              <SvgText x={W - padR + 6} y={g.y + 3.5} fontSize={9} fontFamily={FONT.mono} fill={theme.muted2}>{g.pctLabel}</SvgText>
            </React.Fragment>
          ))}
          {chrono.map((r, i) => (
            <Rect key={i} x={barX(i)} y={yForFp(r.fp)} width={barW} height={Math.max(1, barH(r.fp))} rx={3} fill={theme.accent} />
          ))}
          <Path d={linePath} stroke={GRAPH_TEAL} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {chrono.map((r, i) => (
            <Circle key={i} cx={dotCx(i)} cy={yForPct(ratio(r.fp))} r={3.5} fill={GRAPH_TEAL} />
          ))}
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', paddingLeft: 28, paddingRight: 32, justifyContent: 'space-around', marginTop: 2 }}>
        {chrono.map((_, i) => (
          <Text key={i} style={{ fontFamily: FONT.mono, fontSize: 9, color: theme.muted2 }}>G{i + 1}</Text>
        ))}
      </View>

      {/* Stats table */}
      <View style={{ marginTop: 16 }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8 }}>
          {['DATE', 'OPP', 'PTS', 'REB', 'AST', 'STL', 'TO', 'FP'].map((h) => (
            <Text key={h} style={{ flex: h === 'DATE' ? 1.4 : 1, fontFamily: FONT.sans, fontSize: 9, color: GREY_300, textAlign: h === 'DATE' || h === 'OPP' ? 'left' : 'right' }}>
              {h}
            </Text>
          ))}
        </View>
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: theme.hairline }}>
            <Text style={{ flex: 1.4, fontFamily: FONT.sans, fontSize: 11, color: GREY_400 }}>
              {r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
            </Text>
            <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink }}>{r.opp}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 11, color: GREY_400, textAlign: 'right' }}>{r.pts}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 11, color: GREY_400, textAlign: 'right' }}>{r.reb}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 11, color: GREY_400, textAlign: 'right' }}>{r.ast}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 11, color: GREY_400, textAlign: 'right' }}>{r.stl}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 11, color: GREY_400, textAlign: 'right' }}>{r.to}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: GREY_400, textAlign: 'right' }}>{r.fp.toFixed(1)}</Text>
          </View>
        ))}
        {/* Bolded Avg row */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: theme.hairline }}>
          <Text style={{ flex: 1.4, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink }}>Avg</Text>
          <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 11 }} />
          <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink, textAlign: 'right' }}>{avg('pts').toFixed(1)}</Text>
          <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink, textAlign: 'right' }}>{avg('reb').toFixed(1)}</Text>
          <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink, textAlign: 'right' }}>{avg('ast').toFixed(1)}</Text>
          <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink, textAlign: 'right' }}>{avg('stl').toFixed(1)}</Text>
          <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink, textAlign: 'right' }}>{avg('to').toFixed(1)}</Text>
          <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink, textAlign: 'right' }}>{avg('fp').toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// PRICE OVERVIEW — Previous Close / Open / High / Low / Volume / Market Cap
// =============================================================================

function PriceOverviewCard({
  theme, pp, history,
}: {
  theme: Theme;
  pp: { current_price?: number; base_price?: number; demand_count_1h?: number | null; total_selections?: number | null } | null;
  history: Array<{ price: number; at: string }>;
}) {
  const currentPrice = Number(pp?.current_price ?? 0);
  const basePrice = Number(pp?.base_price ?? currentPrice);

  const today = new Date().toISOString().slice(0, 10);
  const todayTicks = history.filter((h) => h.at.slice(0, 10) === today);
  // "Previous close" is the last tick strictly before today — yesterday's
  // final recorded price — falling back to base price when there's none.
  const priorTicks = history.filter((h) => h.at.slice(0, 10) < today);

  const open = todayTicks.length > 0 ? todayTicks[0].price : basePrice;
  const high = todayTicks.length > 0 ? Math.max(...todayTicks.map((h) => h.price)) : currentPrice;
  const low = todayTicks.length > 0 ? Math.min(...todayTicks.map((h) => h.price)) : currentPrice;
  const previousClose = priorTicks.length > 0 ? priorTicks[priorTicks.length - 1].price : basePrice;
  const volume = pp?.total_selections ?? pp?.demand_count_1h ?? 0;
  const marketCap = currentPrice * (pp?.total_selections ?? 0);

  const rows: Array<[string, string]> = [
    ['Previous Close', fmtPrice(previousClose)],
    ['Open', fmtPrice(open)],
    ['High', fmtPrice(high)],
    ['Low', fmtPrice(low)],
    ['Volume', String(volume)],
    ['Market Cap', fmtPrice(marketCap)],
  ];

  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 8, padding: 16, backgroundColor: theme.surface, ...cardShadow(theme) }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink, marginBottom: 10 }}>Price Overview</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ width: '50%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingRight: 8 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>{label}</Text>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
