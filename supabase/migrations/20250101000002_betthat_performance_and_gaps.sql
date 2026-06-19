-- ============================================================
-- BETTHAT — Schema v3: Gap Fills + Extreme Performance
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- fuzzy/trigram text search
CREATE EXTENSION IF NOT EXISTS pg_cron;        -- scheduled background jobs
CREATE EXTENSION IF NOT EXISTS pg_stat_statements; -- query performance monitoring

-- ============================================================
-- SECTION 1 — FUNCTIONAL GAPS
-- ============================================================

-- 1A. DRAFT WINDOWS — control when lineup submissions open/close per game date
--     (e.g., opens 24h before tip-off, closes 1h before tip-off)
CREATE TABLE public.draft_windows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date            DATE NOT NULL UNIQUE,
  submission_open_at   TIMESTAMPTZ NOT NULL,
  submission_close_at  TIMESTAMPTZ NOT NULL,   -- typically first tip-off of the night minus 1h
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER draft_windows_updated_at
  BEFORE UPDATE ON public.draft_windows
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_draft_windows_date ON public.draft_windows(game_date, is_active);

-- Add submission window columns to lineups
ALTER TABLE public.lineups
  ADD COLUMN submission_close_at  TIMESTAMPTZ,   -- copied from draft_windows at submit time
  ADD COLUMN locked_at            TIMESTAMPTZ;   -- when prices were frozen

-- 1B. PLAYER GAME AVAILABILITY — fast lookup: "does player X play on date Y?"
--     Synced from NBA schedule data; drives draft eligibility
CREATE TABLE public.player_game_availability (
  player_id      UUID NOT NULL REFERENCES public.nba_players(id) ON DELETE CASCADE,
  game_id        UUID NOT NULL REFERENCES public.nba_games(id)   ON DELETE CASCADE,
  game_date      DATE NOT NULL,
  is_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,   -- confirmed active (not DNP/questionable)
  is_draftable   BOOLEAN NOT NULL DEFAULT TRUE,    -- eligible to be picked
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, game_id)
);

CREATE TRIGGER player_game_availability_updated_at
  BEFORE UPDATE ON public.player_game_availability
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_pga_date_draftable  ON public.player_game_availability(game_date, is_draftable);
CREATE INDEX idx_pga_player          ON public.player_game_availability(player_id, game_date);
CREATE INDEX idx_pga_game            ON public.player_game_availability(game_id);

-- 1C. PLAYER NEWS — injury & status feed shown on player cards
CREATE TABLE public.player_news (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES public.nba_players(id) ON DELETE CASCADE,
  news_type     TEXT NOT NULL CHECK (news_type IN ('injury','status','rotation','rest','trade','general')),
  headline      TEXT NOT NULL,
  body          TEXT,
  source        TEXT,
  impact        TEXT CHECK (impact IN ('out','doubtful','questionable','probable','available','positive')),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_player_news_player  ON public.player_news(player_id, published_at DESC);
CREATE INDEX idx_player_news_recent  ON public.player_news(published_at DESC);

-- 1D. MATCHUP DISPUTES — formal dispute resolution workflow
ALTER TABLE public.matchups
  DROP CONSTRAINT IF EXISTS matchups_status_check;
ALTER TABLE public.matchups
  ADD CONSTRAINT matchups_status_check CHECK (status IN (
    'pending','matched','live','completed','voided','tie','disputed'
  ));

CREATE TABLE public.matchup_disputes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matchup_id   UUID NOT NULL REFERENCES public.matchups(id),
  opened_by    UUID NOT NULL REFERENCES public.profiles(id),
  reason       TEXT NOT NULL CHECK (reason IN (
    'incorrect_score','player_stat_error','game_voided','technical_issue','other'
  )),
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','under_review','resolved_for_user','resolved_for_opponent','voided','dismissed'
  )),
  resolution   TEXT,
  reviewed_by  UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER matchup_disputes_updated_at
  BEFORE UPDATE ON public.matchup_disputes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_disputes_matchup  ON public.matchup_disputes(matchup_id);
