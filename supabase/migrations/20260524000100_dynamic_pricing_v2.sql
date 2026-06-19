-- =============================================================================
-- BETTHAT — DYNAMIC PRICING V2 + PRE-GAME WINDOW + TIP-OFF LOCK
-- =============================================================================
-- Replaces the demand+noise pricing engine with a fundamentals fair-value
-- ANCHOR plus market DRIFT (how a sportsbook opens and then moves a line), and
-- enforces that a player's price only moves during a pre-game trading window —
-- the moment their game tips off (or goes live) the price LOCKS and the player
-- can no longer be drafted.
--
-- Model (per player):
--   base_fpts      = 0.35*season_avg_fpts + 0.65*last5_avg_fpts        (recent-form weighted)
--                    fallback: last5 → season → tier baseline (never NULL/0)
--   minutes_factor = clamp(last5_avg_min / season_avg_min, 0.70, 1.30) (role/usage trend)
--   home_factor    = 1.02 home / 0.98 away / 1.00 if no game
--   fair_fpts      = GREATEST(0, base_fpts) * minutes_factor * home_factor
--   fair_price     = clamp(fair_fpts * slate_scaling, $5, $200), tier-floored when no data
--
-- During the open window the live price drifts around fair_price:
--   demand_force  = LEAST(DEMAND_COEF*ln(1+demand), COLDSTART_CAP*sqrt(active_users))
--   gravity       = (fair_price - current_price) * GRAVITY_COEF      (mean reversion)
--   velocity_term = price_velocity * VELOCITY_COEF                   (mild momentum)
--   noise         = U(-1,1) * NOISE_PCT * fair_price * time_decay    (calmer near tip)
--   new_price     = clamp(current + demand + gravity + velocity + noise,
--                         fair_price*0.60, fair_price*1.80)
-- =============================================================================


-- =============================================================================
-- SECTION 1 — SCHEMA + CONFIG
-- =============================================================================

ALTER TABLE public.player_prices
  ADD COLUMN IF NOT EXISTS fair_price   DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS next_game_id UUID REFERENCES public.nba_games(id);

CREATE INDEX IF NOT EXISTS idx_player_prices_next_game
  ON public.player_prices(next_game_id);

INSERT INTO public.app_config (key, value, description, is_secret) VALUES
  ('price_window_open_minutes', '180',
   'Minutes before tip-off that a player price starts moving (pre-game trading window). Outside this window the price rests at fair value.',
   false)
ON CONFLICT (key) DO NOTHING;


-- =============================================================================
-- SECTION 2 — MARKET WINDOWS: sync_price_windows()
-- =============================================================================
-- For every active player, attach the earliest game on TODAY's slate and open a
-- trading window [tip_off - price_window_open_minutes, tip_off]. Players with no
-- game today, or a game with no scheduled tip_off_time, get NULL windows (their
-- price simply rests at fair value and can only lock on a live/started status).

CREATE OR REPLACE FUNCTION public.sync_price_windows()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows   INT := 0;
  v_window INT;
BEGIN
  SELECT COALESCE((SELECT value::INT FROM public.app_config WHERE key = 'price_window_open_minutes'), 180)
    INTO v_window;

  -- Earliest non-finished game per player on today's slate.
  WITH today_game AS (
    SELECT DISTINCT ON (pga.player_id)
           pga.player_id,
           g.id            AS game_id,
           g.tip_off_time
      FROM public.player_game_availability pga
      JOIN public.nba_games g ON g.id = pga.game_id
     WHERE g.game_date = CURRENT_DATE
       AND g.status NOT IN ('final','postponed','cancelled')
     ORDER BY pga.player_id, g.tip_off_time ASC NULLS LAST
  )
  UPDATE public.player_prices pp
     SET next_game_id    = tg.game_id,
         market_open_at  = CASE WHEN tg.tip_off_time IS NOT NULL
                                THEN tg.tip_off_time - make_interval(mins => v_window) END,
         market_close_at = tg.tip_off_time,
         updated_at      = NOW()
    FROM today_game tg
   WHERE pp.player_id = tg.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Clear windows for players whose today-game no longer applies (e.g. yesterday's slate).
  UPDATE public.player_prices pp
     SET next_game_id = NULL, market_open_at = NULL, market_close_at = NULL
   WHERE pp.next_game_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.player_game_availability pga
        JOIN public.nba_games g ON g.id = pga.game_id
       WHERE pga.player_id = pp.player_id
         AND g.game_date = CURRENT_DATE
         AND g.status NOT IN ('final','postponed','cancelled')
     );

  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 3 — TIP-OFF LOCK: lock_prices_for_live_games()
