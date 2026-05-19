-- ============================================================
-- BETTHAT — Schema Addendum v2
-- Fills all gaps for full start-to-finish development
-- ============================================================

-- ============================================================
-- COLUMN ADDITIONS TO EXISTING TABLES
-- ============================================================

-- profiles: KYC/legal compliance, referral program, activity tracking
ALTER TABLE public.profiles
  ADD COLUMN date_of_birth        DATE,
  ADD COLUMN phone_number         TEXT,
  ADD COLUMN state                TEXT,                           -- US state for geo-restrictions
  ADD COLUMN kyc_status           TEXT NOT NULL DEFAULT 'unverified'
                                  CHECK (kyc_status IN ('unverified','pending','verified','rejected')),
  ADD COLUMN referral_code        TEXT UNIQUE,
  ADD COLUMN referred_by          UUID REFERENCES public.profiles(id),
  ADD COLUMN last_active_at       TIMESTAMPTZ,
  ADD COLUMN total_sidebets_won   INT NOT NULL DEFAULT 0,
  ADD COLUMN total_sidebets_lost  INT NOT NULL DEFAULT 0,
  ADD COLUMN total_entries        INT NOT NULL DEFAULT 0,
  ADD COLUMN win_rate             DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN (total_wins + total_losses) = 0 THEN 0
         ELSE ROUND(total_wins::DECIMAL / (total_wins + total_losses) * 100, 2)
    END
  ) STORED;

-- wallets: Stripe integration, withdrawal pending tracking
ALTER TABLE public.wallets
  ADD COLUMN stripe_customer_id      TEXT UNIQUE,
  ADD COLUMN pending_withdrawal      DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN lifetime_winnings       DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN last_deposit_at         TIMESTAMPTZ,
  ADD COLUMN last_withdrawal_at      TIMESTAMPTZ;

-- transactions: Stripe references + flexible metadata
ALTER TABLE public.transactions
  ADD COLUMN stripe_payment_intent_id  TEXT,
  ADD COLUMN stripe_transfer_id        TEXT,
  ADD COLUMN metadata                  JSONB DEFAULT '{}';

-- nba_players: Physical info + pricing tier + team FK (added after nba_teams)
ALTER TABLE public.nba_players
  ADD COLUMN height_inches       INT,
  ADD COLUMN weight_lbs          INT,
  ADD COLUMN birth_date          DATE,
  ADD COLUMN years_experience    INT,
  ADD COLUMN salary_tier         TEXT DEFAULT 'mid' CHECK (salary_tier IN ('budget', 'mid', 'star', 'superstar')),
  ADD COLUMN last5_avg_stl       DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN last5_avg_blk       DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN last5_avg_to        DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN last5_games_played  INT DEFAULT 0,
  ADD COLUMN season_avg_3pm      DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN last5_avg_3pm       DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN season_avg_min      DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN last5_avg_min       DECIMAL(5,2) DEFAULT 0;

-- nba_games: Team FK (added after nba_teams), playoff flag
ALTER TABLE public.nba_games
  ADD COLUMN is_playoffs         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN series_game_number  INT,
  ADD COLUMN broadcast           TEXT,       -- e.g. 'ESPN', 'TNT'
  ADD COLUMN arena               TEXT;

-- player_prices: Price change metrics for UI display
ALTER TABLE public.player_prices
  ADD COLUMN price_change_24h      DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN price_change_pct_24h  DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN avg_price_24h         DECIMAL(8,2),
  ADD COLUMN total_selections      INT DEFAULT 0,   -- all-time selections
  ADD COLUMN tier                  TEXT DEFAULT 'mid' CHECK (tier IN ('budget', 'mid', 'star', 'superstar'));

-- lineups: Game date directly on lineup for easier queries
ALTER TABLE public.lineups
  ADD COLUMN game_date  DATE;

-- lineup_players: Which game this slot is for (future: multi-game lineups)
ALTER TABLE public.lineup_players
  ADD COLUMN game_id  UUID REFERENCES public.nba_games(id);