CREATE INDEX idx_disputes_status   ON public.matchup_disputes(status, created_at DESC);

-- 1E. ENTRY TIER CAPS — salary cap (max total frozen price) per entry tier
--     e.g., at $1 tier, you can spend at most $30 on your 3 players
CREATE TABLE public.entry_tier_caps (
  entry_tier   DECIMAL(6,2) PRIMARY KEY CHECK (entry_tier IN (1, 5, 10, 20, 50)),
  salary_cap   DECIMAL(8,2) NOT NULL,    -- max total frozen price for 3 players
  min_cap      DECIMAL(8,2) NOT NULL,    -- min spend (prevents trivially cheap lineups)
  description  TEXT
);

INSERT INTO public.entry_tier_caps (entry_tier, salary_cap, min_cap, description) VALUES
  (1.00,  45.00,  12.00, '$1 entry: $12–$45 salary cap'),
  (5.00,  75.00,  25.00, '$5 entry: $25–$75 salary cap'),
  (10.00, 105.00, 40.00, '$10 entry: $40–$105 salary cap'),
  (20.00, 135.00, 55.00, '$20 entry: $55–$135 salary cap'),
  (50.00, 180.00, 75.00, '$50 entry: $75–$180 salary cap');

-- 1F. NOTIFICATION PREFERENCES — granular per-channel per-type settings
CREATE TABLE public.notification_preferences (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Push channels
  push_matchup_found        BOOLEAN NOT NULL DEFAULT TRUE,
  push_game_starting        BOOLEAN NOT NULL DEFAULT TRUE,
  push_game_final           BOOLEAN NOT NULL DEFAULT TRUE,
  push_sidebet_received     BOOLEAN NOT NULL DEFAULT TRUE,
  push_sidebet_result       BOOLEAN NOT NULL DEFAULT TRUE,
  push_friend_request       BOOLEAN NOT NULL DEFAULT TRUE,
  push_friend_challenge     BOOLEAN NOT NULL DEFAULT TRUE,
  push_achievement_earned   BOOLEAN NOT NULL DEFAULT TRUE,
  push_price_alert          BOOLEAN NOT NULL DEFAULT TRUE,
  push_deposit_confirmed    BOOLEAN NOT NULL DEFAULT TRUE,
  push_withdrawal_processed BOOLEAN NOT NULL DEFAULT TRUE,
  -- Email channels
  email_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  email_matchup_results     BOOLEAN NOT NULL DEFAULT TRUE,
  email_weekly_summary      BOOLEAN NOT NULL DEFAULT TRUE,
  email_promotions          BOOLEAN NOT NULL DEFAULT TRUE,
  email_security_alerts     BOOLEAN NOT NULL DEFAULT TRUE,
  -- In-app
  inapp_price_alerts        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 1G. ONBOARDING — track progress, terms, tutorial
ALTER TABLE public.profiles
  ADD COLUMN onboarding_step      TEXT DEFAULT 'signup'
    CHECK (onboarding_step IN ('signup','verify_email','kyc','deposit','tutorial','complete')),
  ADD COLUMN terms_accepted_at    TIMESTAMPTZ,
  ADD COLUMN terms_version        TEXT,          -- which version of ToS was accepted
  ADD COLUMN tutorial_completed   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN tutorial_completed_at TIMESTAMPTZ;

-- 1H. LIVE PLAYER SCORE CACHE — per-player score in active matchups (avoids heavy joins during live games)
CREATE TABLE public.live_player_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id       UUID NOT NULL REFERENCES public.lineups(id) ON DELETE CASCADE,
  lineup_player_id UUID NOT NULL REFERENCES public.lineup_players(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES public.nba_players(id),
  game_id         UUID NOT NULL REFERENCES public.nba_games(id),
  fantasy_points  DECIMAL(6,2) NOT NULL DEFAULT 0,
  points          INT DEFAULT 0,
  rebounds        INT DEFAULT 0,
  assists         INT DEFAULT 0,
  steals          INT DEFAULT 0,
  blocks          INT DEFAULT 0,
  turnovers       INT DEFAULT 0,
  minutes_played  DECIMAL(4,1) DEFAULT 0,
  game_status     TEXT DEFAULT 'not_started',
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lineup_id, player_id)
);