-- =============================================================================
-- One-way lock: as soon as a player's game on today's slate is pregame/live/
-- halftime/final, OR its tip_off_time has passed, freeze the price and flag it
-- so the client and the lineup-pick trigger reject any further drafting.
-- Healthy players are re-opened by the next daily recalibration.

CREATE OR REPLACE FUNCTION public.lock_prices_for_live_games()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows INT := 0;
BEGIN
  WITH started AS (
    SELECT DISTINCT pga.player_id
      FROM public.player_game_availability pga
      JOIN public.nba_games g ON g.id = pga.game_id
     WHERE g.game_date = CURRENT_DATE
       AND ( g.status IN ('pregame','live','halftime','final')
             OR (g.tip_off_time IS NOT NULL AND g.tip_off_time <= NOW()) )
  )
  UPDATE public.player_prices pp
     SET is_locked   = TRUE,
         lock_reason = 'game_live',
         updated_at  = NOW()
    FROM started s
   WHERE pp.player_id = s.player_id
     AND pp.is_locked = FALSE;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 4 — FAIR-VALUE RECALIBRATION: recalibrate_player_prices()
-- =============================================================================
-- Daily reset (09:00 UTC, ~5am ET — before any tip-off). Recomputes the
-- multi-factor fair value, parks current_price at fair value, resets the market
-- state, unlocks healthy players, re-syncs windows, and immediately re-locks any
-- game that is already live (defensive — no NBA games run at 5am ET).

CREATE OR REPLACE FUNCTION public.recalibrate_player_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows             INT := 0;
  v_target_top_price CONSTANT NUMERIC := 200.00;
  v_min_price        CONSTANT NUMERIC := 5.00;
  v_max_price        CONSTANT NUMERIC := 200.00;
  v_season_weight    CONSTANT NUMERIC := 0.35;
  v_last5_weight     CONSTANT NUMERIC := 0.65;