-- matchups: Denormalized live scores for real-time leaderboard reads
ALTER TABLE public.matchups
  ADD COLUMN user1_score        DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN user2_score        DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN user1_final_score  DECIMAL(8,2),
  ADD COLUMN user2_final_score  DECIMAL(8,2),
  ADD COLUMN score_margin       DECIMAL(8,2);   -- |user1 - user2| for tie-break display

-- sidebets: Target a specific friend instead of open market
ALTER TABLE public.sidebets
  ADD COLUMN targeted_user_id  UUID REFERENCES public.profiles(id),
  ADD COLUMN is_friend_bet     BOOLEAN NOT NULL DEFAULT FALSE;

-- notifications: Track push delivery
ALTER TABLE public.notifications
  ADD COLUMN is_push_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN push_error    TEXT;

-- responsible_gaming_settings: Additional limits for full compliance
ALTER TABLE public.responsible_gaming_settings
  ADD COLUMN loss_limit_daily        DECIMAL(8,2),
  ADD COLUMN loss_limit_weekly       DECIMAL(8,2),
  ADD COLUMN reality_check_interval  INT,            -- minutes between reality checks
  ADD COLUMN max_open_bets           INT,            -- concurrent open sidebets limit
  ADD COLUMN last_reality_check_at   TIMESTAMPTZ;