CREATE INDEX idx_live_scores_lineup   ON public.live_player_scores(lineup_id);
CREATE INDEX idx_live_scores_player   ON public.live_player_scores(player_id, game_id);

-- 1I. MATCHUP QUEUE — track matchmaking queue state per tier
CREATE TABLE public.matchmaking_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id   UUID NOT NULL UNIQUE REFERENCES public.lineups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id),
  entry_tier  DECIMAL(6,2) NOT NULL,
  game_date   DATE NOT NULL,
  queued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours')
);

CREATE INDEX idx_queue_tier_date  ON public.matchmaking_queue(entry_tier, game_date, queued_at);
CREATE INDEX idx_queue_user       ON public.matchmaking_queue(user_id);

-- Auto-cleanup trigger on handle_new_user for notification_preferences
CREATE OR REPLACE FUNCTION public.handle_new_user_v3()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created_v3
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_v3();

-- ============================================================
-- SECTION 2 — PERFORMANCE: DROP DUPLICATE INDEXES
-- ============================================================
DROP INDEX IF EXISTS public.idx_leaderboard_rank; -- duplicate of idx_leaderboard_period

-- ============================================================
-- SECTION 3 — PERFORMANCE: PARTIAL INDEXES (surgical, tiny, fast)
-- ============================================================

-- Active players only (player market screen)
CREATE INDEX idx_players_active_partial
  ON public.nba_players(salary_tier, season_avg_fpts DESC)
  WHERE is_active = TRUE AND is_injured = FALSE;

-- Pending matchups by tier (matchup finder — most frequent query)
CREATE INDEX idx_matchups_pending_by_tier
  ON public.matchups(entry_tier, game_date, created_at)
  WHERE status = 'pending';

-- Open sidebets feed
CREATE INDEX idx_sidebets_open_feed
  ON public.sidebets(created_at DESC, wager_amount DESC)
  WHERE status = 'open' AND is_open = TRUE;

-- Unread notifications (badge count query)
CREATE INDEX idx_notifications_unread_partial
  ON public.notifications(user_id, created_at DESC)
  WHERE is_read = FALSE;

-- Accepted friends only
CREATE INDEX idx_friends_accepted_by_requester
  ON public.friends(requester_id, updated_at DESC)
  WHERE status = 'accepted';

CREATE INDEX idx_friends_accepted_by_recipient
  ON public.friends(recipient_id, updated_at DESC)
  WHERE status = 'accepted';

-- Active price data only (unlocked players for draft)
CREATE INDEX idx_player_prices_unlocked
  ON public.player_prices(current_price DESC, demand_level)
  WHERE is_locked = FALSE;

-- Live matchups
CREATE INDEX idx_matchups_live_partial
  ON public.matchups(user1_id, user2_id, game_date)
  WHERE status = 'live';

-- Unsent notifications (push worker)
CREATE INDEX idx_notifications_unsent_push
  ON public.notifications(created_at)
  WHERE is_push_sent = FALSE AND sent_at IS NULL;

-- Draftable player availability for today
CREATE INDEX idx_pga_draftable_today
  ON public.player_game_availability(game_date, player_id)
  WHERE is_draftable = TRUE AND is_confirmed = TRUE;

-- ============================================================
-- SECTION 4 — PERFORMANCE: COVERING INDEXES (avoid table heap hits)
-- ============================================================

-- Player market: full card data in one index scan
CREATE INDEX idx_players_market_covering
  ON public.nba_players(is_active, salary_tier)
  INCLUDE (id, full_name, team_abbreviation, position, headshot_url,
           season_avg_fpts, season_avg_pts, season_avg_reb, season_avg_ast,
           last5_avg_fpts, last5_avg_pts, is_injured);

