-- =============================================================================
-- FRIEND CHALLENGES (real flow) + WAGER-CEILING CONFIG FIX
-- =============================================================================
-- Two bugs being closed here:
--
-- 1) max_wager_ceiling was left at $50 from the old fixed-tier days, but the
--    current Game Setup UI (app/matchup/create.tsx) offers a "$100 Bet" quick
--    preset and the Figma spec it was built from shows a $75 example wager —
--    both would be silently rejected by place_lineup_order's range check.
--    Bump the ceiling to match what the client actually offers.
--
-- 2) The `friend_challenges` table, its RLS, its notification type, its
--    'friend_challenge_win' achievement, and its hourly expiry cron have all
--    existed since the initial schema — but no RPC ever turned a challenge
--    into a real matchup. The client's "Challenge" button just routed into
--    generic matchmaking instead. This adds the missing atomic RPCs
--    (create/accept/decline/cancel), mirroring the escrow pattern already
--    proven in place_lineup_order / cancel_lineup_order / settle_matchup, and
--    fixes the expiry cron to release escrow (it was only ever flipping a
--    status column — with no escrow involved before now, that was harmless;
--    it would silently strand funds the moment challenges started escrowing).
-- =============================================================================

UPDATE public.app_config SET value = '100' WHERE key = 'max_wager_ceiling';


-- =============================================================================
-- SECTION 1 — CREATE a friend challenge (challenger escrows immediately)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_friend_challenge(
  p_recipient_id UUID,
  p_lineup_id    UUID,
  p_entry_tier   NUMERIC,
  p_message      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_lineup    RECORD;
  v_count     INT;
  v_total     NUMERIC;
  v_cap       NUMERIC;
  v_floor     NUMERIC;
  v_ceiling   NUMERIC;
  v_slate     DATE;
  v_challenge_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_recipient_id = v_uid THEN RAISE EXCEPTION 'cannot challenge yourself'; END IF;
  IF NOT public.user_can_play(v_uid) THEN RAISE EXCEPTION 'not eligible to play'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND terms_accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'terms must be accepted before play';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'email must be verified before play';
  END IF;

  -- Challenges are a friends-only feature (matches the naming and the client
  -- gate on app/user/[id].tsx — only friends see the Challenge button).
  IF NOT EXISTS (
    SELECT 1 FROM public.friends
     WHERE status = 'accepted'
       AND ( (requester_id = v_uid AND recipient_id = p_recipient_id)
          OR (requester_id = p_recipient_id AND recipient_id = v_uid) )
  ) THEN
    RAISE EXCEPTION 'you can only challenge friends';
  END IF;

  -- No duplicate pending challenge to the same recipient.
  IF EXISTS (
    SELECT 1 FROM public.friend_challenges
     WHERE challenger_id = v_uid AND recipient_id = p_recipient_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'you already have a pending challenge with this player';
  END IF;

  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='salary_cap'), 500)        INTO v_cap;
  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='max_wager_floor'), 5)     INTO v_floor;
  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='max_wager_ceiling'), 100) INTO v_ceiling;

  IF p_entry_tier IS NULL OR p_entry_tier < v_floor OR p_entry_tier > v_ceiling THEN
    RAISE EXCEPTION 'wager must be between $% and $%', v_floor, v_ceiling;
  END IF;

  SELECT * INTO v_lineup FROM public.lineups WHERE id = p_lineup_id AND user_id = v_uid FOR UPDATE;
  IF v_lineup.id IS NULL THEN RAISE EXCEPTION 'lineup not found'; END IF;
  IF v_lineup.status <> 'building' THEN RAISE EXCEPTION 'lineup already submitted'; END IF;

  SELECT COUNT(*), COALESCE(SUM(frozen_price), 0) INTO v_count, v_total
    FROM public.lineup_players WHERE lineup_id = p_lineup_id;
  IF v_count <> 3 THEN RAISE EXCEPTION 'lineup must contain exactly 3 players'; END IF;
  IF v_total > v_cap THEN RAISE EXCEPTION 'lineup total $% exceeds the $% cap', v_total, v_cap; END IF;

  v_slate := COALESCE(v_lineup.game_date, CURRENT_DATE);

  IF EXISTS (
    SELECT 1 FROM public.lineup_players lp
      JOIN public.player_game_availability pga ON pga.player_id = lp.player_id
      JOIN public.nba_games g ON g.id = pga.game_id
     WHERE lp.lineup_id = p_lineup_id AND g.game_date = v_slate
       AND ( g.status IN ('pregame','live','halftime','final')
             OR (g.tip_off_time IS NOT NULL AND g.tip_off_time <= NOW()) )
  ) THEN
    RAISE EXCEPTION 'a player''s game has already started';
  END IF;

  -- Escrow up front so a challenger can't stack more challenges than they can
  -- cover, and so acceptance is a pure "does the recipient also have it" check.
  PERFORM public.move_to_escrow(v_uid, p_entry_tier);

  UPDATE public.lineups
     SET status = 'submitted', max_wager = p_entry_tier, submitted_at = NOW(), locked_at = NOW(),
         is_friend_challenge = TRUE
   WHERE id = p_lineup_id;

  INSERT INTO public.friend_challenges
    (challenger_id, recipient_id, challenger_lineup_id, entry_tier, message, status)
  VALUES
    (v_uid, p_recipient_id, p_lineup_id, p_entry_tier, p_message, 'pending')
  RETURNING id INTO v_challenge_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT p_recipient_id, 'friend_challenge',
         COALESCE(p.display_name, p.username, 'A friend') || ' challenged you',
         '$' || p_entry_tier::TEXT || ' lineup challenge — respond within 24 hours.',
         jsonb_build_object('challenge_id', v_challenge_id, 'event', 'received')
    FROM public.profiles p WHERE p.id = v_uid;

  RETURN jsonb_build_object('challenge_id', v_challenge_id);