BEGIN
  -- Single statement: blend projection × form/role/venue factors, derive the
  -- slate scaling factor with a window MAX (healthy, data-backed players only so
  -- a hurt star doesn't crush the curve), then park every price at fair value.
  -- If the slate has no usable stats, slate_top is NULL → 0 rows updated.
  WITH today_game AS (
    SELECT DISTINCT ON (pga.player_id)
           pga.player_id,
           g.home_team_abbreviation
      FROM public.player_game_availability pga
      JOIN public.nba_games g ON g.id = pga.game_id
     WHERE g.game_date = CURRENT_DATE
       AND g.status NOT IN ('final','postponed','cancelled')
     ORDER BY pga.player_id, g.tip_off_time ASC NULLS LAST
  ),
  fair AS (
    SELECT
      np.id AS player_id,
      np.is_injured,
      np.salary_tier,
      (CASE
         WHEN COALESCE(np.last5_games_played,0) > 0 AND COALESCE(np.last5_avg_fpts,0) > 0
           THEN v_season_weight * GREATEST(0, np.season_avg_fpts) + v_last5_weight * GREATEST(0, np.last5_avg_fpts)
         WHEN COALESCE(np.season_avg_fpts,0) > 0
           THEN GREATEST(0, np.season_avg_fpts)
         ELSE 0   -- no stats: handled by tier_base after scaling
       END)
      * LEAST(1.30, GREATEST(0.70,
          CASE WHEN COALESCE(np.season_avg_min,0) > 0
               THEN COALESCE(np.last5_avg_min, np.season_avg_min) / np.season_avg_min
               ELSE 1.0 END))
      * CASE WHEN tg.home_team_abbreviation IS NULL THEN 1.00
             WHEN tg.home_team_abbreviation = np.team_abbreviation THEN 1.02
             ELSE 0.98 END
        AS fair_fpts,
      (COALESCE(np.last5_games_played,0) > 0 OR COALESCE(np.season_avg_fpts,0) > 0) AS has_data
    FROM public.nba_players np
    LEFT JOIN today_game tg ON tg.player_id = np.id
    WHERE np.is_active = TRUE
  ),
  scaled AS (
    SELECT f.*,
           MAX(CASE WHEN NOT f.is_injured AND f.has_data AND f.fair_fpts > 0
                    THEN f.fair_fpts END) OVER () AS slate_top
      FROM fair f
  ),
  priced AS (
    SELECT s.player_id,
           s.is_injured,
           ROUND(
             LEAST(v_max_price, GREATEST(
               v_min_price,
               GREATEST(
                 s.fair_fpts * (v_target_top_price / s.slate_top),
                 CASE WHEN s.has_data THEN 0
                      ELSE CASE s.salary_tier
                             WHEN 'superstar' THEN 110
                             WHEN 'star'      THEN 70
                             WHEN 'mid'       THEN 30
                             ELSE 10 END END
               )
             )), 2) AS new_price
      FROM scaled s
     WHERE s.slate_top IS NOT NULL AND s.slate_top > 0
  )
  UPDATE public.player_prices pp
     SET base_price             = p.new_price,
         current_price          = p.new_price,
         fair_price             = p.new_price,
         price_floor            = ROUND(p.new_price * 0.60, 2),
         price_ceiling          = ROUND(p.new_price * 1.80, 2),
         price_velocity         = 0,
         price_acceleration     = 0,
         demand_count_1h        = 0,
         demand_count_this_tick = 0,
         price_change_24h       = 0,
         price_change_pct_24h   = 0,
         is_locked              = p.is_injured,
         lock_reason            = CASE WHEN p.is_injured THEN 'injured' ELSE NULL END,
         updated_at             = NOW()
    FROM priced p
   WHERE pp.player_id = p.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.sync_price_windows();
  PERFORM public.lock_prices_for_live_games();

  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 5 — LIVE PRICE TICK: tick_player_prices()
-- =============================================================================
-- Runs every minute. Only moves players whose market is OPEN
-- (NOW within [market_open_at, market_close_at)) and not locked. Outside the
-- window the price rests at fair value — satisfying "prices only change right
-- before the game." Drifts around fair_price with demand + gravity + momentum +
-- time-decayed noise, clamped to [fair*0.60, fair*1.80] with anti-pin velocity.

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
  v_demand_coef   CONSTANT NUMERIC := 0.9;    -- ln() demand weight
  v_gravity_coef  CONSTANT NUMERIC := 0.05;   -- pull toward fair value per tick
  v_velocity_coef CONSTANT NUMERIC := 0.25;
  v_cold_cap      CONSTANT NUMERIC := 8.0;
  v_floor_mult    CONSTANT NUMERIC := 0.60;
  v_ceil_mult     CONSTANT NUMERIC := 1.80;
  v_noise_pct     CONSTANT NUMERIC := 0.015;  -- ±1.5% of fair, scaled by time-decay
BEGIN
  SELECT GREATEST(1, COUNT(*)) INTO v_active_users
    FROM public.profiles WHERE last_active_at > NOW() - INTERVAL '5 minutes';

  SELECT COALESCE((SELECT value::NUMERIC FROM public.app_config WHERE key = 'price_window_open_minutes'), 180)
    INTO v_window;

  WITH open_market AS (
    SELECT pp.player_id,
           pp.current_price,
           COALESCE(pp.fair_price, pp.base_price) AS fair_price,
           pp.price_velocity,
           pp.demand_count_this_tick,
           pp.market_close_at,
           LEAST(
             v_demand_coef * ln(1 + GREATEST(0, pp.demand_count_this_tick)),
             v_cold_cap * sqrt(v_active_users::NUMERIC)
           ) AS demand_force,
           (COALESCE(pp.fair_price, pp.base_price) - pp.current_price) * v_gravity_coef AS gravity,
           pp.price_velocity * v_velocity_coef AS velocity_term,
           -- time_decay: 1.0 at window open → 0.2 at tip-off (calmer near lock)
           LEAST(1.0, GREATEST(0.2,
             EXTRACT(EPOCH FROM (pp.market_close_at - NOW())) / 60.0 / NULLIF(v_window,0)
           )) AS time_decay
      FROM public.player_prices pp
      JOIN public.nba_players np ON np.id = pp.player_id
     WHERE pp.is_locked = FALSE
       AND np.is_active = TRUE
       AND pp.market_open_at  IS NOT NULL
       AND pp.market_close_at IS NOT NULL
       AND NOW() >= pp.market_open_at
       AND NOW() <  pp.market_close_at
  ),
  computed AS (
    SELECT o.player_id,
           o.current_price,
           o.fair_price,
           (o.current_price + o.demand_force + o.gravity + o.velocity_term
             + (random() - 0.5) * 2.0 * v_noise_pct * o.fair_price * o.time_decay) AS raw_next
      FROM open_market o
  ),
  clamped AS (
    SELECT c.player_id,
           c.current_price,
           c.fair_price,
           GREATEST(c.fair_price * v_floor_mult,
                    LEAST(c.fair_price * v_ceil_mult, c.raw_next)) AS new_price,
           c.raw_next
      FROM computed c
  )
  UPDATE public.player_prices pp
     SET current_price        = ROUND(cl.new_price::numeric, 2),
         -- anti-pin: zero velocity when clamped at a bound
         price_velocity       = CASE
                                  WHEN cl.raw_next <> cl.new_price THEN 0
                                  ELSE ROUND((cl.new_price - cl.current_price)::numeric, 4)
                                END,
         price_change_24h     = ROUND((cl.new_price - cl.fair_price)::numeric, 2),
         price_change_pct_24h = ROUND((((cl.new_price - cl.fair_price) / NULLIF(cl.fair_price::numeric, 0)) * 100)::numeric, 2),
         demand_count_this_tick = 0,
         active_users_snapshot  = v_active_users,
         updated_at             = NOW()
    FROM clamped cl
   WHERE pp.player_id = cl.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Snapshot history only for players that actually moved this tick.
  INSERT INTO public.price_history (player_id, price, volume, recorded_at)
  SELECT pp.player_id, pp.current_price, pp.demand_count_1h, NOW()
    FROM public.player_prices pp
   WHERE pp.market_open_at  IS NOT NULL
     AND pp.market_close_at IS NOT NULL
     AND NOW() >= pp.market_open_at
     AND NOW() <  pp.market_close_at
     AND pp.is_locked = FALSE;

  RETURN v_rows;
END;
$body$;


-- =============================================================================
-- SECTION 6 — ATOMIC DRAFT GUARD (lineup_players BEFORE INSERT)
-- =============================================================================
-- Belt-and-suspenders against the ≤60s gap between tip-off and the lock cron:
-- reject inserting ANY player whose game on the lineup's slate has already
-- started. Covers both the draft-phase client inserts and the submit RPC.

CREATE OR REPLACE FUNCTION public.reject_started_game_pick()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_slate DATE;
BEGIN
  SELECT COALESCE(game_date, CURRENT_DATE) INTO v_slate
    FROM public.lineups WHERE id = NEW.lineup_id;

  IF EXISTS (
    SELECT 1
      FROM public.player_game_availability pga
      JOIN public.nba_games g ON g.id = pga.game_id
     WHERE pga.player_id = NEW.player_id
       AND g.game_date = v_slate
       AND ( g.status IN ('pregame','live','halftime','final')
             OR (g.tip_off_time IS NOT NULL AND g.tip_off_time <= NOW()) )
  ) THEN
    RAISE EXCEPTION 'player % is locked — their game has already started', NEW.player_id;
  END IF;

  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS lineup_players_reject_started ON public.lineup_players;
CREATE TRIGGER lineup_players_reject_started
  BEFORE INSERT ON public.lineup_players
  FOR EACH ROW EXECUTE FUNCTION public.reject_started_game_pick();


-- =============================================================================
-- SECTION 7 — GRANTS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION
  public.sync_price_windows(),
  public.lock_prices_for_live_games(),
  public.recalibrate_player_prices(),
  public.tick_player_prices()
FROM PUBLIC, authenticated, anon;


-- =============================================================================
-- SECTION 8 — SCHEDULED JOBS
-- =============================================================================
-- tick-player-prices (every minute) and recalibrate-player-prices (daily 09:00
-- UTC) already exist and now call the evolved functions via CREATE OR REPLACE.
-- Add the per-minute live-game lock.

SELECT cron.unschedule('lock-prices-live-games')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lock-prices-live-games');

SELECT cron.schedule(
  'lock-prices-live-games',
  '*/1 * * * *',
  $$ SELECT public.lock_prices_for_live_games(); $$
);


-- =============================================================================
-- SECTION 9 — ONE-TIME APPLY (align existing data with the new model)
-- =============================================================================

SELECT public.recalibrate_player_prices();


-- =============================================================================
-- END
-- =============================================================================