-- Player price card data
CREATE INDEX idx_player_prices_covering
  ON public.player_prices(player_id)
  INCLUDE (current_price, base_price, price_floor, price_ceiling,
           demand_level, price_change_24h, price_change_pct_24h,
           price_velocity, is_locked, tier);

-- Price chart: player + time range → price + volume in one scan
CREATE INDEX idx_price_history_covering
  ON public.price_history(player_id, recorded_at DESC)
  INCLUDE (price, volume);

-- Live scoring: game → player stats (all columns needed for fantasy calc)
CREATE INDEX idx_player_stats_live_covering
  ON public.player_game_stats(game_id, player_id)
  INCLUDE (fantasy_points, points, rebounds, assists, steals, blocks,
           turnovers, minutes_played, status, is_final);

-- Sidebets feed covering (avoid join to prop_lines for feed render)
CREATE INDEX idx_sidebets_feed_covering
  ON public.sidebets(created_at DESC)
  INCLUDE (player_id, game_id, creator_id, wager_amount, line_value,
           stat_category, creator_side, status, is_open, targeted_user_id)
  WHERE status = 'open' AND is_open = TRUE;

-- Leaderboard top-N (period + rank → all display columns)
CREATE INDEX idx_leaderboard_topn_covering
  ON public.leaderboard_entries(period_type, period_key, rank)
  INCLUDE (user_id, score, wins, losses, win_rate);

-- Lineup players for result calculation
CREATE INDEX idx_lineup_players_covering
  ON public.lineup_players(lineup_id)
  INCLUDE (player_id, slot_number, frozen_price, fantasy_points_scored, game_id);

-- Matchup result query (lookup both lineups + scores)
CREATE INDEX idx_matchups_result_covering
  ON public.matchups(user1_id, status)
  INCLUDE (id, lineup1_id, lineup2_id, user2_id, entry_tier, payout_amount,
           user1_score, user2_score, winner_user_id, completed_at, game_date);

-- ============================================================
-- SECTION 5 — PERFORMANCE: TRIGRAM INDEXES (fuzzy search)
-- ============================================================
CREATE INDEX idx_profiles_username_trgm
  ON public.profiles USING gin(username gin_trgm_ops);

CREATE INDEX idx_profiles_display_name_trgm
  ON public.profiles USING gin(display_name gin_trgm_ops);

CREATE INDEX idx_players_fullname_trgm
  ON public.nba_players USING gin(full_name gin_trgm_ops);

CREATE INDEX idx_user_search_username_trgm
  ON public.user_search USING gin(username gin_trgm_ops);

-- ============================================================
-- SECTION 6 — PERFORMANCE: MATERIALIZED VIEWS
-- ============================================================

-- MV 1: Player Market — pre-joins player + price + availability (refreshed every 30s via pg_cron)
CREATE MATERIALIZED VIEW public.mv_player_market AS
SELECT
  p.id,
  p.full_name,
  p.first_name,
  p.last_name,
  p.team,
  p.team_abbreviation,
  p.position,
  p.headshot_url,
  p.is_injured,
  p.injury_note,
  p.salary_tier,
  p.season_avg_fpts,
  p.season_avg_pts,
  p.season_avg_reb,
  p.season_avg_ast,
  p.season_avg_stl,
  p.season_avg_blk,
  p.last5_avg_fpts,
  p.last5_avg_pts,
  p.last5_avg_reb,
  p.last5_avg_ast,
  pp.current_price,
  pp.base_price,
  pp.price_floor,
  pp.price_ceiling,
  pp.price_change_24h,
  pp.price_change_pct_24h,
  pp.demand_level,
  pp.price_velocity,
  pp.is_locked,
  pp.tier,
  t.full_name          AS team_full_name,
  t.primary_color      AS team_primary_color,
  t.secondary_color    AS team_secondary_color,
  t.logo_url           AS team_logo_url
