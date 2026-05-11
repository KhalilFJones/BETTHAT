-- ============================================================
-- BETTHAT — Initial Database Schema
-- Skill-based real-money NBA fantasy app with dynamic pricing
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username         TEXT UNIQUE NOT NULL,
  display_name     TEXT,
  avatar_url       TEXT,
  bio              TEXT,
  total_wins       INT NOT NULL DEFAULT 0,
  total_losses     INT NOT NULL DEFAULT 0,
  total_earnings   DECIMAL(10,2) NOT NULL DEFAULT 0,
  rank_tier        TEXT DEFAULT 'Bronze' CHECK (rank_tier IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond')),
  is_banned        BOOLEAN NOT NULL DEFAULT FALSE,
  push_token       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. WALLETS
-- ============================================================
CREATE TABLE public.wallets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance           DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  escrow_balance    DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (escrow_balance >= 0),
  total_deposited   DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_withdrawn   DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. TRANSACTIONS
-- ============================================================
CREATE TABLE public.transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID NOT NULL REFERENCES public.wallets(id),
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  type            TEXT NOT NULL CHECK (type IN (
    'deposit', 'withdrawal', 'entry_fee', 'payout', 'rake',
    'escrow_hold', 'escrow_release', 'refund',
    'sidebet_wager', 'sidebet_payout'
  )),
  amount          DECIMAL(10,2) NOT NULL,
  balance_after   DECIMAL(10,2) NOT NULL,
  reference_id    UUID,
  reference_type  TEXT,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. NBA PLAYERS
-- ============================================================
CREATE TABLE public.nba_players (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           TEXT UNIQUE,
  full_name             TEXT NOT NULL,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  team                  TEXT NOT NULL,
  team_abbreviation     TEXT NOT NULL,
  position              TEXT NOT NULL CHECK (position IN ('PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'GF', 'FC')),
  jersey_number         TEXT,
  headshot_url          TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_injured            BOOLEAN NOT NULL DEFAULT FALSE,
  injury_note           TEXT,
  injury_expected_return DATE,
  -- Season averages
  season_avg_fpts       DECIMAL(6,2) DEFAULT 0,
  season_avg_pts        DECIMAL(5,2) DEFAULT 0,
  season_avg_reb        DECIMAL(5,2) DEFAULT 0,
  season_avg_ast        DECIMAL(5,2) DEFAULT 0,
  season_avg_stl        DECIMAL(5,2) DEFAULT 0,
  season_avg_blk        DECIMAL(5,2) DEFAULT 0,
  season_avg_to         DECIMAL(5,2) DEFAULT 0,
  season_games_played   INT DEFAULT 0,
  -- Last 5 game averages
  last5_avg_fpts        DECIMAL(6,2) DEFAULT 0,
  last5_avg_pts         DECIMAL(5,2) DEFAULT 0,
  last5_avg_reb         DECIMAL(5,2) DEFAULT 0,
  last5_avg_ast         DECIMAL(5,2) DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. NBA GAMES (schedule)
-- ============================================================
CREATE TABLE public.nba_games (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id              TEXT UNIQUE,
  season                   TEXT NOT NULL,
  home_team                TEXT NOT NULL,
  home_team_abbreviation   TEXT NOT NULL,
  away_team                TEXT NOT NULL,
  away_team_abbreviation   TEXT NOT NULL,
  game_date                DATE NOT NULL,
  tip_off_time             TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'pregame', 'live', 'halftime', 'final', 'postponed', 'cancelled'
  )),
  home_score               INT,
  away_score               INT,
  period                   INT,
  game_clock               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. PLAYER GAME STATS (actual per-game performance)
-- Fantasy points formula: pts + reb*1.2 + ast*1.5 + stl*3 + blk*3 - to*1
-- ============================================================
CREATE TABLE public.player_game_stats (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id              UUID NOT NULL REFERENCES public.nba_players(id),
  game_id                UUID NOT NULL REFERENCES public.nba_games(id),
  minutes_played         DECIMAL(4,1),
  points                 INT DEFAULT 0,
  rebounds               INT DEFAULT 0,
  assists                INT DEFAULT 0,
  steals                 INT DEFAULT 0,
  blocks                 INT DEFAULT 0,
  turnovers              INT DEFAULT 0,
  field_goals_made       INT DEFAULT 0,
  field_goals_attempted  INT DEFAULT 0,
  three_pointers_made    INT DEFAULT 0,
  free_throws_made       INT DEFAULT 0,
  free_throws_attempted  INT DEFAULT 0,
  plus_minus             INT DEFAULT 0,
  fantasy_points         DECIMAL(6,2) GENERATED ALWAYS AS (
    points
    + rebounds  * 1.2
    + assists   * 1.5
    + steals    * 3.0
    + blocks    * 3.0
    - turnovers * 1.0
  ) STORED,
  status                 TEXT NOT NULL DEFAULT 'not_yet_played' CHECK (status IN (
    'active', 'dnp', 'dnp_coach', 'did_not_dress', 'not_yet_played'
  )),
  is_final               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);

-- ============================================================
-- 7. PLAYER PRICES (live pricing engine state)
-- Layer 1: base price at market open
-- Layer 2: demand / velocity adjustments
-- Layer 3: matchup + injury modifiers
-- ============================================================
CREATE TABLE public.player_prices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID NOT NULL UNIQUE REFERENCES public.nba_players(id),
  base_price           DECIMAL(8,2) NOT NULL,
  current_price        DECIMAL(8,2) NOT NULL,
  price_floor          DECIMAL(8,2) NOT NULL,     -- 60% of base_price
  price_ceiling        DECIMAL(8,2) NOT NULL,     -- 180% of base_price
  price_velocity       DECIMAL(8,4) DEFAULT 0,
  price_acceleration   DECIMAL(8,4) DEFAULT 0,
  demand_count_1h      INT DEFAULT 0,
  demand_level         TEXT DEFAULT 'MEDIUM' CHECK (demand_level IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
  matchup_modifier     DECIMAL(5,4) DEFAULT 1.0,  -- ±3–8% per difficulty
  injury_modifier      DECIMAL(5,4) DEFAULT 1.0,
  is_locked            BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason          TEXT,
  market_open_at       TIMESTAMPTZ,
  market_close_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. PRICE HISTORY (for charts: 1D / 1W / 1M / Season)
-- ============================================================
CREATE TABLE public.price_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES public.nba_players(id),
  price       DECIMAL(8,2) NOT NULL,
  volume      INT DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. LINEUPS (user's 3-player H2H draft)
-- ============================================================
CREATE TABLE public.lineups (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id),
  entry_tier           DECIMAL(6,2) NOT NULL CHECK (entry_tier IN (1, 5, 10, 20, 50)),
  status               TEXT NOT NULL DEFAULT 'building' CHECK (status IN (
    'building', 'submitted', 'matched', 'live', 'completed', 'voided', 'cancelled'
  )),
  total_cap_used       DECIMAL(8,2) DEFAULT 0,
  fantasy_points_total DECIMAL(8,2) DEFAULT 0,
  is_friend_challenge  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. LINEUP PLAYERS (3 players per lineup with frozen prices)
-- ============================================================
CREATE TABLE public.lineup_players (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id              UUID NOT NULL REFERENCES public.lineups(id) ON DELETE CASCADE,
  player_id              UUID NOT NULL REFERENCES public.nba_players(id),
  slot_number            INT NOT NULL CHECK (slot_number BETWEEN 1 AND 3),
  frozen_price           DECIMAL(8,2) NOT NULL,
  fantasy_points_scored  DECIMAL(6,2) DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lineup_id, slot_number),
  UNIQUE(lineup_id, player_id)
);

-- ============================================================
-- 11. MATCHUPS (H2H games between two lineups)
-- ============================================================
CREATE TABLE public.matchups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup1_id        UUID NOT NULL REFERENCES public.lineups(id),
  lineup2_id        UUID REFERENCES public.lineups(id),
  user1_id          UUID NOT NULL REFERENCES public.profiles(id),
  user2_id          UUID REFERENCES public.profiles(id),
  entry_tier        DECIMAL(6,2) NOT NULL,
  pot_amount        DECIMAL(8,2) NOT NULL,
  rake_amount       DECIMAL(8,2) NOT NULL,      -- 3.5% of pot
  payout_amount     DECIMAL(8,2) NOT NULL,      -- pot - rake
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'matched', 'live', 'completed', 'voided', 'tie'
  )),
  winner_lineup_id  UUID REFERENCES public.lineups(id),
  winner_user_id    UUID REFERENCES public.profiles(id),
  is_friend_challenge BOOLEAN NOT NULL DEFAULT FALSE,
  game_date         DATE,
  matched_at        TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. FRIEND CHALLENGES (direct friend-to-friend H2H invites)
-- ============================================================
CREATE TABLE public.friend_challenges (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id          UUID NOT NULL REFERENCES public.profiles(id),
  recipient_id           UUID NOT NULL REFERENCES public.profiles(id),
  challenger_lineup_id   UUID NOT NULL REFERENCES public.lineups(id),
  entry_tier             DECIMAL(6,2) NOT NULL,
  message                TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'declined', 'expired', 'cancelled'
  )),
  matchup_id             UUID REFERENCES public.matchups(id),
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 13. FRIENDS (social graph)
-- ============================================================
CREATE TABLE public.friends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES public.profiles(id),
  recipient_id  UUID NOT NULL REFERENCES public.profiles(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked', 'declined')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(requester_id, recipient_id),
  CHECK (requester_id != recipient_id)
);

-- ============================================================
-- 14. PROP LINES (Vegas-style lines for sidebets)
-- ============================================================
CREATE TABLE public.prop_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES public.nba_players(id),
  game_id        UUID NOT NULL REFERENCES public.nba_games(id),
  stat_category  TEXT NOT NULL CHECK (stat_category IN (
    'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers',
    'three_pointers', 'pts_reb_ast', 'pts_reb', 'pts_ast', 'reb_ast'
  )),
  line_value     DECIMAL(5,1) NOT NULL,
  over_odds      INT DEFAULT -110,
  under_odds     INT DEFAULT -110,
  source         TEXT DEFAULT 'composite',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id, stat_category)
);

