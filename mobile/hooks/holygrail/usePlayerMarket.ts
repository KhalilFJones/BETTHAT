import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Holy Grail Player Market data fetcher. Returns:
//   - tonight: every player playing tonight (with current price + tier)
//   - history: 6h price ticks for sparklines (grouped client-side)
//   - lineup: in-progress lineup (status='building') for the current user
//   - trending: top 6 players by 1h demand
// Heavy single-flight query so the screen doesn't waterfall.

export interface PlayerMarketRow {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string;
  jersey_number: string | null;
  team_abbreviation: string;
  ticker_handle: string | null;
  salary_tier: string | null;
  is_injured: boolean;
  injury_note: string | null;
  season_avg_fpts: number | null;
  last5_avg_fpts: number | null;
  // player_prices.player_id has a unique constraint, so Supabase returns a
  // single object (or null) — not an array.
  player_prices: {
    current_price: number;
    price_change_24h: number | null;
    price_change_pct_24h: number | null;
    is_locked: boolean;
    demand_count_1h: number | null;
    total_selections: number | null;
  } | null;
}

export interface InProgressLineup {
  id: string;
  total_cap_used: number;
  status: string;
  created_at: string;
  lineup_players: Array<{
    slot_number: number;
    frozen_price: number;
    nba_players: {
      id: string;
      full_name: string;
      first_name: string | null;
      last_name: string | null;
      ticker_handle: string | null;
      position: string;
      jersey_number: string | null;
      team_abbreviation: string;
    };
  }>;
}

export interface TrendingRow {
  player_id: string;
  current_price: number;
  price_change_pct_24h: number | null;
  demand_count_1h: number | null;
  nba_players: {
    id: string;
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    ticker_handle: string | null;
    jersey_number: string | null;
    team_abbreviation: string;
    position: string;
  };
}

export interface PriceHistoryRow {
  player_id: string;
  price: number;
  recorded_at: string;
}

export interface MarketData {
  tonight: PlayerMarketRow[];
  history: Map<string, number[]>;
  lineup: InProgressLineup | null;
  trending: TrendingRow[];
}

async function fetchMarket(userId: string, slateDate: string): Promise<MarketData> {
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

  const tonightQ = await supabase
    .from('player_game_availability')
    .select(`
      is_draftable,
      nba_players!inner(
        id, full_name, first_name, last_name, position, jersey_number,
        team_abbreviation, ticker_handle, salary_tier, is_injured, injury_note,
        season_avg_fpts, last5_avg_fpts,
        player_prices(current_price, price_change_24h, price_change_pct_24h, is_locked, demand_count_1h, total_selections)
      )
    `)
    .eq('game_date', slateDate)
    .eq('is_draftable', true);

  const tonightPlayerIds = ((tonightQ.data ?? []) as any[])
    .map((row) => row.nba_players?.id)
    .filter(Boolean);

  const [historyQ, lineupQ, trendingQ] = await Promise.all([
    supabase
      .from('price_history')
      .select('player_id, price, recorded_at')
      .gte('recorded_at', sixHoursAgo)
      .order('recorded_at', { ascending: true }),

    supabase
      .from('lineups')
      .select(`
        id, total_cap_used, status, created_at,
        lineup_players(
          slot_number, frozen_price,
          nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation)
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'building')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    tonightPlayerIds.length > 0
      ? supabase
          .from('player_prices')
          .select(`
            player_id, current_price, price_change_pct_24h, demand_count_1h,
            nba_players!inner(id, full_name, first_name, last_name, ticker_handle, jersey_number, team_abbreviation, position)
          `)
          .in('player_id', tonightPlayerIds)
          .order('demand_count_1h', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const errs = [tonightQ.error, historyQ.error, lineupQ.error, trendingQ.error].filter(Boolean);
  if (errs.length) {
    // Surface the first error so the caller can render a helpful message,
    // but don't throw — partial data is more useful than a blank screen.
    console.warn('Market query partial failure:', errs.map((e) => e?.message));
  }

  // Group history by player → sorted price array
  const history = new Map<string, number[]>();
  for (const h of (historyQ.data ?? []) as PriceHistoryRow[]) {
    const arr = history.get(h.player_id) ?? [];
    arr.push(Number(h.price));
    history.set(h.player_id, arr);
  }

  return {
    tonight: (((tonightQ.data ?? []) as unknown) as Array<{ nba_players: PlayerMarketRow }>).map((r) => r.nba_players),
    history,
    lineup: (lineupQ.data ?? null) as unknown as InProgressLineup | null,
    trending: ((trendingQ.data ?? []) as unknown) as TrendingRow[],
  };
}

export function usePlayerMarket(userId: string | undefined, slateDate?: string) {
  const date = slateDate ?? new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['player-market', userId, date],
    queryFn: () => fetchMarket(userId!, date),
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Upcoming slates — which days have NBA games this week ───────────────────

export interface SlateDay {
  game_date: string;  // YYYY-MM-DD
  has_live: boolean;
  game_count: number;
}

export function useUpcomingSlates() {
  return useQuery({
    queryKey: ['upcoming-slates'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from('nba_games')
        .select('game_date, status')
        .gte('game_date', today)
        .lte('game_date', nextWeek)
        .not('status', 'in', '("postponed","cancelled")')
        .order('game_date', { ascending: true });

      // Group by date, collecting live flag and game count
      const dateMap = new Map<string, { has_live: boolean; game_count: number }>();
      for (const g of (data ?? []) as Array<{ game_date: string; status: string }>) {
        const date = String(g.game_date);
        const existing = dateMap.get(date) ?? { has_live: false, game_count: 0 };
        dateMap.set(date, {
          has_live: existing.has_live || g.status === 'live' || g.status === 'halftime',
          game_count: existing.game_count + 1,
        });
      }
      // Always ensure today appears even if no games yet in DB
      if (!dateMap.has(today)) dateMap.set(today, { has_live: false, game_count: 0 });
      return Array.from(dateMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([game_date, info]) => ({ game_date, ...info })) as SlateDay[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ── Live player stats — polls every 1s during live games ────────────────────
// Returns a map of player_id → { fantasy_points, points, rebounds, assists }
// for the current slate. Merge this over player cards so scores update in real time.
export interface LiveStatRow {
  player_id: string;
  fantasy_points: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
}

export function useLivePlayerStats(playerIds: string[]) {
  return useQuery({
    queryKey: ['live-player-stats', playerIds],
    queryFn: async () => {
      if (playerIds.length === 0) return new Map<string, LiveStatRow>();
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('player_game_stats')
        .select(`
          player_id, fantasy_points, points, rebounds, assists,
          nba_games!inner(game_date, status)
        `)
        .eq('nba_games.game_date', today)
        .in('player_id', playerIds);
      const m = new Map<string, LiveStatRow>();
      for (const r of (data ?? []) as any[]) {
        m.set(r.player_id, {
          player_id: r.player_id,
          fantasy_points: r.fantasy_points,
          points: r.points,
          rebounds: r.rebounds,
          assists: r.assists,
        });
      }
      return m;
    },
    enabled: playerIds.length > 0,
    refetchInterval: (query) => {
      // Only poll at 1s when at least one player has a live game today
      const map = query.state.data;
      if (!map) return 30_000;
      return 1_000;
    },
  });
}