-- ============================================================
-- NEW TABLE 1: NBA TEAMS
-- ============================================================
CREATE TABLE public.nba_teams (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  abbreviation        TEXT UNIQUE NOT NULL,  -- 'LAL', 'GSW', etc.
  full_name           TEXT NOT NULL,
  city                TEXT NOT NULL,
  conference          TEXT NOT NULL CHECK (conference IN ('East', 'West')),
  division            TEXT NOT NULL CHECK (division IN (
    'Atlantic','Central','Southeast','Northwest','Pacific','Southwest'
  )),
  primary_color       TEXT,                  -- hex color e.g. '#552583'
  secondary_color     TEXT,
  logo_url            TEXT,
  arena               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER nba_teams_updated_at
  BEFORE UPDATE ON public.nba_teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Add team FK to nba_players and nba_games now that nba_teams exists
ALTER TABLE public.nba_players
  ADD COLUMN team_id  UUID REFERENCES public.nba_teams(id);
ALTER TABLE public.nba_games
  ADD COLUMN home_team_id  UUID REFERENCES public.nba_teams(id),
  ADD COLUMN away_team_id  UUID REFERENCES public.nba_teams(id);

-- ============================================================
-- NEW TABLE 2: USER KYC (identity + age verification)
-- ============================================================
CREATE TABLE public.user_kyc (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider            TEXT DEFAULT 'manual' CHECK (provider IN ('manual', 'stripe_identity', 'persona', 'jumio')),
  provider_session_id TEXT,
  status              TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'pending', 'under_review', 'verified', 'rejected', 'expired'
  )),
  rejection_reason    TEXT,
  first_name          TEXT,
  last_name           TEXT,
  date_of_birth       DATE,
  ssn_last4           TEXT,                  -- last 4 only, for compliance
  address_line1       TEXT,
  address_city        TEXT,
  address_state       TEXT,
  address_zip         TEXT,
  id_document_type    TEXT CHECK (id_document_type IN ('drivers_license', 'passport', 'state_id')),
  verified_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER user_kyc_updated_at
  BEFORE UPDATE ON public.user_kyc
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- NEW TABLE 3: STATE RESTRICTIONS (legal geo-blocking)
-- ============================================================
CREATE TABLE public.state_restrictions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code       TEXT UNIQUE NOT NULL,  -- 'CA', 'NY', etc.
  state_name       TEXT NOT NULL,
  is_allowed       BOOLEAN NOT NULL DEFAULT FALSE,
  restriction_type TEXT CHECK (restriction_type IN ('fully_blocked','registration_only','deposits_blocked','all_features')),
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed all 50 states + DC (blocked by default; unblock as legal approval obtained)
INSERT INTO public.state_restrictions (state_code, state_name, is_allowed, restriction_type) VALUES
  ('AL','Alabama',FALSE,'fully_blocked'),('AK','Alaska',FALSE,'fully_blocked'),
  ('AZ','Arizona',TRUE,'all_features'),('AR','Arkansas',FALSE,'fully_blocked'),
  ('CA','California',FALSE,'fully_blocked'),('CO','Colorado',TRUE,'all_features'),
  ('CT','Connecticut',TRUE,'all_features'),('DE','Delaware',TRUE,'all_features'),
  ('FL','Florida',TRUE,'all_features'),('GA','Georgia',FALSE,'fully_blocked'),
  ('HI','Hawaii',FALSE,'fully_blocked'),('ID','Idaho',FALSE,'fully_blocked'),
  ('IL','Illinois',TRUE,'all_features'),('IN','Indiana',TRUE,'all_features'),
  ('IA','Iowa',TRUE,'all_features'),('KS','Kansas',FALSE,'fully_blocked'),
  ('KY','Kentucky',FALSE,'fully_blocked'),('LA','Louisiana',FALSE,'fully_blocked'),
  ('ME','Maine',TRUE,'all_features'),('MD','Maryland',TRUE,'all_features'),
  ('MA','Massachusetts',TRUE,'all_features'),('MI','Michigan',TRUE,'all_features'),
  ('MN','Minnesota',FALSE,'fully_blocked'),('MS','Mississippi',FALSE,'fully_blocked'),
  ('MO','Missouri',TRUE,'all_features'),('MT','Montana',FALSE,'fully_blocked'),
  ('NE','Nebraska',FALSE,'fully_blocked'),('NV','Nevada',TRUE,'all_features'),
  ('NH','New Hampshire',TRUE,'all_features'),('NJ','New Jersey',TRUE,'all_features'),
  ('NM','New Mexico',FALSE,'fully_blocked'),('NY','New York',FALSE,'fully_blocked'),
  ('NC','North Carolina',FALSE,'fully_blocked'),('ND','North Dakota',FALSE,'fully_blocked'),
  ('OH','Ohio',TRUE,'all_features'),('OK','Oklahoma',FALSE,'fully_blocked'),
  ('OR','Oregon',FALSE,'fully_blocked'),('PA','Pennsylvania',TRUE,'all_features'),
  ('RI','Rhode Island',FALSE,'fully_blocked'),('SC','South Carolina',FALSE,'fully_blocked'),
  ('SD','South Dakota',FALSE,'fully_blocked'),('TN','Tennessee',FALSE,'fully_blocked'),
  ('TX','Texas',FALSE,'fully_blocked'),('UT','Utah',FALSE,'fully_blocked'),
  ('VT','Vermont',FALSE,'fully_blocked'),('VA','Virginia',TRUE,'all_features'),
  ('WA','Washington',FALSE,'fully_blocked'),('WV','West Virginia',TRUE,'all_features'),
  ('WI','Wisconsin',FALSE,'fully_blocked'),('WY','Wyoming',FALSE,'fully_blocked'),
  ('DC','District of Columbia',TRUE,'all_features');

-- ============================================================
-- NEW TABLE 4: PUSH NOTIFICATION TOKENS (multi-device)
-- ============================================================
CREATE TABLE public.push_notification_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  device_id    TEXT,
  app_version  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON public.push_notification_tokens
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- NEW TABLE 5: WITHDRAWAL REQUESTS (detailed payout workflow)
-- ============================================================
CREATE TABLE public.withdrawal_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES public.profiles(id),
  wallet_id              UUID NOT NULL REFERENCES public.wallets(id),
  amount                 DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  method                 TEXT NOT NULL CHECK (method IN ('ach','paypal','venmo','cashapp','check')),
  destination_details    JSONB NOT NULL DEFAULT '{}',  -- encrypted payout destination
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','under_review','approved','processing','completed','rejected','cancelled'
  )),
  stripe_transfer_id     TEXT,
  rejection_reason       TEXT,
  reviewed_by            UUID,                         -- admin user id
  reviewed_at            TIMESTAMPTZ,
  processed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER withdrawal_requests_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- NEW TABLE 6: PROMO CODES
