-- =============================================================================
-- BETTHAT — PRICING V3: REAL-TIME TICK + MULTI-FACTOR FAIR VALUE
-- =============================================================================
-- Evolves the pricing engine in three ways:
--   1. PER-SECOND ticking (was per-minute).
--   2. ALWAYS MOVING — a player's price drifts every tick from now until their
--      game tips off; it never just sits. (The old "only move in a 3h window"
--      gate is removed; the tip-off LOCK is what stops movement.)
--   3. MULTI-FACTOR fair value — fair price is a recency-weighted projection
--      multiplied by a set of bounded factors. Factors computable from existing
--      data are live now (minutes/role, rest/B2B, teammate-injury usage, home,
--      playoffs, prop-line signal). The data-feed factors (Vegas total/spread,
--      team pace, opponent DvP, usage rate) are NULLABLE HOOKS: the model blends
--      them in automatically the moment a feed populates them, neutral until then.
--
-- Architecture:
--   v_player_fair_value  — one row per active player: base projection × factors
--                          → fair_fpts → slate-scaled fair_price (+ breakdown).
--   refresh_fair_prices()— recompute the fair_price ANCHOR from current factor
--                          data (every few minutes) so injuries / fed lines flow
--                          in WITHOUT resetting the live price.
--   recalibrate_…()      — daily full reset (base = current = fair, scaling).
--   tick_player_prices() — per second: lock started games, then drift every
--                          unlocked active player around its fair_price.
--   snapshot_price_history() — sample history every 30s (not every second).
-- =============================================================================


-- =============================================================================
-- SECTION 1 — SCHEMA: nullable feed hooks + DvP table + config
-- =============================================================================

ALTER TABLE public.nba_games
  ADD COLUMN IF NOT EXISTS vegas_total  NUMERIC,   -- game over/under
  ADD COLUMN IF NOT EXISTS vegas_spread NUMERIC;   -- home margin (negative = home favored)

ALTER TABLE public.nba_teams
  ADD COLUMN IF NOT EXISTS pace       NUMERIC,     -- possessions per 48
  ADD COLUMN IF NOT EXISTS def_rating NUMERIC,     -- pts allowed / 100 poss
  ADD COLUMN IF NOT EXISTS off_rating NUMERIC;     -- pts scored / 100 poss

ALTER TABLE public.nba_players
  ADD COLUMN IF NOT EXISTS usage_rate NUMERIC;     -- % of team possessions used

ALTER TABLE public.player_prices
  ADD COLUMN IF NOT EXISTS fair_price_factors JSONB;  -- breakdown for transparency/debug

-- Defense vs Position: opponent's tendency to allow fantasy production to a
-- given position. 1.0 = league average, >1 = soft matchup, <1 = tough. Fed by a
-- stats provider later; empty table => DvP factor is neutral.
CREATE TABLE IF NOT EXISTS public.team_position_defense (
  team_abbreviation TEXT NOT NULL,
  position          TEXT NOT NULL,
  dvp_multiplier    NUMERIC NOT NULL DEFAULT 1.0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_abbreviation, position)
);
ALTER TABLE public.team_position_defense ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tpd_read_all ON public.team_position_defense;
CREATE POLICY tpd_read_all ON public.team_position_defense FOR SELECT USING (true);

INSERT INTO public.app_config (key, value, description, is_secret) VALUES
  ('price_tick_seconds',  '1',  'Seconds between live price ticks (1-59). Lower = more real-time, more DB load.', false),
  ('fair_refresh_minutes','5',  'Minutes between fair-value anchor refreshes (folds in injuries / fed lines intraday).', false)
ON CONFLICT (key) DO NOTHING;


-- =============================================================================
-- SECTION 2 — FAIR VALUE VIEW (projection × bounded factors → slate-scaled price)
-- =============================================================================
-- League-average normalizers (neutralize a factor when its feed is absent):
--   pace 100 poss/48 · game total 230 · team total 115 · usage 20%.
-- Every factor is COALESCE'd to 1.0 and clamped, so missing data == neutral.