END;
$$;


-- =============================================================================
-- SECTION 2 — ACCEPT a friend challenge (recipient escrows, matchup created)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.accept_friend_challenge(
  p_challenge_id UUID,
  p_lineup_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_c         RECORD;
  v_lineup    RECORD;
  v_count     INT;
  v_total     NUMERIC;
  v_cap       NUMERIC;
  v_slate     DATE;
  v_rake_pct  NUMERIC;
  v_pot       NUMERIC;
  v_rake      NUMERIC;
  v_payout    NUMERIC;
  v_matchup_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.user_can_play(v_uid) THEN RAISE EXCEPTION 'not eligible to play'; END IF;

  SELECT * INTO v_c FROM public.friend_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'challenge not found'; END IF;
  IF v_c.recipient_id <> v_uid THEN RAISE EXCEPTION 'not your challenge to accept'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'challenge is no longer pending'; END IF;
  IF v_c.expires_at <= NOW() THEN RAISE EXCEPTION 'challenge has expired'; END IF;

  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='salary_cap'), 500) INTO v_cap;

  SELECT * INTO v_lineup FROM public.lineups WHERE id = p_lineup_id AND user_id = v_uid FOR UPDATE;
  IF v_lineup.id IS NULL THEN RAISE EXCEPTION 'lineup not found'; END IF;
  IF v_lineup.status <> 'building' THEN RAISE EXCEPTION 'lineup already submitted'; END IF;

  SELECT COUNT(*), COALESCE(SUM(frozen_price), 0) INTO v_count, v_total
    FROM public.lineup_players WHERE lineup_id = p_lineup_id;
  IF v_count <> 3 THEN RAISE EXCEPTION 'lineup must contain exactly 3 players'; END IF;
  IF v_total > v_cap THEN RAISE EXCEPTION 'lineup total $% exceeds the $% cap', v_total, v_cap; END IF;

  v_slate := COALESCE(v_lineup.game_date, CURRENT_DATE);

  IF EXISTS (
    SELECT 1 FROM public.lineup_players lp
      JOIN public.player_game_availability pga ON pga.player_id = lp.player_id
      JOIN public.nba_games g ON g.id = pga.game_id
     WHERE lp.lineup_id = p_lineup_id AND g.game_date = v_slate
       AND ( g.status IN ('pregame','live','halftime','final')
             OR (g.tip_off_time IS NOT NULL AND g.tip_off_time <= NOW()) )
  ) THEN
    RAISE EXCEPTION 'a player''s game has already started';
  END IF;

  -- Recipient escrows the same fixed stake the challenger already committed.
  PERFORM public.move_to_escrow(v_uid, v_c.entry_tier);

  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='rake_percentage'), 3.5) INTO v_rake_pct;
  v_pot    := v_c.entry_tier * 2;
  v_rake   := ROUND(v_pot * (v_rake_pct / 100.0), 2);
  v_payout := v_pot - v_rake;

  INSERT INTO public.matchups
    (lineup1_id, lineup2_id, user1_id, user2_id, entry_tier, settled_wager,
     user1_max_wager, user2_max_wager, pot_amount, rake_amount, payout_amount,
     status, is_friend_challenge, game_date, matched_at)
  VALUES
    (v_c.challenger_lineup_id, p_lineup_id, v_c.challenger_id, v_uid, v_c.entry_tier, v_c.entry_tier,
     v_c.entry_tier, v_c.entry_tier, v_pot, v_rake, v_payout,
     'matched', TRUE, v_slate, NOW())
  RETURNING id INTO v_matchup_id;

  UPDATE public.lineups
     SET status = 'matched', is_friend_challenge = TRUE
   WHERE id IN (v_c.challenger_lineup_id, p_lineup_id);

  UPDATE public.friend_challenges
     SET status = 'accepted', matchup_id = v_matchup_id
   WHERE id = p_challenge_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT v_c.challenger_id, 'friend_challenge',
         COALESCE(p.display_name, p.username, 'Your friend') || ' accepted your challenge',
         'Your $' || v_c.entry_tier::TEXT || ' matchup is now live.',
         jsonb_build_object('matchup_id', v_matchup_id, 'event', 'accepted')
    FROM public.profiles p WHERE p.id = v_uid;

  RETURN jsonb_build_object('matchup_id', v_matchup_id);