FROM public.nba_players p
JOIN public.player_prices pp ON pp.player_id = p.id
LEFT JOIN public.nba_teams t ON t.id = p.team_id
WHERE p.is_active = TRUE;

CREATE UNIQUE INDEX idx_mv_player_market_id ON public.mv_player_market(id);
CREATE INDEX idx_mv_player_market_tier ON public.mv_player_market(salary_tier, season_avg_fpts DESC);
CREATE INDEX idx_mv_player_market_team ON public.mv_player_market(team_abbreviation);
CREATE INDEX idx_mv_player_market_price ON public.mv_player_market(current_price DESC);
CREATE INDEX idx_mv_player_market_fpts ON public.mv_player_market(last5_avg_fpts DESC);

-- MV 2: Open Sidebets Feed — pre-joins sidebet + player + game info
CREATE MATERIALIZED VIEW public.mv_open_sidebets AS
SELECT
  s.id,
  s.creator_id,
  s.wager_amount,
  s.line_value,
  s.stat_category,
  s.creator_side,
  s.creator_reasoning,
  s.expires_at,
  s.created_at,
  s.is_friend_bet,
  s.targeted_user_id,
  p.id            AS player_id,
  p.full_name     AS player_name,
  p.team_abbreviation,
  p.headshot_url  AS player_headshot,
  g.id            AS game_id,
  g.game_date,
  g.tip_off_time,
  g.home_team_abbreviation,
  g.away_team_abbreviation,
  pl.line_value   AS prop_line_value,
  pl.over_odds,
  pl.under_odds,
  pr.username     AS creator_username,
  pr.avatar_url   AS creator_avatar,
  pr.rank_tier    AS creator_rank
FROM public.sidebets s
JOIN public.nba_players p  ON p.id = s.player_id
JOIN public.nba_games g    ON g.id = s.game_id
JOIN public.profiles pr    ON pr.id = s.creator_id
LEFT JOIN public.prop_lines pl ON pl.id = s.prop_line_id
WHERE s.status = 'open' AND s.is_open = TRUE;

CREATE UNIQUE INDEX idx_mv_open_sidebets_id      ON public.mv_open_sidebets(id);
CREATE INDEX idx_mv_open_sidebets_created        ON public.mv_open_sidebets(created_at DESC);
CREATE INDEX idx_mv_open_sidebets_wager          ON public.mv_open_sidebets(wager_amount DESC);
CREATE INDEX idx_mv_open_sidebets_player         ON public.mv_open_sidebets(player_id);
CREATE INDEX idx_mv_open_sidebets_game           ON public.mv_open_sidebets(game_date);

-- MV 3: Today's Games — quick lookup of today's NBA slate
CREATE MATERIALIZED VIEW public.mv_todays_games AS
SELECT
  g.id,
  g.external_id,
  g.season,
  g.game_date,
  g.tip_off_time,
  g.status,
  g.home_team,
  g.home_team_abbreviation,
  g.away_team,
  g.away_team_abbreviation,
  g.home_score,
  g.away_score,
  g.period,
  g.game_clock,
  g.is_playoffs,
  g.broadcast,
  ht.logo_url    AS home_team_logo,
  ht.primary_color AS home_team_color,
  at.logo_url    AS away_team_logo,
  at.primary_color AS away_team_color
FROM public.nba_games g
LEFT JOIN public.nba_teams ht ON ht.id = g.home_team_id
LEFT JOIN public.nba_teams at ON at.id = g.away_team_id
WHERE g.game_date = CURRENT_DATE
   OR g.game_date = CURRENT_DATE + INTERVAL '1 day';  -- include tomorrow for early drafting

CREATE UNIQUE INDEX idx_mv_todays_games_id   ON public.mv_todays_games(id);
CREATE INDEX idx_mv_todays_games_date        ON public.mv_todays_games(game_date, tip_off_time);
CREATE INDEX idx_mv_todays_games_status      ON public.mv_todays_games(status);

-- ============================================================
-- SECTION 7 — PERFORMANCE: PG_CRON SCHEDULED JOBS
-- ============================================================