CREATE OR REPLACE VIEW public.v_player_fair_value AS
WITH next_game AS (
  SELECT DISTINCT ON (pga.player_id)
         pga.player_id,
         g.id          AS game_id,
         g.game_date,
         g.tip_off_time,
         g.is_playoffs,
         g.vegas_total,
         g.vegas_spread,
         g.home_team_abbreviation,
         g.away_team_abbreviation
    FROM public.player_game_availability pga
    JOIN public.nba_games g ON g.id = pga.game_id
   WHERE g.game_date >= CURRENT_DATE
     AND g.status NOT IN ('final','postponed','cancelled')
   ORDER BY pga.player_id, g.game_date, g.tip_off_time ASC NULLS LAST
),
factored AS (
  SELECT
    np.id   AS player_id,
    np.is_injured,
    np.salary_tier,
    ng.game_id,
    ng.tip_off_time,

    -- ── Base projection: recency-weighted, optionally blended with prop signal
    (CASE
       WHEN COALESCE(np.last5_games_played,0) > 0 AND COALESCE(np.last5_avg_fpts,0) > 0
         THEN 0.35 * GREATEST(0, np.season_avg_fpts) + 0.65 * GREATEST(0, np.last5_avg_fpts)
       WHEN COALESCE(np.season_avg_fpts,0) > 0
         THEN GREATEST(0, np.season_avg_fpts)
       ELSE 0
     END) AS model_fpts,

    -- prop-implied fpts from this game's prop lines (pts + reb*1.2 + ast*1.5 + blk*3)
    (SELECT SUM(CASE pl.stat_category
                  WHEN 'points'   THEN pl.line_value
                  WHEN 'rebounds' THEN pl.line_value * 1.2
                  WHEN 'assists'  THEN pl.line_value * 1.5
                  WHEN 'blocks'   THEN pl.line_value * 3.0
                  ELSE 0 END)
       FROM public.prop_lines pl
      WHERE pl.player_id = np.id AND pl.game_id = ng.game_id AND pl.is_active) AS prop_fpts,

    (COALESCE(np.last5_games_played,0) > 0 OR COALESCE(np.season_avg_fpts,0) > 0) AS has_data,

    -- ── f_minutes: role / usage trend (biggest counting-stat driver)
    LEAST(1.30, GREATEST(0.70,
      CASE WHEN COALESCE(np.season_avg_min,0) > 0
           THEN COALESCE(np.last5_avg_min, np.season_avg_min) / np.season_avg_min
           ELSE 1.0 END)) AS f_minutes,

    -- ── f_home
    CASE WHEN ng.home_team_abbreviation IS NULL THEN 1.00
         WHEN ng.home_team_abbreviation = np.team_abbreviation THEN 1.02
         ELSE 0.98 END AS f_home,

    -- ── f_rest: days between this game and the team's previous game
    (SELECT CASE
              WHEN prev.d IS NULL THEN 1.00
              WHEN (ng.game_date - prev.d) <= 1 THEN 0.96   -- back-to-back
              WHEN (ng.game_date - prev.d) >= 3 THEN 1.02   -- well rested
              ELSE 1.00 END
       FROM (SELECT MAX(g2.game_date) AS d
               FROM public.nba_games g2
              WHERE (g2.home_team_abbreviation = np.team_abbreviation
                     OR g2.away_team_abbreviation = np.team_abbreviation)
                AND g2.game_date < ng.game_date) prev) AS f_rest,

    -- ── f_teammate: usage redistribution when rotation teammates are out
    LEAST(1.20, 1.0 + 0.05 * (
      SELECT COUNT(*) FROM public.nba_players t
       WHERE t.team_abbreviation = np.team_abbreviation
         AND t.id <> np.id AND t.is_injured = TRUE
         AND COALESCE(t.season_avg_min,0) >= 20)) AS f_teammate,

    -- ── f_playoff: stars shoulder more in the playoffs
    CASE WHEN ng.is_playoffs AND COALESCE(np.season_avg_min,0) >= 28 THEN 1.03 ELSE 1.00 END AS f_playoff,

    -- ── f_pace (HOOK): mean of both teams' pace vs league avg 100
    LEAST(1.10, GREATEST(0.90,
      ((COALESCE(th.pace, 100) + COALESCE(ta.pace, 100)) / 2.0) / 100.0)) AS f_pace,

    -- ── f_total (HOOK): game total vs league avg 230
    LEAST(1.10, GREATEST(0.90, COALESCE(ng.vegas_total, 230) / 230.0)) AS f_total,

    -- ── f_team_total (HOOK): the player's own team's implied total vs 115
    LEAST(1.12, GREATEST(0.90,
      CASE WHEN ng.vegas_total IS NULL OR ng.vegas_spread IS NULL THEN 1.0
           WHEN ng.home_team_abbreviation = np.team_abbreviation
             THEN (ng.vegas_total/2.0 - ng.vegas_spread/2.0) / 115.0   -- home implied
           ELSE (ng.vegas_total/2.0 + ng.vegas_spread/2.0) / 115.0     -- away implied
      END)) AS f_team_total,

    -- ── f_dvp (HOOK): opponent's defense-vs-position multiplier
    LEAST(1.15, GREATEST(0.85, COALESCE(dvp.dvp_multiplier, 1.0))) AS f_dvp,

    -- ── f_usage (HOOK): usage rate vs league avg 20%
    LEAST(1.15, GREATEST(0.85, COALESCE(np.usage_rate, 20) / 20.0)) AS f_usage

  FROM public.nba_players np
  LEFT JOIN next_game ng           ON ng.player_id = np.id
  LEFT JOIN public.nba_teams th    ON th.abbreviation = ng.home_team_abbreviation
  LEFT JOIN public.nba_teams ta    ON ta.abbreviation = ng.away_team_abbreviation
  LEFT JOIN public.team_position_defense dvp
         ON dvp.position = np.position
        AND dvp.team_abbreviation = CASE
              WHEN ng.home_team_abbreviation = np.team_abbreviation THEN ng.away_team_abbreviation
              ELSE ng.home_team_abbreviation END
  WHERE np.is_active = TRUE
),
combined AS (
  SELECT f.*,
         -- blend model with prop signal when available
         (CASE WHEN f.prop_fpts IS NOT NULL AND f.prop_fpts > 0
               THEN 0.5 * f.model_fpts + 0.5 * f.prop_fpts
               ELSE f.model_fpts END) AS base_fpts,
         -- total multiplier, clamped so factors can't compound into the absurd
         LEAST(1.60, GREATEST(0.55,
           f.f_minutes * f.f_home * f.f_rest * f.f_teammate * f.f_playoff
           * f.f_pace * f.f_total * f.f_team_total * f.f_dvp * f.f_usage)) AS f_total_mult
    FROM factored f
),
fair AS (
  SELECT c.*,
         GREATEST(0, c.base_fpts) * c.f_total_mult AS fair_fpts
    FROM combined c
),
scaled AS (
  SELECT fr.*,
         MAX(CASE WHEN NOT fr.is_injured AND fr.has_data AND fr.fair_fpts > 0
                  THEN fr.fair_fpts END) OVER () AS slate_top
    FROM fair fr
)
SELECT
  s.player_id,
  s.is_injured,
  s.game_id          AS next_game_id,
  s.tip_off_time,
  s.fair_fpts,
  ROUND(
    LEAST(200, GREATEST(5,
      GREATEST(
        s.fair_fpts * (200.0 / NULLIF(s.slate_top, 0)),
        CASE WHEN s.has_data THEN 0
             ELSE CASE s.salary_tier
                    WHEN 'superstar' THEN 110 WHEN 'star' THEN 70
                    WHEN 'mid' THEN 30 ELSE 10 END END
      )
    )), 2) AS fair_price,
  jsonb_build_object(
    'base_fpts', ROUND(s.base_fpts, 1), 'fair_fpts', ROUND(s.fair_fpts, 1),
    'minutes', s.f_minutes, 'home', s.f_home, 'rest', s.f_rest,
    'teammate', s.f_teammate, 'playoff', s.f_playoff, 'pace', s.f_pace,
    'total', s.f_total, 'team_total', s.f_team_total, 'dvp', s.f_dvp,
    'usage', s.f_usage, 'combined', s.f_total_mult,
    'prop_blended', (s.prop_fpts IS NOT NULL AND s.prop_fpts > 0)
  ) AS factors