-- ============================================================
-- 15. SIDEBETS (prop challenges between users)
-- ============================================================
CREATE TABLE public.sidebets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          UUID NOT NULL REFERENCES public.profiles(id),
  opponent_id         UUID REFERENCES public.profiles(id),
  player_id           UUID NOT NULL REFERENCES public.nba_players(id),
  game_id             UUID NOT NULL REFERENCES public.nba_games(id),
  prop_line_id        UUID REFERENCES public.prop_lines(id),
  stat_category       TEXT NOT NULL CHECK (stat_category IN (
    'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers',
    'three_pointers', 'pts_reb_ast', 'pts_reb', 'pts_ast', 'reb_ast'
  )),
  line_value          DECIMAL(5,1) NOT NULL,
  creator_side        TEXT NOT NULL CHECK (creator_side IN ('OVER', 'UNDER')),
  creator_reasoning   TEXT,
  opponent_reasoning  TEXT,
  wager_amount        DECIMAL(8,2) NOT NULL CHECK (wager_amount > 0),
  is_open             BOOLEAN NOT NULL DEFAULT TRUE,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'accepted', 'live', 'completed', 'expired', 'cancelled', 'void'
  )),
  winner_id           UUID REFERENCES public.profiles(id),
  final_stat_value    DECIMAL(6,2),
  rake_amount         DECIMAL(8,2),
  payout_amount       DECIMAL(8,2),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