-- ============================================================
CREATE TABLE public.promo_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT UNIQUE NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('deposit_bonus','free_entry','credit','referral')),
  value             DECIMAL(8,2) NOT NULL,            -- dollar amount or percentage
  value_type        TEXT NOT NULL DEFAULT 'fixed' CHECK (value_type IN ('fixed','percentage')),
  max_uses          INT,                               -- NULL = unlimited
  uses_count        INT NOT NULL DEFAULT 0,
  max_uses_per_user INT NOT NULL DEFAULT 1,
  min_deposit       DECIMAL(8,2),                     -- minimum deposit to trigger
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at        TIMESTAMPTZ,
  created_by        UUID,                             -- admin user
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- NEW TABLE 7: USER PROMO REDEMPTIONS
-- ============================================================
CREATE TABLE public.user_promo_redemptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id),
  promo_code_id  UUID NOT NULL REFERENCES public.promo_codes(id),
  status         TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','completed','reversed')),
  credit_amount  DECIMAL(8,2) NOT NULL,
  transaction_id UUID REFERENCES public.transactions(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, promo_code_id)
);

-- ============================================================
-- NEW TABLE 8: LEADERBOARD ENTRIES (cached weekly/monthly/all-time)
-- ============================================================
CREATE TABLE public.leaderboard_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_type    TEXT NOT NULL CHECK (period_type IN ('weekly','monthly','all_time','season')),
  period_key     TEXT NOT NULL,                       -- e.g. '2025-W20', '2025-05', 'all', '2024-25'
  rank           INT NOT NULL,
  score          DECIMAL(10,2) NOT NULL DEFAULT 0,    -- total winnings for period
  wins           INT NOT NULL DEFAULT 0,
  losses         INT NOT NULL DEFAULT 0,
  win_rate       DECIMAL(5,2) DEFAULT 0,
  calculated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_type, period_key)
);

CREATE INDEX idx_leaderboard_period ON public.leaderboard_entries(period_type, period_key, rank);

