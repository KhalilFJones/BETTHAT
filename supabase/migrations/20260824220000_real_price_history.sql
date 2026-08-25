-- =============================================================================
-- Rebuild price_history from the data we actually have.
--
-- The previous seed applied ONE shared random walk to all 273 players — every
-- series was the same shape scaled by price level, so after the sparkline's
-- min/max normalisation every player drew an identical curve. It also ignored
-- player_prices.price_change_24h, leaving 266 of 273 graphs contradicting the
-- percentage badge printed next to them.
--
-- This rebuilds each player's series from that player's own numbers:
--
--   * Two hard anchors — the newest tick equals current_price, and the tick at
--     exactly -24h equals current_price - price_change_24h. The curve and the
--     badge can no longer disagree.
--   * Inside that 24h window the path is a Brownian bridge: a straight line
--     between the anchors plus noise weighted by sin(), which is zero at both
--     ends. That gives a natural shape while keeping both anchors exact.
--   * Before -24h the walk steps backwards day by day, driven by that day's
--     REAL fantasy_points against the player's season_avg_fpts. A big game
--     means the price was lower before it; a dud means it was higher. Measured
--     correlation between FP deviation and the move across that day is 0.50
--     over 1,365 player-days.
--   * Volatility comes from the player's tier and 1h demand, so a $153
--     superstar doesn't jitter like an $8 bench player.
--   * setseed() is keyed on the player's uuid, so every player gets a distinct
--     shape and re-running reproduces it exactly.
--
-- Ticks: every 24 min for 6h, hourly to 48h, 6-hourly to 14 days (~106/player).
--
-- Re-run whenever the seed goes stale — the 6h sparkline window slides with
-- real time, so after ~6 hours the sparkline would otherwise have no ticks to
-- draw. dev_roll_slate_forward() also works: it slides the whole series so the
-- newest tick sits at now(), which preserves both anchors and every shape.
-- =============================================================================

create or replace function public.dev_regenerate_price_history()
returns table(players integer, ticks integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hours     numeric[];
  v_p         record;
  v_seed      double precision;
  v_p0        numeric;
  v_p24       numeric;
  v_vol       numeric;
  v_hb        numeric;
  v_price     numeric;
  v_base      numeric;
  v_bridge    numeric;
  v_level     numeric;
  v_day       integer;
  v_prev_day  integer;
  v_fp        numeric;
  v_drift     numeric;
  v_noise     numeric;
  v_floor     numeric;
  v_ceiling   numeric;
  v_fp_by_day numeric[];
  i           integer;
  v_rows      integer := 0;
  v_players   integer := 0;
begin
  select array_agg(h order by h) into v_hours from (
    select generate_series(0, 5.6, 0.4)::numeric as h     -- 15 ticks over 6h
    union all select generate_series(6, 47, 1)::numeric   -- hourly to 2 days
    union all select generate_series(48, 336, 6)::numeric -- 6-hourly to 14 days
  ) s;

  truncate price_history;

  for v_p in
    select pp.player_id,
           pp.current_price,
           coalesce(pp.price_change_24h, 0)  as chg24,
           coalesce(pp.demand_count_1h, 0)   as demand,
           coalesce(pp.tier, 'mid')          as tier,
           coalesce(pp.price_floor, 1)       as pfloor,
           coalesce(pp.price_ceiling, 9999)  as pceil,
           nullif(np.season_avg_fpts, 0)     as season_avg
      from player_prices pp
      join nba_players np on np.id = pp.player_id
     where pp.current_price is not null
  loop
    v_p0   := v_p.current_price;
    v_p24  := greatest(v_p.current_price - v_p.chg24, 0.5);

    -- price_floor/price_ceiling are stale for some rows: 12 players currently
    -- sit ABOVE their own ceiling. Clamping to those verbatim pinned the whole
    -- series to the ceiling and produced one flat line. Widen the band so it
    -- always contains both anchors — it still catches runaway values.
    v_floor   := least(v_p.pfloor, v_p0 * 0.70, v_p24 * 0.70);
    v_ceiling := greatest(v_p.pceil, v_p0 * 1.30, v_p24 * 1.30);

    v_vol := case v_p.tier
               when 'superstar' then 0.0035
               when 'star'      then 0.0045
               when 'budget'    then 0.0075
               else 0.0060
             end + (v_p.demand::numeric / 26) * 0.0040;

    v_seed := ((hashtext(v_p.player_id::text) % 1000000)::double precision) / 1000000.0;
    perform setseed(v_seed);

    v_fp_by_day := array_fill(null::numeric, array[15]);
    for i in 0..14 loop
      select max(s.fantasy_points) into v_fp
        from player_game_stats s
        join nba_games g on g.id = s.game_id
       where s.player_id = v_p.player_id
         and g.game_date = current_date - i;
      v_fp_by_day[i + 1] := v_fp;
    end loop;

    v_level := v_p24;
    v_prev_day := 1;

    for i in 1..array_length(v_hours, 1) loop
      v_hb := v_hours[i];
      v_noise := (random() * 2) - 1;

      if v_hb <= 24 then
        v_base   := v_p24 + (v_p0 - v_p24) * ((24 - v_hb) / 24);
        -- Bridge weight peaks mid-window and vanishes at both anchors. A small
        -- floor keeps the most recent hours from looking artificially smooth,
        -- since the sparkline only shows the last 6h.
        v_bridge := greatest(0.35, sin(pi() * ((24 - v_hb) / 24)));
        v_price  := v_base * (1 + v_vol * v_bridge * v_noise);
      else
        v_day := floor(v_hb / 24)::integer;

        -- Crossing into an older day: undo that day's performance move, since
        -- we are walking backwards through time.
        while v_prev_day < v_day loop
          v_fp := v_fp_by_day[v_prev_day + 1];
          if v_fp is not null and v_p.season_avg is not null then
            v_drift := greatest(-1.5, least(1.5,
                        (v_fp - v_p.season_avg) / v_p.season_avg)) * 0.05;
          else
            -- No game that day: drift gently back toward the 24h anchor.
            v_drift := -0.004 * (case when v_level > v_p24 then 1 else -1 end);
          end if;
          v_level := v_level / (1 + v_drift);
          v_prev_day := v_prev_day + 1;
        end loop;

        -- Wider spacing out here, so a slightly larger intraday wobble.
        v_price := v_level * (1 + v_vol * 1.8 * v_noise);
      end if;

      v_price := round(greatest(v_floor, least(v_ceiling, v_price)), 2);

      -- The anchors are the point of this rebuild — never let rounding,
      -- clamping or noise move them.
      if v_hb = 0  then v_price := round(v_p0, 2);  end if;
      if v_hb = 24 then v_price := round(v_p24, 2); end if;

      insert into price_history (player_id, price, volume, recorded_at)
      values (
        v_p.player_id,
        v_price,
        greatest(0, round(v_p.demand * (0.4 + random()))::integer),
        now() - make_interval(secs => (v_hb * 3600)::double precision)
      );
      v_rows := v_rows + 1;
    end loop;

    v_players := v_players + 1;
  end loop;

  return query select v_players, v_rows;
end;
$$;

revoke all on function public.dev_regenerate_price_history() from public, anon, authenticated;
