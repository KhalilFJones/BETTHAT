// =============================================================================
// sync-nba-data — pulls live NBA data from ESPN's public API and upserts into:
//   nba_teams, nba_games, nba_players, player_game_availability, player_game_stats
//
// Data source: ESPN Site API (no auth required, free, real-time during games)
//   Scoreboard:  https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
//   Box score:   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={id}
//   Roster:      https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{id}/roster
//
// Invocation modes:
//   POST {} or GET   — sync today's games (called by pg_cron every 2 min during game windows)
//   POST { date: "YYYYMMDD" } — sync a specific date's games
//   POST { event_id: "401873198" } — sync a single game's box score
//
// Auth: service-role key required.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// ESPN status type id → our nba_games.status values
const ESPN_STATUS: Record<string, string> = {
  '1': 'scheduled',
  '2': 'live',
  '3': 'final',
};

// Fantasy points formula (must match settle_matchup RPC):
// pts + reb*1.2 + ast*1.5 + stl*3 + blk*3 - to*1
function calcFP(pts: number, reb: number, ast: number, stl: number, blk: number, to: number): number {
  return pts + reb * 1.2 + ast * 1.5 + stl * 3 + blk * 3 - to;
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetch helper
// ──────────────────────────────────────────────────────────────────────────────
async function espnFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BETTHAT/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status} ${url}`);
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// Upsert a team row from ESPN team object, return our UUID
// ──────────────────────────────────────────────────────────────────────────────
async function upsertTeam(espnTeam: any): Promise<string> {
  // Use abbreviation as conflict key — existing seeded rows have external_id=NULL,
  // so the first sync updates them with ESPN data including the external_id.
  const { data, error } = await supabase
    .from('nba_teams')
    .upsert({
      external_id: espnTeam.id,
      abbreviation: espnTeam.abbreviation,
      full_name: espnTeam.displayName,
      city: espnTeam.location,
      primary_color: `#${espnTeam.color ?? '000000'}`,
      secondary_color: `#${espnTeam.alternateColor ?? 'ffffff'}`,
      logo_url: espnTeam.logo ?? null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'abbreviation', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) throw new Error(`upsertTeam ${espnTeam.abbreviation}: ${error.message}`);
  return data.id;
}

// ──────────────────────────────────────────────────────────────────────────────
// Upsert a player row from ESPN athlete object, return our UUID
// ──────────────────────────────────────────────────────────────────────────────
async function upsertPlayer(athlete: any, teamAbbrev: string, teamId: string): Promise<string> {
  const nameParts = (athlete.displayName ?? '').split(' ');
  const firstName = nameParts[0] ?? '';
  const lastName  = nameParts.slice(1).join(' ') || firstName;

  // Generate a ticker handle like JAMESL23 from last name + jersey number
  const lastNameClean = lastName.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6);
  const jersey        = (athlete.jersey ?? '').replace(/\D/g, '');
  const tickerHandle  = `${lastNameClean}${jersey}`;

  const { data, error } = await supabase
    .from('nba_players')
    .upsert({
      external_id: athlete.id,
      full_name: athlete.displayName,
      first_name: firstName,
      last_name: lastName,
      team: athlete.team?.displayName ?? teamAbbrev,
      team_abbreviation: teamAbbrev,
      nba_team_id: teamId,
      position: athlete.position?.abbreviation ?? 'F',
      jersey_number: athlete.jersey ?? '',
      headshot_url: athlete.headshot?.href ?? null,
      ticker_handle: tickerHandle,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'external_id', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) throw new Error(`upsertPlayer ${athlete.displayName}: ${error.message}`);
  return data.id;
}

