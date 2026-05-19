-- =============================================================================
-- BETTHAT MIGRATION 8: HOLY GRAIL V2 ALIGNMENT
-- =============================================================================
-- Aligns the schema with the BETTHAT Holy Grail V2 spec:
--   1. Open-input max wager mechanic ($5-$50, no buckets)
--   2. Ticker handle on nba_players (LEBJM23 convention)
--   3. matchup_activity_events for Live Game Board feed (Screen 07)
--   4. Sidebet engagement: like/dislike counts + reactions table (Screen 09)
--   5. PIN hash on profiles for fast app re-entry (Screen 02)
--   6. min_entry config aligned to floor of $5
-- =============================================================================


-- =============================================================================
-- SECTION 1 — OPEN-INPUT WAGER (drop tier-bucket constraints)
-- =============================================================================

ALTER TABLE public.lineups
  DROP CONSTRAINT IF EXISTS lineups_entry_tier_check;

ALTER TABLE public.entry_tier_caps
  DROP CONSTRAINT IF EXISTS entry_tier_caps_entry_tier_check;

ALTER TABLE public.lineups
  ADD COLUMN IF NOT EXISTS max_wager NUMERIC,
  ADD CONSTRAINT lineups_max_wager_check
    CHECK (max_wager IS NULL OR (max_wager >= 5 AND max_wager <= 50));

ALTER TABLE public.matchmaking_queue
  ADD COLUMN IF NOT EXISTS max_wager NUMERIC,
  ADD CONSTRAINT matchmaking_queue_max_wager_check
    CHECK (max_wager IS NULL OR (max_wager >= 5 AND max_wager <= 50));

ALTER TABLE public.matchups
  ADD COLUMN IF NOT EXISTS user1_max_wager NUMERIC,
  ADD COLUMN IF NOT EXISTS user2_max_wager NUMERIC,
  ADD COLUMN IF NOT EXISTS settled_wager NUMERIC;

COMMENT ON COLUMN public.lineups.max_wager IS
  'User-declared bid ceiling, $5-$50. Open input per Holy Grail V2 mechanic.';
COMMENT ON COLUMN public.matchups.settled_wager IS
  'Final matched amount = LEAST(user1_max_wager, user2_max_wager). The amount each user actually puts in.';


-- =============================================================================
-- SECTION 2 — TICKER HANDLES (LEBJM23 convention)
-- =============================================================================

ALTER TABLE public.nba_players
  ADD COLUMN IF NOT EXISTS ticker_handle TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS nba_players_ticker_handle_idx
  ON public.nba_players (ticker_handle)
  WHERE ticker_handle IS NOT NULL;

COMMENT ON COLUMN public.nba_players.ticker_handle IS
  'Stock-ticker style identifier per Holy Grail (e.g., LEBJM23 = LeBron James #23). Convention: 4 letters of last name + 1 letter first name + jersey #.';


-- =============================================================================
-- SECTION 3 — MATCHUP ACTIVITY FEED (Screen 07 Live Game Board)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.matchup_activity_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matchup_id      UUID NOT NULL REFERENCES public.matchups(id) ON DELETE CASCADE,
  lineup_id       UUID REFERENCES public.lineups(id) ON DELETE SET NULL,
  player_id       UUID REFERENCES public.nba_players(id) ON DELETE SET NULL,
  game_id         UUID REFERENCES public.nba_games(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'made_3','made_2','made_ft','assist','rebound','steal','block',
                    'turnover','dunk','foul','dnp','game_start','game_quarter','game_end',
                    'sub_out','sub_in','milestone','custom'
                  )),
  description     TEXT NOT NULL,
  fpts_delta      NUMERIC NOT NULL DEFAULT 0,
  game_period     INTEGER,
  game_clock      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS matchup_activity_events_matchup_idx
  ON public.matchup_activity_events (matchup_id, created_at DESC);

ALTER TABLE public.matchup_activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_select_participants" ON public.matchup_activity_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matchups m
       WHERE m.id = matchup_activity_events.matchup_id
         AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
    )
  );

COMMENT ON TABLE public.matchup_activity_events IS
  'Reverse-chronological event stream for Screen 07 Live Game Board activity feed. One row per stat tick (made_3, assist, etc.) with fpts_delta and human-readable description.';


-- =============================================================================
-- SECTION 4 — SIDEBET ENGAGEMENT (Screen 09)
-- =============================================================================

ALTER TABLE public.sidebets
  ADD COLUMN IF NOT EXISTS like_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dislike_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sidebet_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sidebet_id  UUID NOT NULL REFERENCES public.sidebets(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL CHECK (reaction IN ('like','dislike')),
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (sidebet_id, user_id)
);

CREATE INDEX IF NOT EXISTS sidebet_reactions_sidebet_idx
  ON public.sidebet_reactions (sidebet_id);

ALTER TABLE public.sidebet_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select_all" ON public.sidebet_reactions
  FOR SELECT USING (true);
CREATE POLICY "reactions_write_own" ON public.sidebet_reactions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- SECTION 5 — PIN STORAGE (Screen 02 Auth flow)
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

COMMENT ON COLUMN public.profiles.pin_hash IS
  'bcrypt hash of 4-digit PIN for fast app re-entry per Holy Grail Screen 02. Set during onboarding.';


-- =============================================================================
-- SECTION 6 — APP CONFIG ALIGNMENT
-- =============================================================================

UPDATE public.app_config
   SET value = '5.00', updated_at = NOW()
 WHERE key = 'min_entry';

INSERT INTO public.app_config (key, value, description, is_secret) VALUES
  ('lineup_size', '3', 'Number of players per lineup (Holy Grail V2: fixed at 3)', false),
  ('salary_cap', '500', 'Universal salary cap regardless of wager tier (Holy Grail V2)', false),
  ('max_wager_floor', '5', 'Holy Grail V2: minimum max_wager input', false),
  ('max_wager_ceiling', '50', 'Holy Grail V2: maximum max_wager input', false),
  ('match_price_proximity_initial', '5', 'Initial $ proximity radius for matchmaking; widens over queue time', false),
  ('match_min_lineup_divergence', '2', 'Opponent must differ by at least this many players (≤1 shared)', false)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();


-- =============================================================================
-- END
-- =============================================================================