END;
$$;


-- =============================================================================
-- SECTION 3 — DECLINE a friend challenge (challenger's escrow released)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.decline_friend_challenge(p_challenge_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_c   RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_c FROM public.friend_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'challenge not found'; END IF;
  IF v_c.recipient_id <> v_uid THEN RAISE EXCEPTION 'not your challenge to decline'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'challenge is no longer pending'; END IF;

  PERFORM public.release_escrow(v_c.challenger_id, v_c.entry_tier);
  UPDATE public.lineups SET status = 'building' WHERE id = v_c.challenger_lineup_id;
  UPDATE public.friend_challenges SET status = 'declined' WHERE id = p_challenge_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT v_c.challenger_id, 'friend_challenge',
         COALESCE(p.display_name, p.username, 'Your friend') || ' declined your challenge',
         'Your $' || v_c.entry_tier::TEXT || ' wager was refunded.',
         jsonb_build_object('challenge_id', p_challenge_id, 'event', 'declined')
    FROM public.profiles p WHERE p.id = v_uid;
END;
$$;


-- =============================================================================
-- SECTION 4 — CANCEL a friend challenge you sent (before the recipient acts)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_friend_challenge(p_challenge_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_c   RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_c FROM public.friend_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'challenge not found'; END IF;
  IF v_c.challenger_id <> v_uid THEN RAISE EXCEPTION 'not your challenge to cancel'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'challenge is no longer pending'; END IF;

  PERFORM public.release_escrow(v_c.challenger_id, v_c.entry_tier);
  UPDATE public.lineups SET status = 'building' WHERE id = v_c.challenger_lineup_id;
  UPDATE public.friend_challenges SET status = 'cancelled' WHERE id = p_challenge_id;
END;
$$;


-- =============================================================================
-- SECTION 5 — FIX THE EXPIRY CRON (release escrow, matching expire_matchmaking_queue)
-- =============================================================================
-- Previously an inline `UPDATE ... SET status='expired'` with no escrow
-- involvement (harmless when challenges didn't escrow). Now that acceptance
-- escrows real money up front, a lapsed challenge must release the
-- challenger's stake and unlock their lineup, exactly like a cancel.
CREATE OR REPLACE FUNCTION public.expire_friend_challenges()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r   RECORD;
  v_n INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.friend_challenges
     WHERE status = 'pending' AND expires_at < NOW()
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN PERFORM public.release_escrow(r.challenger_id, r.entry_tier); EXCEPTION WHEN OTHERS THEN NULL; END;
    UPDATE public.lineups SET status = 'building' WHERE id = r.challenger_lineup_id;
    UPDATE public.friend_challenges SET status = 'expired' WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

SELECT cron.unschedule('expire-friend-challenges')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-friend-challenges');
SELECT cron.schedule('expire-friend-challenges', '0 * * * *',
  $$ SELECT public.expire_friend_challenges(); $$);


-- =============================================================================
-- SECTION 6 — INDEXES for the client's incoming/outgoing challenge lists
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_friend_challenges_recipient_status
  ON public.friend_challenges(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_challenges_challenger_status
  ON public.friend_challenges(challenger_id, status);