// ──────────────────────────────────────────────────────────────────────────────
// Parse ESPN stat array ["7", "23", "8-14", "3-6", "4-4", "5", "3", "2", "1", "1", ...] 
// into a flat map. Compound values like "8-14" expand to made + _attempted.
// ──────────────────────────────────────────────────────────────────────────────
function parseStats(keys: string[], vals: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  keys.forEach((key, i) => {
    const raw = vals[i] ?? '0';
    if (raw.includes('-')) {
      map[key]                    = parseInt(raw.split('-')[0], 10) || 0;
      map[`${key}_attempted`]     = parseInt(raw.split('-')[1], 10) || 0;
    } else {
      map[key] = parseFloat(raw) || 0;
    }
  });
  return map;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sync one game's box score — upserts players and their stats
// ──────────────────────────────────────────────────────────────────────────────
async function syncBoxScore(espnEventId: string, gameUuid: string, gameDate: string, isFinal: boolean): Promise<number> {
  const summary      = await espnFetch(`${ESPN_BASE}/summary?event=${espnEventId}`);
  const playerGroups = summary.boxscore?.players ?? [];
  let   upsertCount  = 0;

  for (const group of playerGroups) {
    const teamData  = group.team;
    const teamId    = await upsertTeam(teamData);
    const statGroup = group.statistics?.[0];
    if (!statGroup) continue;
    const statKeys: string[] = statGroup.keys ?? [];

    for (const entry of (statGroup.athletes ?? [])) {
      const athlete = entry.athlete;
      if (!athlete?.id) continue;
      if (entry.didNotPlay)  continue; // DNP — skip stats row

      const playerId = await upsertPlayer(athlete, teamData.abbreviation, teamId);
      const statMap  = parseStats(statKeys, entry.stats ?? []);

      const pts  = statMap['points']     ?? 0;
      const reb  = statMap['rebounds']   ?? 0;
      const ast  = statMap['assists']    ?? 0;
      const stl  = statMap['steals']     ?? 0;
      const blk  = statMap['blocks']     ?? 0;
      const to   = statMap['turnovers']  ?? 0;
      const fgm  = statMap['fieldGoalsMade-fieldGoalsAttempted']                           ?? 0;
      const fga  = statMap['fieldGoalsMade-fieldGoalsAttempted_attempted']                 ?? 0;
      const tpm  = statMap['threePointFieldGoalsMade-threePointFieldGoalsAttempted']       ?? 0;
      const ftm  = statMap['freeThrowsMade-freeThrowsAttempted']                           ?? 0;
      const fta  = statMap['freeThrowsMade-freeThrowsAttempted_attempted']                 ?? 0;
      const mins = statMap['minutes']    ?? 0;
      const pm   = statMap['plusMinus']  ?? 0;

      const fp   = calcFP(pts, reb, ast, stl, blk, to);

      const { error: statsErr } = await supabase
        .from('player_game_stats')
        .upsert({
          player_id: playerId,
          game_id: gameUuid,
          minutes_played: mins,
          points: pts,
          rebounds: reb,
          assists: ast,
          steals: stl,
          blocks: blk,
          turnovers: to,
          field_goals_made: fgm,
          field_goals_attempted: fga,
          three_pointers_made: tpm,
          free_throws_made: ftm,
          free_throws_attempted: fta,
          plus_minus: pm,
          fantasy_points: fp,
          status: 'active',
          is_final: isFinal,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'player_id,game_id', ignoreDuplicates: false });
      if (statsErr) console.error(`stats upsert ${athlete.displayName}:`, statsErr.message);

      // Mark player as draftable for this game
      const { error: availErr } = await supabase
        .from('player_game_availability')
        .upsert({
          player_id: playerId,
          game_id: gameUuid,
          game_date: gameDate,
          is_draftable: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'player_id,game_id', ignoreDuplicates: false });
      if (availErr) console.error(`avail upsert ${athlete.displayName}:`, availErr.message);

      upsertCount++;
    }
  }

  return upsertCount;
}

// ──────────────────────────────────────────────────────────────────────────────
// For scheduled games: seed player_game_availability from team rosters so
// the draft market shows players before tip-off
// ──────────────────────────────────────────────────────────────────────────────
async function seedAvailabilityFromRosters(
  homeTeamEspn: any, awayTeamEspn: any,
  gameUuid: string, gameDate: string,
  homeTeamId: string, awayTeamId: string,
): Promise<number> {
  let count = 0;

  for (const [teamEspn, teamId] of [[homeTeamEspn, homeTeamId], [awayTeamEspn, awayTeamId]] as [any, string][]) {
    let roster: any;
    try {
      roster = await espnFetch(`${ESPN_BASE}/teams/${teamEspn.id}/roster`);
    } catch (e: any) {
      console.warn(`roster fetch ${teamEspn.abbreviation}:`, e.message);
      continue;
    }

    // ESPN roster groups players by position group — flatten them
    const athleteGroups: any[] = roster.athletes ?? [];
    for (const group of athleteGroups) {
      for (const athlete of (group.items ?? [])) {
        if (!athlete?.id) continue;
        try {
          const playerId = await upsertPlayer(athlete, teamEspn.abbreviation, teamId);
          const { error } = await supabase
            .from('player_game_availability')
            .upsert({
              player_id: playerId,
              game_id: gameUuid,
              game_date: gameDate,
              is_draftable: true,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'player_id,game_id', ignoreDuplicates: false });
          if (!error) count++;
        } catch (e: any) {
          console.warn(`roster player upsert:`, e.message);
        }
      }
    }
  }

  return count;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sync a scoreboard for today or a given date string (format: YYYYMMDD)
// ──────────────────────────────────────────────────────────────────────────────
async function syncScoreboard(dateStr?: string): Promise<object> {
  const url  = dateStr ? `${ESPN_BASE}/scoreboard?dates=${dateStr}` : `${ESPN_BASE}/scoreboard`;
  const data = await espnFetch(url);
  const events: any[] = data.events ?? [];
  const results: any[] = [];

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const espnEventId = event.id as string;
    const statusType  = comp.status?.type?.id as string;
    const isFinal     = statusType === '3';
    const isLive      = statusType === '2';
    const gameStatus  = ESPN_STATUS[statusType] ?? 'scheduled';
    const tipOffTime  = event.date;
    const gameDate    = tipOffTime.slice(0, 10);

    const homeComp = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const awayComp = comp.competitors?.find((c: any) => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;

    const [homeTeamId, awayTeamId] = await Promise.all([
      upsertTeam(homeComp.team),
      upsertTeam(awayComp.team),
    ]);

    const homeScore = parseInt(homeComp.score ?? '0', 10) || 0;
    const awayScore = parseInt(awayComp.score ?? '0', 10) || 0;
    const period    = comp.status?.period ?? 0;
    const clock     = comp.status?.displayClock ?? '';
    const isPlayoffs = String(comp.type?.id) === '16' ||
                       ['SEMI', 'CONF', 'FINAL', 'QUARTER'].includes(comp.type?.abbreviation ?? '');

    const { data: gameRow, error: gameErr } = await supabase
      .from('nba_games')
      .upsert({
        external_id: espnEventId,
        season: String(data.season?.year ?? new Date().getFullYear()),
        home_team: homeComp.team.displayName,
        home_team_abbreviation: homeComp.team.abbreviation,
        away_team: awayComp.team.displayName,
        away_team_abbreviation: awayComp.team.abbreviation,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        game_date: gameDate,
        tip_off_time: tipOffTime,
        status: gameStatus,
        home_score: homeScore,
        away_score: awayScore,
        period,
        game_clock: clock,
        is_playoffs: isPlayoffs,
        arena: comp.venue?.fullName ?? null,
        broadcast: comp.broadcasts?.[0]?.names?.[0] ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id')
      .single();

    if (gameErr) {
      results.push({ event_id: espnEventId, error: gameErr.message });
      continue;
    }

    const gameUuid = gameRow.id;
    let playerCount = 0;

    if (isLive || isFinal) {
      // Fetch live/final box score
      try {
        playerCount = await syncBoxScore(espnEventId, gameUuid, gameDate, isFinal);
      } catch (e: any) {
        console.error(`box score ${espnEventId}:`, e.message);
      }
    } else {
      // Scheduled: seed from rosters so market is populated before tip-off
      try {
        playerCount = await seedAvailabilityFromRosters(
          homeComp.team, awayComp.team, gameUuid, gameDate, homeTeamId, awayTeamId,
        );
      } catch (e: any) {
        console.error(`roster seed ${espnEventId}:`, e.message);
      }
    }

    // When a game goes final, trigger the matchup settling sweep
    if (isFinal) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/score-matchup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({}),
        });
      } catch { /* non-fatal */ }
    }

    results.push({ event_id: espnEventId, game_id: gameUuid, status: gameStatus, players: playerCount });
  }

  return { date: dateStr ?? 'today', games: events.length, results };
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${SERVICE_KEY}`) {
    return resp(401, { error: 'service role required' });
  }

  let body: { date?: string; event_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  try {
    if (body.event_id) {
      const { data: game } = await supabase
        .from('nba_games')
        .select('id, game_date, status')
        .eq('external_id', body.event_id)
        .maybeSingle();
      if (!game) return resp(404, { error: 'game not found — run scoreboard sync first' });
      const count = await syncBoxScore(body.event_id, game.id, game.game_date, game.status === 'final');
      return resp(200, { event_id: body.event_id, players_synced: count });
    }

    const result = await syncScoreboard(body.date);
    return resp(200, result);
  } catch (e: any) {
    console.error('sync-nba-data error:', e);
    return resp(500, { error: e.message });
  }
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