-- ============================================================
-- NEW TABLE 9: APP CONFIG (global key-value settings + feature flags)
-- ============================================================
CREATE TABLE public.app_config (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  description  TEXT,
  is_secret    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default config
INSERT INTO public.app_config (key, value, description) VALUES
  ('rake_percentage',          '3.5',    'Rake % taken from each matchup pot'),
  ('sidebet_rake_percentage',  '5.0',    'Rake % taken from each sidebet'),
  ('min_entry',                '1.00',   'Minimum entry tier in dollars'),
  ('max_entry',                '50.00',  'Maximum entry tier in dollars'),
  ('price_floor_pct',          '0.60',   'Minimum price as % of base price'),
  ('price_ceiling_pct',        '1.80',   'Maximum price as % of base price'),
  ('demand_decay_rate',        '0.05',   'Price velocity decay per tick (no new demand)'),
  ('price_tick_interval_secs', '30',     'Seconds between price recalculation ticks'),
  ('max_sidebet_wager',        '500.00', 'Maximum wager per sidebet'),
  ('min_sidebet_wager',        '1.00',   'Minimum wager per sidebet'),
  ('min_deposit',              '10.00',  'Minimum deposit amount'),
  ('max_daily_deposit',        '1000.00','Default daily deposit cap (before custom limits)'),
  ('min_withdrawal',           '10.00',  'Minimum withdrawal amount'),
  ('min_withdrawal_balance',   '10.00',  'Minimum wallet balance after withdrawal'),
  ('kyc_required_threshold',   '50.00',  'Deposit amount that triggers KYC requirement'),
  ('price_history_retention_days', '90', 'Days to retain price tick history'),
  ('sidebet_message_retention_days', '7','Days to keep sidebet messages after completion'),
  ('feature_sidebets',         'true',   'Feature flag: sidebets enabled'),
  ('feature_friend_challenges','true',   'Feature flag: friend challenges enabled'),
  ('feature_leaderboard',      'true',   'Feature flag: leaderboard enabled'),
  ('feature_promo_codes',      'true',   'Feature flag: promo codes enabled'),
  ('feature_ai_reasoning',     'true',   'Feature flag: AI-generated bet reasoning'),
  ('maintenance_mode',         'false',  'When true, app shows maintenance screen');

-- ============================================================
-- NEW TABLE 10: USER BLOCKS (block other users)
-- ============================================================
CREATE TABLE public.user_blocks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

-- ============================================================
-- NEW TABLE 11: USER REPORTS (report inappropriate behavior)
-- ============================================================
CREATE TABLE public.user_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES public.profiles(id),
  reported_id  UUID NOT NULL REFERENCES public.profiles(id),
  reason       TEXT NOT NULL CHECK (reason IN (
    'harassment','cheating','spam','inappropriate_content','underage','other'
  )),
  details      TEXT,
  context_type TEXT CHECK (context_type IN ('sidebet_message','profile','matchup','general')),
  context_id   UUID,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  resolution   TEXT,
  reviewed_by  UUID,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NEW TABLE 12: MATCHUP SCORE SNAPSHOTS (live timeline data)
-- ============================================================
CREATE TABLE public.matchup_score_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matchup_id   UUID NOT NULL REFERENCES public.matchups(id) ON DELETE CASCADE,
  user1_score  DECIMAL(8,2) NOT NULL DEFAULT 0,
  user2_score  DECIMAL(8,2) NOT NULL DEFAULT 0,
  period       INT,
  game_clock   TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_score_snapshots_matchup ON public.matchup_score_snapshots(matchup_id, recorded_at DESC);

-- ============================================================
-- NEW TABLE 13: PRICE ENGINE CONFIG (per-tier algo params)
-- ============================================================
CREATE TABLE public.price_engine_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier                      TEXT UNIQUE NOT NULL CHECK (tier IN ('budget','mid','star','superstar')),
  base_price_range_min      DECIMAL(8,2) NOT NULL,
  base_price_range_max      DECIMAL(8,2) NOT NULL,
  demand_sensitivity        DECIMAL(5,4) NOT NULL DEFAULT 0.02,  -- price change per selection
  max_velocity              DECIMAL(5,4) NOT NULL DEFAULT 0.15,  -- max price move per tick
  matchup_modifier_range    DECIMAL(5,4) NOT NULL DEFAULT 0.08,  -- ±% for matchup difficulty
  injury_discount           DECIMAL(5,4) NOT NULL DEFAULT 0.25,  -- % price cut when injured
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER price_engine_config_updated_at
  BEFORE UPDATE ON public.price_engine_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

INSERT INTO public.price_engine_config
  (tier, base_price_range_min, base_price_range_max, demand_sensitivity, max_velocity, matchup_modifier_range, injury_discount)
VALUES
  ('budget',    5.00,  15.00, 0.03, 0.20, 0.05, 0.20),
  ('mid',       15.01, 30.00, 0.025,0.15, 0.06, 0.22),
  ('star',      30.01, 50.00, 0.02, 0.12, 0.07, 0.25),
  ('superstar', 50.01, 80.00, 0.015,0.10, 0.08, 0.30);

-- ============================================================
-- NEW TABLE 14: ADMIN AUDIT LOG (compliance + ops)
-- ============================================================
CREATE TABLE public.admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES public.profiles(id),
  action       TEXT NOT NULL,                            -- e.g. 'ban_user', 'void_matchup'
  target_type  TEXT NOT NULL,                            -- e.g. 'user', 'matchup', 'sidebet'
  target_id    UUID NOT NULL,
  details      JSONB DEFAULT '{}',
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_target ON public.admin_audit_log(target_type, target_id);
CREATE INDEX idx_admin_audit_admin  ON public.admin_audit_log(admin_id, created_at DESC);

-- ============================================================
-- NEW TABLE 15: SPEND TRACKING (enforce responsible gaming limits)
-- Rolling windows for daily/weekly/monthly deposit + loss tracking
-- ============================================================
CREATE TABLE public.spend_tracking (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  deposits_today       DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposits_this_week   DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposits_this_month  DECIMAL(10,2) NOT NULL DEFAULT 0,
  losses_today         DECIMAL(10,2) NOT NULL DEFAULT 0,
  losses_this_week     DECIMAL(10,2) NOT NULL DEFAULT 0,
  losses_this_month    DECIMAL(10,2) NOT NULL DEFAULT 0,
  entries_today        DECIMAL(10,2) NOT NULL DEFAULT 0,
  session_start_at     TIMESTAMPTZ,
  last_reset_daily     DATE NOT NULL DEFAULT CURRENT_DATE,
  last_reset_weekly    DATE NOT NULL DEFAULT CURRENT_DATE,
  last_reset_monthly   DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER spend_tracking_updated_at
  BEFORE UPDATE ON public.spend_tracking
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- NEW TABLE 16: MATCHUP GAME ASSIGNMENTS
-- Maps which NBA games count for a matchup
-- (supports future multi-game slate mode)
-- ============================================================
CREATE TABLE public.matchup_games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matchup_id  UUID NOT NULL REFERENCES public.matchups(id) ON DELETE CASCADE,
  game_id     UUID NOT NULL REFERENCES public.nba_games(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(matchup_id, game_id)
);

-- ============================================================
-- NEW TABLE 17: USER SEARCH INDEX (fast username/display name search)
-- ============================================================
CREATE TABLE public.user_search (
  user_id       UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  rank_tier     TEXT,
  total_wins    INT DEFAULT 0,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', username || ' ' || COALESCE(display_name, ''))
  ) STORED
);

CREATE INDEX idx_user_search_vector ON public.user_search USING gin(search_vector);
CREATE INDEX idx_user_search_username ON public.user_search(username text_pattern_ops);

-- ============================================================
-- TRIGGER: keep user_search in sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_user_search()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_search (user_id, username, display_name, avatar_url, rank_tier, total_wins)
  VALUES (NEW.id, NEW.username, NEW.display_name, NEW.avatar_url, NEW.rank_tier, NEW.total_wins)
  ON CONFLICT (user_id) DO UPDATE SET
    username     = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    avatar_url   = EXCLUDED.avatar_url,
    rank_tier    = EXCLUDED.rank_tier,
    total_wins   = EXCLUDED.total_wins;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_sync_search
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_search();

-- ============================================================
-- TRIGGER: auto-create spend_tracking row on new user
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_v2()
RETURNS TRIGGER AS $$
BEGIN
  -- spend_tracking (in addition to what handle_new_user already creates)
  INSERT INTO public.spend_tracking (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_kyc (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created_v2
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_v2();

-- ============================================================
-- RLS ON NEW TABLES
-- ============================================================
ALTER TABLE public.nba_teams                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_kyc                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_restrictions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_promo_redemptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_score_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_engine_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spend_tracking             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_games              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_search                ENABLE ROW LEVEL SECURITY;

-- nba_teams: public read
CREATE POLICY "nba_teams_select_all"        ON public.nba_teams FOR SELECT USING (true);

-- user_kyc: private, own only
CREATE POLICY "kyc_select_own"              ON public.user_kyc FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "kyc_update_own"              ON public.user_kyc FOR UPDATE USING (auth.uid() = user_id);

-- state_restrictions: public read
CREATE POLICY "states_select_all"           ON public.state_restrictions FOR SELECT USING (true);

-- push_notification_tokens: own only
CREATE POLICY "push_tokens_select_own"      ON public.push_notification_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "push_tokens_insert_own"      ON public.push_notification_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "push_tokens_update_own"      ON public.push_notification_tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "push_tokens_delete_own"      ON public.push_notification_tokens FOR DELETE USING (auth.uid() = user_id);

-- withdrawal_requests: own only
CREATE POLICY "withdrawals_select_own"      ON public.withdrawal_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "withdrawals_insert_own"      ON public.withdrawal_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- promo_codes: public read for active codes
CREATE POLICY "promos_select_active"        ON public.promo_codes FOR SELECT USING (is_active = true);

-- user_promo_redemptions: own only
CREATE POLICY "promo_redemptions_select_own" ON public.user_promo_redemptions FOR SELECT USING (auth.uid() = user_id);

-- leaderboard: public read
CREATE POLICY "leaderboard_select_all"      ON public.leaderboard_entries FOR SELECT USING (true);

-- app_config: public read for non-secrets
CREATE POLICY "config_select_public"        ON public.app_config FOR SELECT USING (is_secret = false);

-- user_blocks: own only
CREATE POLICY "blocks_select_own"           ON public.user_blocks FOR SELECT USING (auth.uid() = blocker_id);
CREATE POLICY "blocks_insert_own"           ON public.user_blocks FOR INSERT WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "blocks_delete_own"           ON public.user_blocks FOR DELETE USING (auth.uid() = blocker_id);

-- user_reports: own + viewing only
CREATE POLICY "reports_insert_own"          ON public.user_reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports_select_own"          ON public.user_reports FOR SELECT USING (auth.uid() = reporter_id);

-- matchup_score_snapshots: visible to matchup participants
CREATE POLICY "snapshots_select_participants" ON public.matchup_score_snapshots FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.matchups m
    WHERE m.id = matchup_id
      AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
  )
);

-- price_engine_config: public read
CREATE POLICY "price_config_select_all"     ON public.price_engine_config FOR SELECT USING (true);

-- admin_audit_log: admin only (service role only via backend)
CREATE POLICY "audit_no_access"             ON public.admin_audit_log FOR SELECT USING (false);

-- spend_tracking: own only
CREATE POLICY "spend_select_own"            ON public.spend_tracking FOR SELECT USING (auth.uid() = user_id);

-- matchup_games: visible to matchup participants
CREATE POLICY "matchup_games_select"        ON public.matchup_games FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.matchups m
    WHERE m.id = matchup_id
      AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
  )
);

