// =============================================================================
// sync-odds — pulls NBA game totals + spreads from The Odds API and writes them
// onto nba_games.vegas_total / nba_games.vegas_spread, which feed the pricing
// engine's f_total / f_team_total factors (v_player_fair_value).
//
// Data source: The Odds API (https://the-odds-api.com) — keyed, datacenter-safe.
//   GET /v4/sports/basketball_nba/odds?regions=us&markets=totals,spreads
//
// Cost: 1 request = (regions × markets) = 2 credits. Free tier = 500/mo, so the
// cron guards on "are there upcoming games?" before spending a credit.
//
// Auth (verify_jwt disabled, see config.toml):
//   1. Internal cron: x-sync-secret header == NBA_SYNC_SECRET
//   2. Manual:        Authorization: Bearer <service_role_key>
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY') ?? '';
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ODDS_URL =
  'https://api.the-odds-api.com/v4/sports/basketball_nba/odds/' +
  `?regions=us&markets=totals,spreads&oddsFormat=american&apiKey=${ODDS_API_KEY}`;

// The Odds API returns canonical full names; map any that differ from ours here.
const TEAM_ALIASES: Record<string, string> = {
  'la clippers': 'los angeles clippers',
};

interface OddsOutcome { name: string; point?: number }
interface OddsMarket { key: string; outcomes: OddsOutcome[] }
interface OddsBookmaker { key: string; markets: OddsMarket[] }
interface OddsEvent {
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

const norm = (s: string) => {
  const k = s.trim().toLowerCase();
  return TEAM_ALIASES[k] ?? k;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** full team name (lowercased) → our abbreviation */
async function buildTeamMap(): Promise<Map<string, string>> {
  const { data } = await supabase.from('nba_teams').select('abbreviation, full_name, city, name');
  const m = new Map<string, string>();
  for (const t of (data ?? []) as any[]) {
    if (t.full_name) m.set(norm(t.full_name), t.abbreviation);
    if (t.city && t.name) m.set(norm(`${t.city} ${t.name}`), t.abbreviation);
  }
  return m;
}

/** Consensus across books: median-ish via average of the per-book points. */
function consensus(ev: OddsEvent): { total: number | null; homeSpread: number | null } {
  const totals: number[] = [];
  const homeSpreads: number[] = [];
  for (const bk of ev.bookmakers ?? []) {
    for (const mk of bk.markets ?? []) {
      if (mk.key === 'totals') {
        const o = mk.outcomes.find((x) => typeof x.point === 'number');
        if (o?.point != null) totals.push(o.point);
      } else if (mk.key === 'spreads') {
        const home = mk.outcomes.find((x) => norm(x.name) === norm(ev.home_team));
        if (home?.point != null) homeSpreads.push(home.point);
      }
    }
  }
  return { total: avg(totals), homeSpread: avg(homeSpreads) };
}

async function syncOdds(): Promise<object> {
  if (!ODDS_API_KEY) return { error: 'ODDS_API_KEY not configured' };

  const res = await fetch(ODDS_URL);
  const remaining = res.headers.get('x-requests-remaining');
  if (!res.ok) return { error: `odds api ${res.status}`, body: (await res.text()).slice(0, 300) };
  const events = (await res.json()) as OddsEvent[];

  const teamMap = await buildTeamMap();
  let matched = 0;
  let updated = 0;
  const unmatched: string[] = [];

  for (const ev of events) {
    const home = teamMap.get(norm(ev.home_team));
    const away = teamMap.get(norm(ev.away_team));
    if (!home || !away) {
      unmatched.push(`${ev.away_team} @ ${ev.home_team}`);
      continue;
    }
    const { total, homeSpread } = consensus(ev);
    if (total == null && homeSpread == null) continue;

    // Match our game by the two teams within ±1 day of tip-off (UTC date drift).
    const d = new Date(ev.commence_time);
    const lo = new Date(d.getTime() - 36 * 3600 * 1000).toISOString().slice(0, 10);
    const hi = new Date(d.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);

    const { data: games } = await supabase
      .from('nba_games')
      .select('id')
      .eq('home_team_abbreviation', home)
      .eq('away_team_abbreviation', away)
      .gte('game_date', lo)
      .lte('game_date', hi)
      .not('status', 'in', '("final","cancelled","postponed")')
      .limit(1);

    const game = (games ?? [])[0] as { id: string } | undefined;
    if (!game) continue;
    matched++;

    const patch: Record<string, number> = {};
    if (total != null) patch.vegas_total = Math.round(total * 10) / 10;
    if (homeSpread != null) patch.vegas_spread = Math.round(homeSpread * 10) / 10;

    const { error } = await supabase.from('nba_games').update(patch).eq('id', game.id);
    if (!error) updated++;
  }

  return { events: events.length, matched, updated, unmatched, credits_remaining: remaining };
}

Deno.serve(async (req) => {
  const syncSecret = Deno.env.get('NBA_SYNC_SECRET') ?? '';
  const incomingSecret = req.headers.get('x-sync-secret') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const isServiceRole = authHeader.startsWith('Bearer ') && authHeader.split(' ')[1] === SERVICE_KEY;
  const isCronCall = syncSecret.length > 0 && incomingSecret === syncSecret;
  if (!isServiceRole && !isCronCall) return resp(401, { error: 'unauthorized' });

  try {
    return resp(200, await syncOdds());
  } catch (e: any) {
    console.error('sync-odds error:', e);
    return resp(500, { error: e.message });
  }
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