FROM scaled s
WHERE s.slate_top IS NOT NULL AND s.slate_top > 0;

REVOKE ALL ON public.v_player_fair_value FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- SECTION 3 — REFRESH FAIR-VALUE ANCHOR (intraday; no live-price reset)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_fair_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows INT := 0;
  v_window INT;
BEGIN
  SELECT COALESCE((SELECT value::INT FROM public.app_config WHERE key='price_window_open_minutes'),180)
    INTO v_window;

  UPDATE public.player_prices pp
     SET fair_price         = v.fair_price,
         price_floor        = ROUND(v.fair_price * 0.60, 2),
         price_ceiling      = ROUND(v.fair_price * 1.80, 2),
         next_game_id       = v.next_game_id,
         market_open_at     = CASE WHEN v.tip_off_time IS NOT NULL
                                   THEN v.tip_off_time - make_interval(mins => v_window) END,
         market_close_at    = v.tip_off_time,
         fair_price_factors = v.factors,
         updated_at         = NOW()
    FROM public.v_player_fair_value v
   WHERE pp.player_id = v.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.lock_prices_for_live_games();
  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 4 — DAILY RECALIBRATION (full reset: base = current = fair)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalibrate_player_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows INT := 0;
  v_window INT;
BEGIN
  SELECT COALESCE((SELECT value::INT FROM public.app_config WHERE key='price_window_open_minutes'),180)
    INTO v_window;

  UPDATE public.player_prices pp
     SET base_price             = v.fair_price,
         current_price          = v.fair_price,
         fair_price             = v.fair_price,
         price_floor            = ROUND(v.fair_price * 0.60, 2),
         price_ceiling          = ROUND(v.fair_price * 1.80, 2),
         price_velocity         = 0,
         price_acceleration     = 0,
         demand_count_1h        = 0,
         demand_count_this_tick = 0,
         price_change_24h       = 0,
         price_change_pct_24h   = 0,
         next_game_id           = v.next_game_id,
         market_open_at         = CASE WHEN v.tip_off_time IS NOT NULL
                                       THEN v.tip_off_time - make_interval(mins => v_window) END,
         market_close_at        = v.tip_off_time,
         fair_price_factors     = v.factors,
         is_locked              = v.is_injured,
         lock_reason            = CASE WHEN v.is_injured THEN 'injured' ELSE NULL END,
         updated_at             = NOW()
    FROM public.v_player_fair_value v
   WHERE pp.player_id = v.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.lock_prices_for_live_games();
  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 5 — LIVE TICK (per second; lock started games, then drift everyone)