-- ============================================================
-- 16. SIDEBET MESSAGES (ephemeral trash talk — deleted after match)
-- ============================================================
CREATE TABLE public.sidebet_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sidebet_id    UUID NOT NULL REFERENCES public.sidebets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id),
  message_type  TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'voice_memo', 'gif', 'ai_roast')),
  content       TEXT,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 17. ACHIEVEMENTS (catalog)
-- ============================================================
CREATE TABLE public.achievements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_url    TEXT,
  category    TEXT NOT NULL CHECK (category IN ('performance', 'social', 'milestone', 'streak', 'special')),
  rarity      TEXT NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 18. USER ACHIEVEMENTS (earned badges)
-- ============================================================
CREATE TABLE public.user_achievements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES public.achievements(id),
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ============================================================
-- 19. RESPONSIBLE GAMING SETTINGS
-- ============================================================
CREATE TABLE public.responsible_gaming_settings (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  daily_deposit_limit        DECIMAL(8,2),
  weekly_deposit_limit       DECIMAL(8,2),
  monthly_deposit_limit      DECIMAL(8,2),
  daily_entry_limit          DECIMAL(8,2),
  self_excluded_until        TIMESTAMPTZ,
  is_permanently_excluded    BOOLEAN NOT NULL DEFAULT FALSE,
  cooling_off_until          TIMESTAMPTZ,
  session_time_limit_mins    INT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 20. NOTIFICATIONS
-- ============================================================
CREATE TABLE public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
    'matchup_found', 'game_starting', 'game_final',
    'sidebet_received', 'sidebet_accepted', 'sidebet_result',
    'friend_request', 'friend_challenge', 'achievement_earned',
    'deposit_confirmed', 'withdrawal_processed', 'price_alert'
  )),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_profiles_username      ON public.profiles(username);
