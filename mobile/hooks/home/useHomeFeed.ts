import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// =============================================================================
// Home feed — one consolidated fetch for the redesigned home screen.
//
// Feeds four sections: the hero game carousel, Live Games, Trending Players
// (with 6h sparkline history) and the player-news grid. Kept in a single hook
// so the screen stays a rendering layer.
// =============================================================================

export type HomeFilter = 'trending' | 'live' | 'tonight' | 'tomorrow';

export interface HomeGame {
  id: string;
  game_date: string;
  tip_off_time: string | null;
  status: string;
  period: number | null;
  game_clock: string | null;
  home_team: string; away_team: string;
  home_team_abbreviation: string; away_team_abbreviation: string;
  home_score: number | null; away_score: number | null;
  home_color: string | null; away_color: string | null;
  home_record: string | null; away_record: string | null;
}

export interface TrendingPlayer {
  id: string;
  ticker: string;
  team: string;
  full_name: string;
  price: number;
  change: number;
  pct: number;
  history: number[];
  headshot_url: string | null;
}

/** The face a team is sold on — its most expensive player. */
export interface TeamStar {
  full_name: string;
  headshot_url: string | null;
  /** Licensed action shot when one exists; the poster falls back to the headshot. */
  action_photo_url: string | null;
}

export interface NewsItem {
  id: string;
  headline: string;
  body: string | null;
  impact: string | null;
  published_at: string;
  player_name: string | null;
  player_id: string | null;
  team: string | null;
  headshot_url: string | null;
}

