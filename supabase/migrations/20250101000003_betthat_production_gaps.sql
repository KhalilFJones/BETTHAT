-- ============================================================
-- BETTHAT MIGRATION 4: PRODUCTION GAPS
-- Adds: stripe_webhook_events, referral_rewards, payout_methods,
--       player_season_stats, feature_flags
-- ============================================================

-- ============================================================
-- 1. STRIPE WEBHOOK EVENTS (idempotency — critical for real money)
-- ============================================================
-- Prevents double-processing if Stripe retries a webhook delivery.
-- Before crediting a wallet or fulfilling an entry, check this table.
CREATE TABLE public.stripe_webhook_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id  TEXT UNIQUE NOT NULL,          -- Stripe evt_xxx ID
  event_type       TEXT NOT NULL,                 -- e.g. 'payment_intent.succeeded'
  payload          JSONB NOT NULL DEFAULT '{}',   -- full Stripe event body
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processed', 'failed', 'ignored')),
  error_message    TEXT,
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_events_type_status ON public.stripe_webhook_events(event_type, status);
CREATE INDEX idx_stripe_events_created     ON public.stripe_webhook_events(created_at DESC);

-- Auto-purge processed events older than 90 days (storage hygiene)
-- (handled by pg_cron job below)

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- No user-facing access — server-side only via service_role

-- ============================================================
-- 2. REFERRAL REWARDS (track reward lifecycle)
-- ============================================================
-- profiles.referred_by tracks the link. This table tracks
-- when the reward was earned, its value, and payout status.
CREATE TABLE public.referral_rewards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reward_type      TEXT NOT NULL CHECK (reward_type IN ('cash','bonus_credits','free_entry')),
  reward_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  trigger_event    TEXT NOT NULL CHECK (trigger_event IN (
    'signup',            -- referred user signs up
    'first_deposit',     -- referred user makes first deposit
    'first_entry'        -- referred user plays first matchup
  )),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'expired', 'voided')),
  paid_at          TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  transaction_id   UUID REFERENCES public.transactions(id),  -- wallet credit record
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referrer_id, referred_id, trigger_event)  -- one reward per event per pair
);

CREATE INDEX idx_referral_rewards_referrer ON public.referral_rewards(referrer_id, status);
CREATE INDEX idx_referral_rewards_referred ON public.referral_rewards(referred_id);
CREATE INDEX idx_referral_rewards_pending  ON public.referral_rewards(status, created_at)
  WHERE status = 'pending';

CREATE TRIGGER referral_rewards_updated_at
  BEFORE UPDATE ON public.referral_rewards
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referral_rewards_select_own" ON public.referral_rewards
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- ============================================================
-- 3. PAYOUT METHODS (saved withdrawal destinations)
-- ============================================================
-- withdrawal_requests tracks individual withdrawals.
-- This table stores the reusable payment methods so users
-- don't re-enter their info every time.
CREATE TABLE public.payout_methods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method_type      TEXT NOT NULL CHECK (method_type IN (
    'bank_ach',     -- bank account via Plaid/Stripe
    'paypal',
    'venmo',
    'check'
  )),
  display_name     TEXT NOT NULL,                 -- "Chase ****1234" or "PayPal john@email.com"
  -- ACH fields (encrypted at rest via Supabase vault in production)
  bank_name        TEXT,
  account_last4    TEXT,
  routing_last4    TEXT,
  stripe_bank_account_id  TEXT,                  -- Stripe bank account token
  plaid_account_id        TEXT,                  -- Plaid account identifier
  -- Digital wallet fields
  email_or_handle  TEXT,                         -- PayPal email or Venmo @handle
  -- Status
  is_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payout_methods_user        ON public.payout_methods(user_id, is_active);
CREATE INDEX idx_payout_methods_user_default ON public.payout_methods(user_id, is_default)
  WHERE is_default = TRUE AND is_active = TRUE;

-- Ensure only one default per user
CREATE UNIQUE INDEX idx_payout_methods_one_default
  ON public.payout_methods(user_id)
  WHERE is_default = TRUE AND is_active = TRUE;

