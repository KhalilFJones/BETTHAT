-- =============================================================================
-- NBA-SYNC GATEWAY AUTH FIX  +  IN-DB PRICING FACTORS (DvP + usage proxy)
-- =============================================================================
-- 1. internal_call_nba_sync() had the same gateway-auth gap as the odds cron
--    (no apikey/Authorization header) — so the automated NBA data sync was
--    almost certainly 401'ing at the function gateway. Add the anon Bearer.
--
-- 2. refresh_in_db_factors() computes two pricing factors from data we already
--    store (player_game_stats) — no external feed, no cost:
--      • Defense-vs-Position → team_position_defense.dvp_multiplier (f_dvp)
--      • Usage rate proxy     → nba_players.usage_rate              (f_usage)
--    Both are sparse until enough box scores accumulate; the machinery is ready
--    and self-updates nightly before the 09:00 recalibration reads them.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix the nba-sync cron's gateway auth (anon Bearer + apikey)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION internal_call_nba_sync(trigger_source TEXT DEFAULT 'cron')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url         TEXT;
  v_secret      TEXT;
  v_anon        TEXT;
  v_games_today INTEGER;
  v_log_id      BIGINT;
  v_request_id  BIGINT;
BEGIN
  SELECT value INTO v_url    FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM app_config WHERE key = 'nba_sync_secret';
  SELECT value INTO v_anon   FROM app_config WHERE key = 'supabase_anon_key';

  IF v_url IS NULL OR v_secret IS NULL OR v_anon IS NULL THEN
    INSERT INTO nba_sync_log(triggered_by, status, error_msg)
      VALUES (trigger_source, 'error', 'Missing supabase_url / nba_sync_secret / supabase_anon_key in app_config')
      RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  SELECT COUNT(*) INTO v_games_today
    FROM nba_games
   WHERE game_date = CURRENT_DATE AND status IN ('scheduled', 'live', 'final');

  INSERT INTO nba_sync_log(triggered_by, status, games_today)
    VALUES (trigger_source, 'pending', v_games_today)
    RETURNING id INTO v_log_id;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/sync-nba-data',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon,   -- gateway
      'apikey',        v_anon,
      'x-sync-secret', v_secret                -- function
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  UPDATE nba_sync_log SET status = 'sent', request_id = v_request_id WHERE id = v_log_id;
  RETURN v_log_id;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO nba_sync_log(triggered_by, status, error_msg)
    VALUES (trigger_source, 'error', SQLERRM)
    RETURNING id INTO v_log_id;
  RETURN v_log_id;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. In-DB factor refresh: DvP + usage proxy from player_game_stats
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_in_db_factors()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_dvp_rows   INT := 0;
  v_usage_rows INT := 0;
BEGIN
  -- ── DvP: fantasy points each team allows to each position vs league average ──
  WITH logs AS (
    SELECT CASE WHEN np.team_abbreviation = g.home_team_abbreviation
                THEN g.away_team_abbreviation ELSE g.home_team_abbreviation END AS def_team,
           np.position,
           pgs.fantasy_points AS fpts
      FROM public.player_game_stats pgs
      JOIN public.nba_players np ON np.id = pgs.player_id
      JOIN public.nba_games    g  ON g.id = pgs.game_id
     WHERE pgs.fantasy_points IS NOT NULL
       AND np.team_abbreviation IN (g.home_team_abbreviation, g.away_team_abbreviation)
  ),
  pos_avg AS (
    SELECT position, AVG(fpts) AS league_avg, COUNT(*) AS n FROM logs GROUP BY position
  ),
  team_pos AS (
    SELECT def_team, position, AVG(fpts) AS allowed, COUNT(*) AS n FROM logs GROUP BY def_team, position
  )
  INSERT INTO public.team_position_defense (team_abbreviation, position, dvp_multiplier, updated_at)
  SELECT tp.def_team, tp.position,
         LEAST(1.5, GREATEST(0.5, tp.allowed / NULLIF(pa.league_avg, 0))),
         NOW()
    FROM team_pos tp
    JOIN pos_avg pa ON pa.position = tp.position
   WHERE pa.league_avg > 0 AND tp.n >= 2   -- need a minimal sample to be meaningful
  ON CONFLICT (team_abbreviation, position)
  DO UPDATE SET dvp_multiplier = EXCLUDED.dvp_multiplier, updated_at = NOW();
  GET DIAGNOSTICS v_dvp_rows = ROW_COUNT;

  -- ── Usage proxy: standard USG% approximation from box-score totals ──
  -- USG% ≈ 100 * (poss * (TmMin/5)) / (Min * TmPoss), aggregated over the season.
  WITH tm_game AS (
    SELECT pgs.game_id, np.team_abbreviation AS team,
           SUM(GREATEST(0, pgs.field_goals_attempted) + 0.44 * GREATEST(0, pgs.free_throws_attempted)
               + GREATEST(0, pgs.turnovers)) AS tm_poss,
           SUM(GREATEST(0, COALESCE(pgs.minutes_played, 0)))             AS tm_min
      FROM public.player_game_stats pgs
      JOIN public.nba_players np ON np.id = pgs.player_id
     GROUP BY pgs.game_id, np.team_abbreviation
  ),
  pl AS (
    SELECT pgs.player_id,
           SUM(GREATEST(0, pgs.field_goals_attempted) + 0.44 * GREATEST(0, pgs.free_throws_attempted)
               + GREATEST(0, pgs.turnovers)) AS p_poss,
           SUM(GREATEST(0, COALESCE(pgs.minutes_played, 0))) AS p_min,
           SUM(tg.tm_poss) AS t_poss,
           SUM(tg.tm_min)  AS t_min
      FROM public.player_game_stats pgs
      JOIN public.nba_players np ON np.id = pgs.player_id
      JOIN tm_game tg ON tg.game_id = pgs.game_id AND tg.team = np.team_abbreviation
     GROUP BY pgs.player_id
  )
  UPDATE public.nba_players np
     SET usage_rate = LEAST(40, GREATEST(5,
           ROUND(((100.0 * pl.p_poss * (pl.t_min / 5.0)) / (NULLIF(pl.p_min, 0) * NULLIF(pl.t_poss, 0)))::numeric, 1)))
    FROM pl
   WHERE np.id = pl.player_id AND pl.p_min > 0 AND pl.t_poss > 0;
  GET DIAGNOSTICS v_usage_rows = ROW_COUNT;

  RETURN jsonb_build_object('dvp_rows', v_dvp_rows, 'usage_rows', v_usage_rows);
END;
$body$;

REVOKE EXECUTE ON FUNCTION public.refresh_in_db_factors() FROM PUBLIC, anon, authenticated;

-- Nightly at 08:00 UTC — before the 09:00 recalibration reads usage/DvP.
SELECT cron.unschedule('refresh-in-db-factors')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-in-db-factors');
SELECT cron.schedule('refresh-in-db-factors', '0 8 * * *', $$ SELECT public.refresh_in_db_factors(); $$);

-- Prime it once now.
SELECT public.refresh_in_db_factors();