CREATE INDEX idx_transactions_user      ON public.transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_ref       ON public.transactions(reference_id, reference_type);
CREATE INDEX idx_nba_players_team       ON public.nba_players(team, is_active);
CREATE INDEX idx_nba_games_date         ON public.nba_games(game_date, status);
CREATE INDEX idx_player_stats_player    ON public.player_game_stats(player_id, game_id);
CREATE INDEX idx_player_stats_game      ON public.player_game_stats(game_id);
CREATE INDEX idx_price_history_player   ON public.price_history(player_id, recorded_at DESC);
CREATE INDEX idx_lineups_user_status    ON public.lineups(user_id, status);
CREATE INDEX idx_lineups_tier_status    ON public.lineups(entry_tier, status);
CREATE INDEX idx_matchups_status_tier   ON public.matchups(status, entry_tier);
CREATE INDEX idx_matchups_user1         ON public.matchups(user1_id, status);
CREATE INDEX idx_matchups_user2         ON public.matchups(user2_id, status);
CREATE INDEX idx_sidebets_status_open   ON public.sidebets(status, is_open);
CREATE INDEX idx_sidebets_creator       ON public.sidebets(creator_id, status);
CREATE INDEX idx_sidebets_player_game   ON public.sidebets(player_id, game_id);
CREATE INDEX idx_friends_requester      ON public.friends(requester_id, status);
CREATE INDEX idx_friends_recipient      ON public.friends(recipient_id, status);
CREATE INDEX idx_notifications_user     ON public.notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- TRIGGERS — auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at           BEFORE UPDATE ON public.profiles                   FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER wallets_updated_at            BEFORE UPDATE ON public.wallets                    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER nba_players_updated_at        BEFORE UPDATE ON public.nba_players                FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER nba_games_updated_at          BEFORE UPDATE ON public.nba_games                  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER player_game_stats_updated_at  BEFORE UPDATE ON public.player_game_stats          FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER player_prices_updated_at      BEFORE UPDATE ON public.player_prices              FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER lineups_updated_at            BEFORE UPDATE ON public.lineups                    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER matchups_updated_at           BEFORE UPDATE ON public.matchups                   FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER friend_challenges_updated_at  BEFORE UPDATE ON public.friend_challenges          FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER friends_updated_at            BEFORE UPDATE ON public.friends                    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER sidebets_updated_at           BEFORE UPDATE ON public.sidebets                   FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER prop_lines_updated_at         BEFORE UPDATE ON public.prop_lines                 FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER responsible_gaming_updated_at BEFORE UPDATE ON public.responsible_gaming_settings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- TRIGGER — auto-create profile + wallet on new signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      'user_' || substr(NEW.id::text, 1, 8)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    )
  );

  INSERT INTO public.wallets (user_id) VALUES (NEW.id);
  INSERT INTO public.responsible_gaming_settings (user_id) VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_players                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_games                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_game_stats           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_prices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineups                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineup_players              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchups                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_challenges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prop_lines                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidebets                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidebet_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsible_gaming_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications               ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "profiles_select_public"   ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own"      ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- WALLETS