CREATE TRIGGER payout_methods_updated_at
  BEFORE UPDATE ON public.payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_methods_select_own" ON public.payout_methods
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "payout_methods_insert_own" ON public.payout_methods
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "payout_methods_update_own" ON public.payout_methods
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "payout_methods_delete_own" ON public.payout_methods
  FOR DELETE USING (auth.uid() = user_id);

-- Link payout_methods to withdrawal_requests
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS payout_method_id UUID REFERENCES public.payout_methods(id);

-- ============================================================
-- 4. PLAYER SEASON STATS (aggregated for player cards)
-- ============================================================
-- Shows season averages (PPG/RPG/APG/SPG/BPG) in player
-- selection UI so users can make informed lineup decisions.
CREATE TABLE public.player_season_stats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES public.nba_players(id) ON DELETE CASCADE,
  season           TEXT NOT NULL,                  -- e.g. '2024-25'
  season_type      TEXT NOT NULL DEFAULT 'regular'
                   CHECK (season_type IN ('regular', 'playoffs')),
  games_played     INT NOT NULL DEFAULT 0,
  games_started    INT NOT NULL DEFAULT 0,
  minutes_per_game DECIMAL(4,1),
  -- Scoring
  points_per_game  DECIMAL(4,1),
  -- Rebounds
  reb_per_game     DECIMAL(4,1),
  off_reb_pg       DECIMAL(4,1),
  def_reb_pg       DECIMAL(4,1),
  -- Assists & playmaking
  assists_per_game DECIMAL(4,1),
  turnovers_pg     DECIMAL(4,1),
  assist_to_ratio  DECIMAL(4,2),  -- AST/TO ratio
  -- Defense
  steals_per_game  DECIMAL(4,1),
  blocks_per_game  DECIMAL(4,1),
  -- Shooting
  fg_pct           DECIMAL(4,3),
  fg3_pct          DECIMAL(4,3),
  ft_pct           DECIMAL(4,3),
  -- Fantasy
  fantasy_pts_pg   DECIMAL(5,1),  -- avg BETTHAT fantasy points per game
  -- Metadata
  last_synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, season, season_type)
);

CREATE INDEX idx_player_season_stats_player  ON public.player_season_stats(player_id, season);
CREATE INDEX idx_player_season_stats_season  ON public.player_season_stats(season, season_type);
-- Covering index for the player card query
CREATE INDEX idx_player_season_stats_card
  ON public.player_season_stats(player_id, season, season_type)
  INCLUDE (points_per_game, reb_per_game, assists_per_game, steals_per_game,
           blocks_per_game, fantasy_pts_pg, games_played);

CREATE TRIGGER player_season_stats_updated_at
  BEFORE UPDATE ON public.player_season_stats
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "player_season_stats_select_all" ON public.player_season_stats
  FOR SELECT USING (true);

-- ============================================================
-- 5. FEATURE FLAGS (controlled rollout)
-- ============================================================
-- DB-backed feature flags let you toggle features without
-- a deploy. Critical for phased rollouts and A/B testing.
CREATE TABLE public.feature_flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key         TEXT UNIQUE NOT NULL,          -- e.g. 'live_scoring', 'sidebets_v2'
  description      TEXT,
  is_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Targeting: null = applies to all; set to limit scope
  enabled_for_pct  INT DEFAULT 100                -- % of users (0-100)
                   CHECK (enabled_for_pct BETWEEN 0 AND 100),
  enabled_user_ids UUID[] DEFAULT '{}',           -- allowlist of specific users
  disabled_user_ids UUID[] DEFAULT '{}',          -- denylist (overrides pct/list)
  -- Environment control
  environments     TEXT[] DEFAULT '{production,staging,development}',
  -- Metadata
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feature_flags_key     ON public.feature_flags(flag_key);
CREATE INDEX idx_feature_flags_enabled ON public.feature_flags(is_enabled)
  WHERE is_enabled = TRUE;

