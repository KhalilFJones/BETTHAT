-- =============================================================================
-- BETTHAT MIGRATION 7: $500 UNIFIED SALARY CAP + DAILY PRICE RECALIBRATION
-- =============================================================================
-- Closes the open H-9 product decision: cap is a single $500 for all entry
-- tiers, and prices are recalibrated DAILY so the cap stays meaningful even
-- when the whole league is underperforming.
--
-- The pricing engine still runs throughout the day (tick_player_prices every
-- minute, demand/gravity/velocity dynamics) — this migration just adds the
-- daily reset so prices don't drift away from the cap.
--
-- Math:
--   blended_fp     = 0.40 * season_avg_fpts + 0.60 * last5_avg_fpts
--   slate_top_fp   = MAX(blended_fp) across all active, healthy players
--   scaling_factor = TARGET_TOP_PRICE / slate_top_fp
--   new_base_price = clamp(blended_fp * scaling_factor, MIN_PRICE, MAX_PRICE)
--
--   With TARGET_TOP_PRICE = $200, MAX_PRICE = $200, MIN_PRICE = $5:
--     Top star      → ~$200 base  (current can go 60–180% → $120–$360)
--     Mid starter   → ~$120 base
--     Role player   → ~$60 base
--     Bench         → ~$20 base
--
--   This guarantees a 3-star lineup is unaffordable (3 × $200 = $600 > $500)
--   so users must trade off — exactly the strategic constraint asked for.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — UNIFIED $500 CAP IN entry_tier_caps
-- =============================================================================

UPDATE public.entry_tier_caps
   SET salary_cap = 500.00,
       min_cap    = 250.00,
       description = entry_tier::TEXT || ' entry: $250–$500 salary cap'
 WHERE entry_tier IN (1, 5, 10, 20, 50);


-- =============================================================================
-- SECTION 2 — DAILY PRICE RECALIBRATION RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalibrate_player_prices()
RETURNS INT  -- rows updated
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows             INT := 0;
  v_target_top_price CONSTANT NUMERIC := 200.00;
  v_min_price        CONSTANT NUMERIC := 5.00;
  v_max_price        CONSTANT NUMERIC := 200.00;
  v_season_weight    CONSTANT NUMERIC := 0.40;
  v_last5_weight     CONSTANT NUMERIC := 0.60;
  v_slate_top_fp     NUMERIC;
  v_scaling_factor   NUMERIC;
BEGIN
  -- Step 1: find the slate's projected top fantasy output (ignoring injured).
  SELECT MAX(v_season_weight * np.season_avg_fpts + v_last5_weight * np.last5_avg_fpts)
    INTO v_slate_top_fp
    FROM public.nba_players np
   WHERE np.is_active = TRUE
     AND np.is_injured = FALSE;

  -- Fallback: if the league hasn't played enough games yet, use season alone.
  IF v_slate_top_fp IS NULL OR v_slate_top_fp <= 0 THEN
    SELECT MAX(np.season_avg_fpts) INTO v_slate_top_fp
      FROM public.nba_players np
     WHERE np.is_active = TRUE AND np.is_injured = FALSE;
  END IF;

  -- If still nothing, bail. (Empty player table — nothing to recalibrate.)
  IF v_slate_top_fp IS NULL OR v_slate_top_fp <= 0 THEN
    RETURN 0;
  END IF;

  v_scaling_factor := v_target_top_price / v_slate_top_fp;

  -- Step 2: recompute base_price + current_price + floor/ceiling per player.
  -- Reset the demand counters and velocity so each day starts on a clean slate.
  WITH projections AS (
    SELECT
      np.id AS player_id,
      np.is_injured,
      ROUND(
        GREATEST(
          v_min_price,
          LEAST(
            v_max_price,
            (v_season_weight * np.season_avg_fpts + v_last5_weight * np.last5_avg_fpts) * v_scaling_factor
          )
        ),
        2
      ) AS new_base_price
    FROM public.nba_players np
    WHERE np.is_active = TRUE
  )
  UPDATE public.player_prices pp
     SET base_price             = pr.new_base_price,
         current_price          = pr.new_base_price,
         price_floor            = ROUND(pr.new_base_price * 0.60, 2),
         price_ceiling          = ROUND(pr.new_base_price * 1.80, 2),
         price_velocity         = 0,
         price_acceleration     = 0,
         demand_count_1h        = 0,
         demand_count_this_tick = 0,
         is_locked              = pr.is_injured,
         lock_reason            = CASE WHEN pr.is_injured THEN 'injured' ELSE NULL END,
         updated_at             = NOW()
    FROM projections pr
   WHERE pp.player_id = pr.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalibrate_player_prices() FROM PUBLIC, authenticated, anon;


-- =============================================================================
-- SECTION 3 — IMMEDIATE ONE-TIME RECALIBRATION
-- =============================================================================
-- Apply the new pricing distribution right now so existing data lines up with
-- the new cap. Subsequent recalibrations are cron-driven.

SELECT public.recalibrate_player_prices();


-- =============================================================================
-- SECTION 4 — SCHEDULE DAILY RECALIBRATION
-- =============================================================================
-- 9:00 UTC = 5am ET / 2am PT — well before any NBA game starts. Each tip-off
-- thereafter operates on fresh prices that respect the $500 cap.

SELECT cron.unschedule('recalibrate-player-prices')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='recalibrate-player-prices');

SELECT cron.schedule(
  'recalibrate-player-prices',
  '0 9 * * *',
  $$ SELECT public.recalibrate_player_prices(); $$
);


-- =============================================================================
-- END
-- =============================================================================
