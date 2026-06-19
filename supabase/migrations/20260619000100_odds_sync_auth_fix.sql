-- =============================================================================
-- ODDS SYNC — GATEWAY AUTH FIX
-- =============================================================================
-- Supabase's function gateway requires an apikey/Authorization header on every
-- /functions/v1 call, even when the function itself has verify_jwt = false. The
-- pg_cron → pg_net call only sent x-sync-secret, so it would 401 at the gateway.
-- Fix: also send the public anon key as a Bearer token (the function still does
-- its own x-sync-secret authorization). The anon key is public (embedded in the
-- mobile client), so storing it in app_config is safe.
--
-- NOTE: internal_call_nba_sync() (20260521000001) has the same gateway gap and
-- should get the same Authorization header — flagged for a follow-up.
-- =============================================================================

INSERT INTO app_config(key, value, description, is_secret, updated_at) VALUES
  ('supabase_anon_key',
   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5bmhwd2xqcW14YWtjcWZ4c3h0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1Mjk2MTEsImV4cCI6MjA5NDEwNTYxMX0.06_iIi-v081O-9QWkfumTbNk3HLx88cUvLboRrv4OOk',
   'Public anon key — sent as the gateway Authorization header for internal cron → edge function calls.',
   false, now())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = now();

CREATE OR REPLACE FUNCTION internal_call_sync_odds()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        TEXT;
  v_secret     TEXT;
  v_anon       TEXT;
  v_upcoming   INTEGER;
  v_log_id     BIGINT;
  v_request_id BIGINT;
BEGIN
  SELECT value INTO v_url    FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM app_config WHERE key = 'nba_sync_secret';
  SELECT value INTO v_anon   FROM app_config WHERE key = 'supabase_anon_key';

  IF v_url IS NULL OR v_secret IS NULL OR v_anon IS NULL THEN
    INSERT INTO nba_sync_log(triggered_by, status, error_msg)
      VALUES ('cron_odds', 'error', 'Missing supabase_url / nba_sync_secret / supabase_anon_key in app_config')
      RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

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
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon,  -- satisfies the function gateway
      'apikey',        v_anon,
      'x-sync-secret', v_secret               -- authorizes inside the function
    ),
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
