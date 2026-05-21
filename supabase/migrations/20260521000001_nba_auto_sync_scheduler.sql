-- =============================================================================
-- NBA Auto-Sync Scheduler
--
-- Sets up:
--   1. nba_sync_log      — audit table for all sync runs (success + errors)
--   2. internal.call_nba_sync() — function pg_cron calls to invoke the edge fn
--   3. Two pg_cron schedules:
--        • nba-sync-live   — every 2 min, 7pm–1am ET (23:00–05:00 UTC)
--          Catches live score updates, live box scores, game completion
--        • nba-sync-daily  — every 30 min, rest of day
--          Catches schedule additions, roster updates, injury changes
--
-- ONCE AFTER DEPLOY:
--   In Supabase Dashboard → Edge Functions → sync-nba-data → Secrets, add:
--     NBA_SYNC_SECRET = <the value stored in app_config where key='nba_sync_secret'>
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Sync secret — stored in app_config so pg_cron can read it
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO app_config(key, value, description, is_secret, updated_at) VALUES
  ('supabase_url',    'https://tynhpwljqmxakcqfxsxt.supabase.co',
   'Supabase project URL (used by pg_cron to call edge functions)', false, now()),
  ('nba_sync_secret', '8367f560-dacc-40d9-a09b-8942b0072ace',
   'Shared secret for internal cron → edge function calls (set as NBA_SYNC_SECRET in edge fn)', true, now())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      is_secret = EXCLUDED.is_secret,
      updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sync log table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nba_sync_log (
  id            BIGSERIAL    PRIMARY KEY,
  triggered_by  TEXT         NOT NULL DEFAULT 'cron', -- 'cron_live' | 'cron_daily' | 'manual'
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status        TEXT         NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'error'
  request_id    BIGINT,      -- pg_net async request id
  error_msg     TEXT,
  games_today   INTEGER,     -- how many games were on the schedule when triggered
  notes         TEXT
);

COMMENT ON TABLE nba_sync_log IS
  'Audit log for every automated or manual invocation of the sync-nba-data edge function.';

-- RLS: only service role / admin reads; no direct public access
ALTER TABLE nba_sync_log ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper function called by pg_cron
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
  v_games_today INTEGER;
  v_log_id      BIGINT;
  v_request_id  BIGINT;
BEGIN
  -- Pull config values
  SELECT value INTO v_url    FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM app_config WHERE key = 'nba_sync_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    INSERT INTO nba_sync_log(triggered_by, status, error_msg)
      VALUES (trigger_source, 'error', 'Missing supabase_url or nba_sync_secret in app_config')
      RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  -- Count how many games are scheduled/live today (quick sanity check)
  SELECT COUNT(*) INTO v_games_today
  FROM nba_games
  WHERE game_date = CURRENT_DATE
    AND status IN ('scheduled', 'live', 'final');

  -- Insert pending log row
  INSERT INTO nba_sync_log(triggered_by, status, games_today)
    VALUES (trigger_source, 'pending', v_games_today)
    RETURNING id INTO v_log_id;

  -- Fire async HTTP POST to the edge function
  SELECT net.http_post(
    url     := v_url || '/functions/v1/sync-nba-data',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-sync-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  -- Record the async request id (response arrives later, not checked here)
  UPDATE nba_sync_log
     SET status = 'sent', request_id = v_request_id
   WHERE id = v_log_id;

  RETURN v_log_id;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO nba_sync_log(triggered_by, status, error_msg)
    VALUES (trigger_source, 'error', SQLERRM)
    RETURNING id INTO v_log_id;
  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION internal_call_nba_sync(TEXT) IS
  'Called by pg_cron. POSTs to sync-nba-data edge function with the internal sync secret. Logs every call.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. pg_cron schedules
--
--  LIVE WINDOW  — every 2 minutes, 11pm–5am UTC (7pm–1am Eastern)
--    Handles: live quarter scores, live player stats, game completion detection
--
--  OFF-HOURS    — every 30 minutes, all other hours
--    Handles: daily schedule refresh, roster moves, injury updates, next-game seeding
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove old jobs with these names in case of re-run
SELECT cron.unschedule('nba-sync-live')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nba-sync-live');
SELECT cron.unschedule('nba-sync-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nba-sync-daily');

-- Live game window: every 2 minutes from 11pm UTC → 5am UTC (7pm → 1am Eastern)
SELECT cron.schedule(
  'nba-sync-live',
  '*/2 23,0,1,2,3,4,5 * * *',
  $$ SELECT internal_call_nba_sync('cron_live') $$
);

-- Off-hours refresh: every 30 minutes (outside the live window above)
SELECT cron.schedule(
  'nba-sync-daily',
  '*/30 6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22 * * *',
  $$ SELECT internal_call_nba_sync('cron_daily') $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Convenience view — see last 50 sync runs at a glance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW nba_sync_log_recent AS
SELECT
  id,
  triggered_by,
  started_at AT TIME ZONE 'America/New_York' AS started_at_et,
  status,
  games_today,
  request_id,
  error_msg,
  notes
FROM nba_sync_log
ORDER BY started_at DESC
LIMIT 50;

COMMENT ON VIEW nba_sync_log_recent IS
  'Shows last 50 nba_sync_log rows in Eastern Time — quick health check.';
