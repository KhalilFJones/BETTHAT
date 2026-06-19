-- =============================================================================
-- ODDS SYNC SCHEDULER
-- =============================================================================
-- Schedules the sync-odds edge function (The Odds API → nba_games.vegas_total /
-- vegas_spread → pricing factors f_total / f_team_total).
--
-- Credit-aware: The Odds API free tier is 500 req/mo and every call costs
-- (regions × markets) = 2 credits even when no games are returned. So the cron
-- helper SKIPS the call entirely when there are no upcoming games on the board.
--
-- ONCE AFTER DEPLOY (set the function secret so the edge fn can reach the API):
--   supabase secrets set ODDS_API_KEY=<your the-odds-api.com key>
--   (NBA_SYNC_SECRET / SUPABASE_* are already present from the nba sync setup.)
-- =============================================================================

CREATE OR REPLACE FUNCTION internal_call_sync_odds()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        TEXT;
  v_secret     TEXT;
  v_upcoming   INTEGER;
  v_log_id     BIGINT;
  v_request_id BIGINT;
BEGIN
  SELECT value INTO v_url    FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM app_config WHERE key = 'nba_sync_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    INSERT INTO nba_sync_log(triggered_by, status, error_msg)
      VALUES ('cron_odds', 'error', 'Missing supabase_url or nba_sync_secret in app_config')
      RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  -- Conserve Odds API credits: only call when games are actually on the board.
  SELECT COUNT(*) INTO v_upcoming
    FROM nba_games
   WHERE game_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
     AND status NOT IN ('final', 'cancelled', 'postponed');

  IF v_upcoming = 0 THEN
    INSERT INTO nba_sync_log(triggered_by, status, games_today, notes)
      VALUES ('cron_odds', 'skipped', 0, 'no upcoming games — skipped to save Odds API credits')
      RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  INSERT INTO nba_sync_log(triggered_by, status, games_today)
    VALUES ('cron_odds', 'pending', v_upcoming)
    RETURNING id INTO v_log_id;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/sync-odds',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  UPDATE nba_sync_log SET status = 'sent', request_id = v_request_id WHERE id = v_log_id;
  RETURN v_log_id;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO nba_sync_log(triggered_by, status, error_msg)
    VALUES ('cron_odds', 'error', SQLERRM)
    RETURNING id INTO v_log_id;
  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal_call_sync_odds() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION internal_call_sync_odds() IS
  'Called by pg_cron. POSTs to the sync-odds edge function (Vegas total/spread). Skips when no upcoming games to conserve Odds API credits.';

-- Every 4 hours: 6 calls/day × 2 credits ≈ 360/mo, comfortably under the 500/mo
-- free tier, and zero on no-game days thanks to the guard above. Tune as needed.
SELECT cron.unschedule('odds-sync')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'odds-sync');
SELECT cron.schedule('odds-sync', '0 */4 * * *', $$ SELECT internal_call_sync_odds() $$);
