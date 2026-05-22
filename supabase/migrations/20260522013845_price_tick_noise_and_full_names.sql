-- Add organic noise (±2.5% of base_price per tick) to tick_player_prices so prices
-- fluctuate visibly even when user demand is zero. Also updates price_change_pct_24h
-- relative to base_price so the ticker shows accurate movement direction.
CREATE OR REPLACE FUNCTION public.tick_player_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_rows         INT := 0;
  v_active_users INT;
  v_demand_coef   CONSTANT NUMERIC := 0.35;
  v_gravity_coef  CONSTANT NUMERIC := 0.008;
  v_velocity_coef CONSTANT NUMERIC := 0.3;
  v_cold_cap      CONSTANT NUMERIC := 8.0;
  v_floor_mult    CONSTANT NUMERIC := 0.60;
  v_ceil_mult     CONSTANT NUMERIC := 1.80;
  v_noise_pct     CONSTANT NUMERIC := 0.025; -- ±2.5% of base per tick
BEGIN
  SELECT GREATEST(1, COUNT(*)) INTO v_active_users
    FROM public.profiles WHERE last_active_at > NOW() - INTERVAL '5 minutes';

  WITH updates AS (
    SELECT pp.player_id,
           pp.current_price,
           pp.base_price,
           pp.price_velocity,
           pp.demand_count_this_tick,
           LEAST(
             pp.demand_count_this_tick * v_demand_coef,
             v_cold_cap * sqrt(v_active_users::NUMERIC)
           ) AS demand_force,
           (pp.base_price - pp.current_price) * v_gravity_coef AS gravity,
           pp.price_velocity * v_velocity_coef AS velocity_term,
           (random() - 0.5) * 2.0 * v_noise_pct * pp.base_price AS noise
      FROM public.player_prices pp
      JOIN public.nba_players np ON np.id = pp.player_id
     WHERE pp.is_locked = FALSE
       AND np.is_active = TRUE
  ),
  computed AS (
    SELECT u.player_id,
           u.base_price,
           GREATEST(
             u.base_price * v_floor_mult,
             LEAST(
               u.base_price * v_ceil_mult,
               u.current_price + u.demand_force + u.gravity + u.velocity_term + u.noise
             )
           ) AS new_price
      FROM updates u
  )
  UPDATE public.player_prices pp
     SET current_price          = ROUND(c.new_price::numeric, 2),
         price_velocity         = ROUND((c.new_price - pp.current_price)::numeric, 4),
         price_change_24h       = ROUND((c.new_price - pp.base_price)::numeric, 2),
         price_change_pct_24h   = ROUND(((c.new_price - pp.base_price) / NULLIF(pp.base_price::numeric, 0)) * 100, 2),
         demand_count_this_tick = 0,
         active_users_snapshot  = v_active_users,
         updated_at             = NOW()
    FROM computed c
   WHERE pp.player_id = c.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.price_history (player_id, price, volume, recorded_at)
  SELECT pp.player_id, pp.current_price, pp.demand_count_1h, NOW()
    FROM public.player_prices pp
    JOIN public.nba_players np ON np.id = pp.player_id
   WHERE pp.is_locked = FALSE AND np.is_active = TRUE;

  RETURN v_rows;
END;
$body$;