-- =============================================================================
-- Coefficients are sized for a ~1s cadence: tiny per-tick noise + gentle gravity
-- so the price breathes continuously without random-walking off its anchor.

CREATE OR REPLACE FUNCTION public.tick_player_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows          INT := 0;
  v_active_users  INT;
  v_window        NUMERIC;
  v_demand_coef   CONSTANT NUMERIC := 0.15;   -- ln() demand weight (per tick)
  v_gravity_coef  CONSTANT NUMERIC := 0.01;   -- pull toward fair value (per tick)
  v_velocity_coef CONSTANT NUMERIC := 0.10;
  v_cold_cap      CONSTANT NUMERIC := 1.5;    -- per-tick demand cap scaler
  v_floor_mult    CONSTANT NUMERIC := 0.60;
  v_ceil_mult     CONSTANT NUMERIC := 1.80;
  v_noise_pct     CONSTANT NUMERIC := 0.0015; -- ±0.15% of fair per tick, time-decayed
BEGIN
  -- Stop movement the instant a game tips off.
  PERFORM public.lock_prices_for_live_games();

  SELECT GREATEST(1, COUNT(*)) INTO v_active_users
    FROM public.profiles WHERE last_active_at > NOW() - INTERVAL '5 minutes';
  SELECT COALESCE((SELECT value::NUMERIC FROM public.app_config WHERE key='price_window_open_minutes'),180)
    INTO v_window;

  WITH movers AS (
    SELECT pp.player_id,
           pp.current_price,
           COALESCE(pp.fair_price, pp.base_price) AS fair_price,
           pp.price_velocity,
           LEAST(
             v_demand_coef * ln(1 + GREATEST(0, pp.demand_count_this_tick)),
             v_cold_cap * sqrt(v_active_users::NUMERIC)
           ) AS demand_force,
           (COALESCE(pp.fair_price, pp.base_price) - pp.current_price) * v_gravity_coef AS gravity,
           pp.price_velocity * v_velocity_coef AS velocity_term,
           -- calmer as tip-off approaches; full, constant motion when no game scheduled
           CASE WHEN pp.market_close_at IS NULL THEN 1.0
                ELSE LEAST(1.0, GREATEST(0.2,
                  EXTRACT(EPOCH FROM (pp.market_close_at - NOW())) / 60.0 / NULLIF(v_window,0))) END AS time_decay
      FROM public.player_prices pp
      JOIN public.nba_players np ON np.id = pp.player_id
     WHERE pp.is_locked = FALSE
       AND np.is_active = TRUE
  ),
  computed AS (
    SELECT m.player_id, m.current_price, m.fair_price,
           (m.current_price + m.demand_force + m.gravity + m.velocity_term
             + (random() - 0.5) * 2.0 * v_noise_pct * m.fair_price * m.time_decay) AS raw_next
      FROM movers m
  ),
  clamped AS (
    SELECT c.player_id, c.current_price, c.fair_price, c.raw_next,
           GREATEST(c.fair_price * v_floor_mult,
                    LEAST(c.fair_price * v_ceil_mult, c.raw_next)) AS new_price
      FROM computed c
  )
  UPDATE public.player_prices pp
     SET current_price        = ROUND(cl.new_price::numeric, 2),
         price_velocity       = CASE WHEN cl.raw_next <> cl.new_price THEN 0
                                     ELSE ROUND((cl.new_price - cl.current_price)::numeric, 4) END,
         price_change_24h     = ROUND((cl.new_price - cl.fair_price)::numeric, 2),
         price_change_pct_24h = ROUND((((cl.new_price - cl.fair_price) / NULLIF(cl.fair_price::numeric,0)) * 100)::numeric, 2),
         demand_count_this_tick = 0,
         active_users_snapshot  = v_active_users,
         updated_at             = NOW()
    FROM clamped cl
   WHERE pp.player_id = cl.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 6 — HISTORY SNAPSHOT (every 30s, decoupled from the per-second tick)