CREATE TRIGGER feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
-- Public can read flags (needed by client to show/hide features)
CREATE POLICY "feature_flags_select_all" ON public.feature_flags
  FOR SELECT USING (true);

-- Seed initial feature flags
INSERT INTO public.feature_flags (flag_key, description, is_enabled, enabled_for_pct) VALUES
  ('live_scoring',        'Real-time score updates during active games',        TRUE,  100),
  ('sidebets',            'Player prop sidebets feature',                       TRUE,  100),
  ('friend_challenges',   'Direct challenge a friend feature',                  TRUE,  100),
  ('matchmaking',         'Auto-matchmaking queue',                             TRUE,  100),
  ('referral_program',    'Referral bonus rewards',                             TRUE,  100),
  ('promo_codes',         'Promo code redemptions',                             TRUE,  100),
  ('leaderboards',        'Global leaderboard',                                 TRUE,  100),
  ('price_engine',        'Dynamic player pricing',                             TRUE,  100),
  ('achievements',        'Achievements and badges',                            TRUE,  100),
  ('responsible_gaming',  'Deposit/spend limits and self-exclusion',            TRUE,  100),
  ('kyc_required',        'Require KYC before first withdrawal',                TRUE,  100),
  ('social_feed',         'Social activity feed (future)',                      FALSE, 0  ),
  ('tournaments',         'Multi-user tournament brackets (future)',            FALSE, 0  ),
  ('live_draft',          'Real-time draft room (future)',                      FALSE, 0  ),
  ('player_props_v2',     'Enhanced prop lines with multiple outcomes (future)',FALSE, 0  )
ON CONFLICT (flag_key) DO NOTHING;

-- ============================================================
-- 6. PG_CRON: purge old stripe webhook events
-- ============================================================
SELECT cron.schedule(
  'purge-stripe-webhook-events',
  '0 3 * * *',  -- nightly at 3 AM
  $$
    DELETE FROM public.stripe_webhook_events
    WHERE status IN ('processed', 'ignored')
      AND created_at < NOW() - INTERVAL '90 days';
  $$
);

-- ============================================================
-- 7. MATERIALIZED VIEW: add player_season_stats to mv_player_market
-- ============================================================
-- Drop and recreate mv_player_market to include season PPG/RPG/APG
DROP MATERIALIZED VIEW IF EXISTS public.mv_player_market;

CREATE MATERIALIZED VIEW public.mv_player_market AS
SELECT
  np.id                 AS player_id,
  np.full_name,
  np.position,
  np.jersey_number,
  np.is_active,
  np.is_injured,
  np.salary_tier,
  nt.id                 AS team_id,
  nt.full_name          AS team_name,
  nt.abbreviation       AS team_abbr,
  nt.primary_color      AS team_color,
  nt.logo_url           AS team_logo,
  pp.current_price,
  pp.demand_level,
  pp.price_velocity,
  pp.updated_at         AS price_updated_at,
  -- Season stats for player cards
  pss.points_per_game,
  pss.reb_per_game,
  pss.assists_per_game,
  pss.steals_per_game,
  pss.blocks_per_game,
  pss.fantasy_pts_pg,
  pss.games_played
FROM public.nba_players np
LEFT JOIN public.nba_teams nt        ON np.team_id = nt.id
LEFT JOIN public.player_prices pp    ON np.id = pp.player_id
LEFT JOIN public.player_season_stats pss
  ON np.id = pss.player_id
  AND pss.season = '2024-25'
  AND pss.season_type = 'regular'
WHERE np.is_active = TRUE
WITH DATA;

CREATE UNIQUE INDEX ON public.mv_player_market(player_id);
CREATE INDEX ON public.mv_player_market(team_id);
CREATE INDEX ON public.mv_player_market(salary_tier);
CREATE INDEX ON public.mv_player_market(position);

GRANT SELECT ON public.mv_player_market TO authenticated;
GRANT SELECT ON public.mv_player_market TO anon;