export function useHomeFeed(userId: string | undefined) {
  return useQuery({
    queryKey: ['home-feed', userId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      // A game that tipped late last night can still be live now.
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

      const [teamsQ, gamesQ, pricesQ, newsQ, starsQ] = await Promise.all([
        supabase.from('nba_teams').select('abbreviation, primary_color'),
        supabase
          .from('nba_games')
          .select(`id, game_date, tip_off_time, status, period, game_clock,
                   home_team, away_team, home_team_abbreviation, away_team_abbreviation,
                   home_score, away_score`)
          .gte('game_date', yesterday)
          .lte('game_date', tomorrow)
          .order('tip_off_time', { ascending: true }),
        supabase
          .from('player_prices')
          .select(`player_id, current_price, price_change_24h, price_change_pct_24h, demand_count_1h,
                   nba_players!inner(id, full_name, ticker_handle, team_abbreviation, headshot_url)`)
          .order('demand_count_1h', { ascending: false })
          .limit(8),
        supabase
          .from('player_news')
          .select(`id, headline, body, impact, published_at,
                   nba_players(id, full_name, team_abbreviation, headshot_url)`)
          .order('published_at', { ascending: false })
          .limit(6),
        // Every priced player, most expensive first. Reduced below to one face
        // per team — PostgREST has no DISTINCT ON, so the pick happens here
        // rather than in a bespoke RPC.
        supabase
          .from('player_prices')
          .select('current_price, nba_players!inner(full_name, headshot_url, action_photo_url, team_abbreviation)')
          .not('current_price', 'is', null)
          .order('current_price', { ascending: false })
          .limit(400),
      ]);

      const stars = new Map<string, TeamStar>();
      for (const row of ((starsQ.data ?? []) as any[])) {
        const np = row.nba_players;
        if (!np?.team_abbreviation || stars.has(np.team_abbreviation)) continue;
        stars.set(np.team_abbreviation, {
          full_name: np.full_name,
          headshot_url: np.headshot_url ?? null,
          action_photo_url: np.action_photo_url ?? null,
        });
      }

      const colors = new Map(
        ((teamsQ.data ?? []) as any[]).map((t) => [t.abbreviation, t.primary_color as string | null]),
      );

      const allGames: HomeGame[] = ((gamesQ.data ?? []) as any[]).map((g) => ({
        ...g,
        home_color: colors.get(g.home_team_abbreviation) ?? null,
        away_color: colors.get(g.away_team_abbreviation) ?? null,
        home_record: null,
        away_record: null,
      }));


      // Sparkline history for just the trending players, not the whole market.
      const trendingIds = ((pricesQ.data ?? []) as any[]).map((p) => p.player_id);
      const history = new Map<string, number[]>();
      if (trendingIds.length > 0) {
        const { data: hist } = await supabase
          .from('price_history')
          .select('player_id, price, recorded_at')
          .in('player_id', trendingIds)
          .gte('recorded_at', sixHoursAgo)
          .order('recorded_at', { ascending: true });
        for (const h of (hist ?? []) as any[]) {
          const arr = history.get(h.player_id) ?? [];
          arr.push(Number(h.price));
          history.set(h.player_id, arr);
        }
      }

      const trending: TrendingPlayer[] = ((pricesQ.data ?? []) as any[]).map((p) => {
        const np = p.nba_players;
        return {
          id: np?.id ?? p.player_id,
          ticker: (np?.ticker_handle ?? np?.full_name ?? '').toUpperCase(),
          team: np?.team_abbreviation ?? '',
          full_name: np?.full_name ?? 'Unknown',
          price: Number(p.current_price ?? 0),
          change: Number(p.price_change_24h ?? 0),
          pct: Number(p.price_change_pct_24h ?? 0),
          history: history.get(p.player_id) ?? [],
          headshot_url: np?.headshot_url ?? null,
        };
      });

      const news: NewsItem[] = ((newsQ.data ?? []) as any[]).map((n) => ({
        id: n.id,
        headline: n.headline,
        body: n.body,
        impact: n.impact,
        published_at: n.published_at,
        player_name: n.nba_players?.full_name ?? null,
        player_id: n.nba_players?.id ?? null,
        team: n.nba_players?.team_abbreviation ?? null,
        headshot_url: n.nba_players?.headshot_url ?? null,
      }));

      return {
        allGames,
        trending,
        news,
        today,
        stars,
      };
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  });
}

// =============================================================================
// Chip selector
//
// The chips narrow one payload rather than triggering four fetches. Keeping
// this a pure function of (games, filter) means every section on the screen
// reads from the SAME list — previously the hero drew from the unfiltered set
// and only one section responded, so the chips looked inert.
// =============================================================================

export interface FilteredSlate {
  /** Games matching the chip, best-first. */
  games: HomeGame[];
  /** Every team playing in those games — used to narrow the player rails. */
  teams: Set<string>;
  /** Shown on the chip so an empty result is legible before you tap it. */
  counts: Record<HomeFilter, number>;
  /** Why this filter is empty, in the user's terms. */
  emptyCopy: string;
}

function matches(g: HomeGame, filter: HomeFilter, today: string, tomorrow: string): boolean {
  switch (filter) {
    case 'live':
      return g.status === 'live';
    case 'tonight':
      return g.game_date === today && g.status !== 'final';
    case 'tomorrow':
      return g.game_date === tomorrow;
    case 'trending':
    default:
      // Everything still to come, nearest tip-off first.
      return g.status !== 'final';
  }
}

const EMPTY_COPY: Record<HomeFilter, string> = {
  trending: 'No games scheduled right now.',
  live: 'Nothing tipping off at the moment. Check back closer to game time.',
  tonight: "Tonight's slate is done.",
  tomorrow: "Tomorrow's schedule is not out yet.",
};

export function selectSlate(
  data: { allGames: HomeGame[]; today: string } | undefined,
  filter: HomeFilter,
): FilteredSlate {
  const all = data?.allGames ?? [];
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(new Date(today + 'T12:00:00Z').getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

  const counts = {
    trending: 0, live: 0, tonight: 0, tomorrow: 0,
  } as Record<HomeFilter, number>;
  for (const g of all) {
    for (const key of ['trending', 'live', 'tonight', 'tomorrow'] as HomeFilter[]) {
      if (matches(g, key, today, tomorrow)) counts[key] += 1;
    }
  }

  const games = all
    .filter((g) => matches(g, filter, today, tomorrow))
    .sort((a, b) => {
      // Live first — it is the most perishable thing on the page.
      if ((a.status === 'live') !== (b.status === 'live')) return a.status === 'live' ? -1 : 1;
      return (a.tip_off_time ?? '').localeCompare(b.tip_off_time ?? '');
    });

  const teams = new Set<string>();
  for (const g of games) {
    if (g.home_team_abbreviation) teams.add(g.home_team_abbreviation);
    if (g.away_team_abbreviation) teams.add(g.away_team_abbreviation);
  }

  return { games, teams, counts, emptyCopy: EMPTY_COPY[filter] };
}

/**
 * Narrows a player rail to whoever is actually in the selected games.
 *
 * Falls back to the unnarrowed list when the filter leaves nothing — a
 * section that empties out for reasons the user can't see reads as a bug
 * rather than as a filter.
 */
export function narrowToSlate<T extends { team: string | null }>(
  rows: T[],
  teams: Set<string>,
): T[] {
  if (teams.size === 0) return rows;
  const hit = rows.filter((r) => r.team && teams.has(r.team));
  return hit.length > 0 ? hit : rows;
}