-- Refresh player market view every 30 seconds (pricing is real-time critical)
SELECT cron.schedule(
  'refresh-player-market',
  '30 seconds',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_player_market $$
);

-- Refresh open sidebets feed every minute
-- (pg_cron's seconds-interval syntax only accepts 1-59; use standard cron for 1 min)
SELECT cron.schedule(
  'refresh-open-sidebets',
  '* * * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_open_sidebets $$
);

-- Refresh today's games every 5 minutes
SELECT cron.schedule(
  'refresh-todays-games',
  '*/5 * * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_todays_games $$
);

-- Reset daily spending limits every midnight UTC
SELECT cron.schedule(
  'reset-daily-spending',
  '0 0 * * *',
  $$
    UPDATE public.spend_tracking
    SET deposits_today = 0, losses_today = 0, entries_today = 0,
        last_reset_daily = CURRENT_DATE
    WHERE last_reset_daily < CURRENT_DATE;
  $$
);

-- Reset weekly spending limits every Monday midnight UTC
SELECT cron.schedule(
  'reset-weekly-spending',
  '0 0 * * 1',
  $$
    UPDATE public.spend_tracking
    SET deposits_this_week = 0, losses_this_week = 0,
        last_reset_weekly = CURRENT_DATE
    WHERE last_reset_weekly < CURRENT_DATE;
  $$
);

-- Reset monthly spending limits on 1st of every month
SELECT cron.schedule(
  'reset-monthly-spending',
  '0 0 1 * *',
  $$
    UPDATE public.spend_tracking
    SET deposits_this_month = 0, losses_this_month = 0,
        last_reset_monthly = CURRENT_DATE
    WHERE last_reset_monthly < CURRENT_DATE;
  $$
);

-- Expire stale open sidebets every hour
SELECT cron.schedule(
  'expire-sidebets',
  '0 * * * *',
  $$
    UPDATE public.sidebets
    SET status = 'expired'
    WHERE status = 'open' AND expires_at < NOW();
  $$
);

-- Expire stale friend challenges every hour
SELECT cron.schedule(
  'expire-friend-challenges',
  '0 * * * *',
  $$
    UPDATE public.friend_challenges
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < NOW();
  $$
);

-- Remove expired matchmaking queue entries every hour
SELECT cron.schedule(
  'cleanup-matchmaking-queue',
  '0 * * * *',
  $$
    DELETE FROM public.matchmaking_queue WHERE expires_at < NOW();
  $$
);

-- Purge old price history (keep last 90 days) — runs nightly
SELECT cron.schedule(
  'purge-price-history',
  '0 2 * * *',
  $$
    DELETE FROM public.price_history
    WHERE recorded_at < NOW() - INTERVAL '90 days';
  $$
);

-- Delete sidebet messages for completed/expired sidebets older than 7 days
SELECT cron.schedule(
  'purge-sidebet-messages',
  '0 3 * * *',
  $$
    DELETE FROM public.sidebet_messages
    WHERE sidebet_id IN (
      SELECT id FROM public.sidebets
      WHERE status IN ('completed','expired','cancelled','void')
        AND completed_at < NOW() - INTERVAL '7 days'
    );
  $$
);

-- Decay price velocity nightly for players with no demand (prevents stale high prices)
SELECT cron.schedule(
  'decay-price-velocity',
  '*/5 * * * *',
  $$
    UPDATE public.player_prices
    SET
      price_velocity    = price_velocity * 0.95,
      price_acceleration = price_acceleration * 0.90,
      demand_count_1h   = GREATEST(0, demand_count_1h - 1),
      demand_level = CASE
        WHEN demand_count_1h <= 2  THEN 'LOW'
        WHEN demand_count_1h <= 8  THEN 'MEDIUM'
        WHEN demand_count_1h <= 20 THEN 'HIGH'
        ELSE 'EXTREME'
      END
    WHERE is_locked = FALSE;
  $$
);

-- Recalculate weekly leaderboard every Sunday night
SELECT cron.schedule(
  'recalculate-weekly-leaderboard',
  '0 23 * * 0',
  $$
    INSERT INTO public.leaderboard_entries
      (user_id, period_type, period_key, rank, score, wins, losses, win_rate)
    SELECT
      p.id,
      'weekly',
      TO_CHAR(NOW(), 'IYYY-"W"IW'),
      RANK() OVER (ORDER BY SUM(
        CASE WHEN m.winner_user_id = p.id THEN m.payout_amount ELSE 0 END
      ) DESC),
      SUM(CASE WHEN m.winner_user_id = p.id THEN m.payout_amount ELSE 0 END),
      COUNT(CASE WHEN m.winner_user_id = p.id THEN 1 END),
      COUNT(CASE WHEN m.winner_user_id != p.id AND m.status = 'completed' THEN 1 END),
      ROUND(
        COUNT(CASE WHEN m.winner_user_id = p.id THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN m.status = 'completed' THEN 1 END), 0) * 100, 2
      )
    FROM public.profiles p
    JOIN public.matchups m ON (m.user1_id = p.id OR m.user2_id = p.id)
    WHERE m.completed_at >= DATE_TRUNC('week', NOW())
      AND m.status = 'completed'
    GROUP BY p.id
    ON CONFLICT (user_id, period_type, period_key) DO UPDATE SET
      rank       = EXCLUDED.rank,
      score      = EXCLUDED.score,
      wins       = EXCLUDED.wins,
      losses     = EXCLUDED.losses,
      win_rate   = EXCLUDED.win_rate,
      calculated_at = NOW();
  $$
);