-- =============================================================================
-- A per-second history row would be ~17M rows/day. Sample the active market
-- (players with an upcoming game) on a slower cadence for charts.

CREATE OR REPLACE FUNCTION public.snapshot_price_history()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE v_rows INT := 0;
BEGIN
  INSERT INTO public.price_history (player_id, price, volume, recorded_at)
  SELECT pp.player_id, pp.current_price, pp.demand_count_1h, NOW()
    FROM public.player_prices pp
    JOIN public.nba_players np ON np.id = pp.player_id
   WHERE np.is_active = TRUE
     AND pp.next_game_id IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 7 — GRANTS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION
  public.refresh_fair_prices(),
  public.recalibrate_player_prices(),
  public.tick_player_prices(),
  public.snapshot_price_history()
FROM PUBLIC, authenticated, anon;


-- =============================================================================
-- SECTION 8 — SCHEDULED JOBS
-- =============================================================================
-- tick every second · history every 30s · fair-value anchor every 5 min ·
-- daily recalibration unchanged (still owned by the 09:00 UTC job).

SELECT cron.unschedule('tick-player-prices')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='tick-player-prices');
SELECT cron.schedule('tick-player-prices', '1 seconds', $$ SELECT public.tick_player_prices(); $$);

SELECT cron.unschedule('snapshot-price-history')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='snapshot-price-history');
SELECT cron.schedule('snapshot-price-history', '30 seconds', $$ SELECT public.snapshot_price_history(); $$);

SELECT cron.unschedule('refresh-fair-prices')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-fair-prices');
SELECT cron.schedule('refresh-fair-prices', '*/5 * * * *', $$ SELECT public.refresh_fair_prices(); $$);

-- The standalone per-minute lock job is now redundant (the per-second tick locks
-- first), but keep it as a cheap safety net.


-- =============================================================================
-- SECTION 9 — ONE-TIME APPLY
-- =============================================================================

SELECT public.recalibrate_player_prices();


-- =============================================================================
-- END
-- =============================================================================