-- user_search: public read
CREATE POLICY "user_search_select_all"      ON public.user_search FOR SELECT USING (true);

-- ============================================================
-- ADDITIONAL INDEXES ON NEW + MODIFIED TABLES
-- ============================================================
CREATE INDEX idx_profiles_kyc_status        ON public.profiles(kyc_status);
CREATE INDEX idx_profiles_state             ON public.profiles(state);
CREATE INDEX idx_profiles_referral          ON public.profiles(referral_code);
CREATE INDEX idx_wallets_stripe_customer    ON public.wallets(stripe_customer_id);
CREATE INDEX idx_nba_players_salary_tier    ON public.nba_players(salary_tier, is_active);
CREATE INDEX idx_nba_teams_abbreviation     ON public.nba_teams(abbreviation);
CREATE INDEX idx_withdrawal_requests_user   ON public.withdrawal_requests(user_id, status);
CREATE INDEX idx_leaderboard_rank           ON public.leaderboard_entries(period_type, period_key, rank);
CREATE INDEX idx_sidebets_targeted          ON public.sidebets(targeted_user_id, status);
CREATE INDEX idx_sidebets_friend            ON public.sidebets(creator_id, is_friend_bet, status);
CREATE INDEX idx_matchup_games_matchup      ON public.matchup_games(matchup_id);
CREATE INDEX idx_matchup_games_game         ON public.matchup_games(game_id);
CREATE INDEX idx_push_tokens_user           ON public.push_notification_tokens(user_id, is_active);
CREATE INDEX idx_spend_tracking_user        ON public.spend_tracking(user_id);