CREATE POLICY "wallets_select_own"       ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wallets_update_own"       ON public.wallets FOR UPDATE USING (auth.uid() = user_id);

-- TRANSACTIONS
CREATE POLICY "transactions_select_own"  ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- NBA PLAYERS (public read)
CREATE POLICY "players_select_all"       ON public.nba_players FOR SELECT USING (true);

-- NBA GAMES (public read)
CREATE POLICY "games_select_all"         ON public.nba_games FOR SELECT USING (true);

-- PLAYER GAME STATS (public read)
CREATE POLICY "player_stats_select_all"  ON public.player_game_stats FOR SELECT USING (true);

-- PLAYER PRICES (public read)
CREATE POLICY "prices_select_all"        ON public.player_prices FOR SELECT USING (true);

-- PRICE HISTORY (public read)
CREATE POLICY "price_history_select_all" ON public.price_history FOR SELECT USING (true);

-- LINEUPS
CREATE POLICY "lineups_select_own"       ON public.lineups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "lineups_select_matched"   ON public.lineups FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.matchups m
    WHERE (m.lineup1_id = id OR m.lineup2_id = id)
      AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
      AND m.status IN ('matched', 'live', 'completed')
  )
);
CREATE POLICY "lineups_insert_own"       ON public.lineups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lineups_update_building"  ON public.lineups FOR UPDATE USING (auth.uid() = user_id AND status = 'building');

-- LINEUP PLAYERS
CREATE POLICY "lineup_players_select_own" ON public.lineup_players FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid())
);
CREATE POLICY "lineup_players_select_matched" ON public.lineup_players FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.lineups l
    JOIN public.matchups m ON (m.lineup1_id = l.id OR m.lineup2_id = l.id)
    WHERE l.id = lineup_id
      AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
      AND m.status IN ('matched', 'live', 'completed')
  )
);
CREATE POLICY "lineup_players_insert_own" ON public.lineup_players FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lineups l
    WHERE l.id = lineup_id AND l.user_id = auth.uid() AND l.status = 'building'
  )
);

-- MATCHUPS
CREATE POLICY "matchups_select_participants" ON public.matchups FOR SELECT USING (
  auth.uid() = user1_id OR auth.uid() = user2_id
);
CREATE POLICY "matchups_select_pending"      ON public.matchups FOR SELECT USING (status = 'pending');

-- FRIENDS
CREATE POLICY "friends_select_own"       ON public.friends FOR SELECT USING (
  auth.uid() = requester_id OR auth.uid() = recipient_id
);
CREATE POLICY "friends_insert_own"       ON public.friends FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "friends_update_recipient" ON public.friends FOR UPDATE USING (auth.uid() = recipient_id);

-- FRIEND CHALLENGES
CREATE POLICY "fc_select_participants"   ON public.friend_challenges FOR SELECT USING (
  auth.uid() = challenger_id OR auth.uid() = recipient_id
);
CREATE POLICY "fc_insert_challenger"     ON public.friend_challenges FOR INSERT WITH CHECK (auth.uid() = challenger_id);
CREATE POLICY "fc_update_recipient"      ON public.friend_challenges FOR UPDATE USING (auth.uid() = recipient_id);