-- ============================================================
-- SECTION 8 — RLS ON NEW TABLES
-- ============================================================
ALTER TABLE public.draft_windows              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_game_availability   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_news                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_disputes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_tier_caps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_player_scores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue          ENABLE ROW LEVEL SECURITY;

-- draft_windows: public read
CREATE POLICY "draft_windows_select_all"    ON public.draft_windows FOR SELECT USING (true);

-- player_game_availability: public read
CREATE POLICY "pga_select_all"              ON public.player_game_availability FOR SELECT USING (true);

-- player_news: public read
CREATE POLICY "player_news_select_all"      ON public.player_news FOR SELECT USING (true);

-- matchup_disputes: participants only
CREATE POLICY "disputes_select_participants" ON public.matchup_disputes FOR SELECT USING (
  auth.uid() = opened_by OR
  EXISTS (SELECT 1 FROM public.matchups m WHERE m.id = matchup_id
    AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid()))
);
CREATE POLICY "disputes_insert_own"         ON public.matchup_disputes FOR INSERT
  WITH CHECK (auth.uid() = opened_by);

-- entry_tier_caps: public read
CREATE POLICY "tier_caps_select_all"        ON public.entry_tier_caps FOR SELECT USING (true);

-- notification_preferences: own only
CREATE POLICY "notif_prefs_select_own"      ON public.notification_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notif_prefs_update_own"      ON public.notification_preferences FOR UPDATE USING (auth.uid() = user_id);

-- live_player_scores: visible to matchup participants
CREATE POLICY "live_scores_select_participants" ON public.live_player_scores FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.lineup_players lp
    JOIN public.lineups l ON l.id = lp.lineup_id
    JOIN public.matchups m ON (m.lineup1_id = l.id OR m.lineup2_id = l.id)
    WHERE lp.id = lineup_player_id
      AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
  )
);

-- matchmaking_queue: own only
CREATE POLICY "queue_select_own"  ON public.matchmaking_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "queue_insert_own"  ON public.matchmaking_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "queue_delete_own"  ON public.matchmaking_queue FOR DELETE USING (auth.uid() = user_id);

-- Grant anon/authenticated read access to materialized views (no RLS on MVs in PG)
GRANT SELECT ON public.mv_player_market   TO anon, authenticated;
GRANT SELECT ON public.mv_open_sidebets   TO anon, authenticated;
GRANT SELECT ON public.mv_todays_games    TO anon, authenticated;