-- PROP LINES (public read)
CREATE POLICY "prop_lines_select_all"    ON public.prop_lines FOR SELECT USING (true);

-- SIDEBETS
CREATE POLICY "sidebets_select_own"      ON public.sidebets FOR SELECT USING (
  auth.uid() = creator_id OR auth.uid() = opponent_id
);
CREATE POLICY "sidebets_select_open"     ON public.sidebets FOR SELECT USING (
  status = 'open' AND is_open = true
);
CREATE POLICY "sidebets_insert_own"      ON public.sidebets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "sidebets_update_accept"   ON public.sidebets FOR UPDATE USING (
  status = 'open' AND auth.uid() != creator_id
);

-- SIDEBET MESSAGES
CREATE POLICY "sbm_select_participants"  ON public.sidebet_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sidebets sb
    WHERE sb.id = sidebet_id
      AND (sb.creator_id = auth.uid() OR sb.opponent_id = auth.uid())
  )
);
CREATE POLICY "sbm_insert_participants"  ON public.sidebet_messages FOR INSERT WITH CHECK (
  auth.uid() = user_id AND
  EXISTS (
    SELECT 1 FROM public.sidebets sb
    WHERE sb.id = sidebet_id
      AND (sb.creator_id = auth.uid() OR sb.opponent_id = auth.uid())
      AND sb.status IN ('accepted', 'live')
  )
);

-- ACHIEVEMENTS (public read)
CREATE POLICY "achievements_select_all"  ON public.achievements FOR SELECT USING (true);

-- USER ACHIEVEMENTS
CREATE POLICY "ua_select_all"            ON public.user_achievements FOR SELECT USING (true);

-- RESPONSIBLE GAMING
CREATE POLICY "rg_select_own"            ON public.responsible_gaming_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "rg_update_own"            ON public.responsible_gaming_settings FOR UPDATE USING (auth.uid() = user_id);

-- NOTIFICATIONS
CREATE POLICY "notifs_select_own"        ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_update_own"        ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- SEED DATA — Achievements
-- ============================================================
INSERT INTO public.achievements (key, name, description, category, rarity) VALUES
  ('first_win',          'First Blood',       'Win your first H2H matchup',                         'milestone',    'common'),
  ('first_sidebet_win',  'Side Hustle',        'Win your first sidebet',                             'milestone',    'common'),
  ('first_deposit',      'In the Game',        'Make your first deposit',                            'milestone',    'common'),
  ('hot_streak_3',       'On Fire',            'Win 3 matchups in a row',                            'streak',       'rare'),
  ('hot_streak_5',       'Unstoppable',        'Win 5 matchups in a row',                            'streak',       'epic'),
  ('hot_streak_10',      'Legend',             'Win 10 matchups in a row',                           'streak',       'legendary'),
  ('first_50_entry',     'High Roller',        'Enter a $50 matchup',                                'milestone',    'rare'),
  ('friend_challenge_win','Bragging Rights',   'Beat a friend in a challenge',                       'social',       'common'),
  ('price_hunter',       'Value Scout',        'Draft a player at or below base price',              'performance',  'common'),
  ('perfect_lineup',     'Perfect Draft',      'All 3 players score 40+ fantasy points in one game', 'performance',  'epic'),
  ('big_winner',         'Payday',             'Win $100+ in a single matchup',                      'milestone',    'rare'),
  ('sidebet_master',     'Prop God',           'Win 10 sidebets total',                              'milestone',    'epic'),
  ('social_butterfly',   'Connected',          'Add 5 friends',                                      'social',       'common'),
  ('comeback_kid',       'Comeback Kid',       'Win a matchup after trailing at halftime',           'performance',  'rare'),
  ('sharp_eye',          'Sharp',              'Win 3 sidebets on the same stat category in a row',  'performance',  'epic');
