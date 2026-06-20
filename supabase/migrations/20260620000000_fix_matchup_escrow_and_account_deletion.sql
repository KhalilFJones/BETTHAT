-- =============================================================================
-- AUDIT FIX: MATCHUP ESCROW MONEY-FLOW + ACCOUNT DELETION
-- =============================================================================
-- The open-wager "place order" flow was written as client-side direct inserts
-- into matchups/matchmaking_queue. That path:
--   • never escrowed the entry fee → users entered matchups for FREE, and
--   • settle_matchup release_escrow/consume_escrow then operated on unfunded
--     escrow → settlement could never succeed (matchups stuck, no payouts), and
--   • hit RLS walls (no queue INSERT policy; matchups DELETE blocked on cancel).
--
-- Fix: route place + cancel through SECURITY DEFINER RPCs that do the escrow
-- atomically (mirroring the original submit_lineup_and_match design, adapted to
-- the open-wager mechanic), expire stuck orders with escrow release, and close
-- the client RLS write-hole. Also adds the missing request_account_deletion RPC.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — PLACE ORDER (escrow + open-wager FIFO match), atomic
-- =============================================================================
CREATE OR REPLACE FUNCTION public.place_lineup_order(p_lineup_id UUID, p_max_wager NUMERIC)
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
  v_rake_pct  NUMERIC;
  v_slate     DATE;
  v_opp       RECORD;
  v_opp_max   NUMERIC;
  v_settled   NUMERIC;
  v_pot       NUMERIC;
  v_rake      NUMERIC;
  v_payout    NUMERIC;
  v_matchup_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.user_can_play(v_uid) THEN RAISE EXCEPTION 'not eligible to play'; END IF;

  -- Same compliance gates as the original submit RPC (H-18 / H-19).
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND terms_accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'terms must be accepted before play';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'email must be verified before play';
  END IF;

  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='salary_cap'), 500)        INTO v_cap;
  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='max_wager_floor'), 5)     INTO v_floor;
  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='max_wager_ceiling'), 50)  INTO v_ceiling;
  SELECT COALESCE((SELECT value::NUMERIC FROM app_config WHERE key='rake_percentage'), 3.5)   INTO v_rake_pct;

  IF p_max_wager IS NULL OR p_max_wager < v_floor OR p_max_wager > v_ceiling THEN
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

  -- No drafting a player whose game already started.
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

  -- Escrow the max wager up front (atomic; fails on insufficient balance).
  PERFORM public.move_to_escrow(v_uid, p_max_wager);

  UPDATE public.lineups
     SET status = 'submitted', max_wager = p_max_wager, submitted_at = NOW(), locked_at = NOW()
   WHERE id = p_lineup_id;

  -- FIFO match against the oldest open queue entry from another user.
  SELECT q.* INTO v_opp
    FROM public.matchmaking_queue q
   WHERE q.user_id <> v_uid
     AND q.expires_at > NOW()
     AND COALESCE(q.game_date, CURRENT_DATE) >= CURRENT_DATE
   ORDER BY q.queued_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_opp.id IS NOT NULL THEN
    v_opp_max := COALESCE(v_opp.max_wager, v_opp.entry_tier);
    v_settled := LEAST(p_max_wager, v_opp_max);

    -- Release each side's unused escrow above the settled amount.
    IF p_max_wager > v_settled THEN PERFORM public.release_escrow(v_uid, p_max_wager - v_settled); END IF;
    IF v_opp_max  > v_settled THEN PERFORM public.release_escrow(v_opp.user_id, v_opp_max - v_settled); END IF;

    v_pot    := v_settled * 2;
    v_rake   := ROUND(v_pot * (v_rake_pct / 100.0), 2);
    v_payout := v_pot - v_rake;

    UPDATE public.matchups
       SET lineup2_id      = p_lineup_id,
           user2_id        = v_uid,
           entry_tier      = v_settled,
           settled_wager   = v_settled,
           user2_max_wager = p_max_wager,
           pot_amount      = v_pot,
           rake_amount     = v_rake,
           payout_amount   = v_payout,
           status          = 'matched',
           matched_at      = NOW()
     WHERE lineup1_id = v_opp.lineup_id AND status = 'pending' AND user2_id IS NULL
    RETURNING id INTO v_matchup_id;

    IF v_matchup_id IS NULL THEN
      -- Opponent's pending order was taken between SELECT and UPDATE — abort so
      -- the whole transaction (incl. escrow) rolls back; the client retries.
      RAISE EXCEPTION 'matchmaking race — please retry';
    END IF;

    DELETE FROM public.matchmaking_queue WHERE id = v_opp.id;
    UPDATE public.lineups SET status = 'matched' WHERE id IN (v_opp.lineup_id, p_lineup_id);

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_opp.user_id, 'matchup_found', 'Match found', 'Your lineup is now live',
            jsonb_build_object('matchup_id', v_matchup_id));

    RETURN jsonb_build_object('matchup_id', v_matchup_id, 'matched', true, 'settled_wager', v_settled);
  ELSE
    -- No opponent yet: create a pending matchup + queue entry (escrow stays).
    INSERT INTO public.matchups
      (lineup1_id, user1_id, entry_tier, settled_wager, user1_max_wager,
       pot_amount, rake_amount, payout_amount, status, game_date)
    VALUES
      (p_lineup_id, v_uid, p_max_wager, NULL, p_max_wager,
       p_max_wager, 0, p_max_wager, 'pending', v_slate)
    RETURNING id INTO v_matchup_id;

    INSERT INTO public.matchmaking_queue (lineup_id, user_id, entry_tier, max_wager, game_date)
    VALUES (p_lineup_id, v_uid, p_max_wager, p_max_wager, v_slate);

    RETURN jsonb_build_object('matchup_id', v_matchup_id, 'matched', false);
  END IF;
END;
$$;


-- =============================================================================
-- SECTION 2 — CANCEL a pending order (release escrow)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_lineup_order(p_matchup_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_m   RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_m FROM public.matchups WHERE id = p_matchup_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'matchup not found'; END IF;
  IF v_m.user1_id <> v_uid THEN RAISE EXCEPTION 'not your order'; END IF;
  IF v_m.status <> 'pending' OR v_m.user2_id IS NOT NULL THEN
    RAISE EXCEPTION 'cannot cancel — order already matched';
  END IF;

  PERFORM public.release_escrow(v_uid, COALESCE(v_m.user1_max_wager, v_m.entry_tier));
  DELETE FROM public.matchmaking_queue WHERE lineup_id = v_m.lineup1_id;
  UPDATE public.matchups SET status = 'voided', completed_at = NOW() WHERE id = p_matchup_id;
  UPDATE public.lineups  SET status = 'building' WHERE id = v_m.lineup1_id;
END;
$$;


-- =============================================================================
-- SECTION 3 — EXPIRE stuck orders (escrow release) + reschedule cron
-- =============================================================================
-- Replaces the old cleanup-matchmaking-queue cron, which deleted expired queue
-- rows WITHOUT releasing the escrow (would have stranded user funds).
CREATE OR REPLACE FUNCTION public.expire_matchmaking_queue()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r     RECORD;
  v_n   INT := 0;
BEGIN
  FOR r IN
    SELECT m.id, m.user1_id, m.lineup1_id, COALESCE(m.user1_max_wager, m.entry_tier) AS amt
      FROM public.matchups m
      JOIN public.matchmaking_queue q ON q.lineup_id = m.lineup1_id
     WHERE m.status = 'pending' AND m.user2_id IS NULL AND q.expires_at <= NOW()
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN PERFORM public.release_escrow(r.user1_id, r.amt); EXCEPTION WHEN OTHERS THEN NULL; END;
    DELETE FROM public.matchmaking_queue WHERE lineup_id = r.lineup1_id;
    UPDATE public.matchups SET status = 'voided', completed_at = NOW() WHERE id = r.id;
    UPDATE public.lineups  SET status = 'building' WHERE id = r.lineup1_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

SELECT cron.unschedule('cleanup-matchmaking-queue')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-matchmaking-queue');
SELECT cron.unschedule('expire-matchmaking-queue')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='expire-matchmaking-queue');
SELECT cron.schedule('expire-matchmaking-queue', '*/10 * * * *',
  $$ SELECT public.expire_matchmaking_queue(); $$);


-- =============================================================================
-- SECTION 4 — CLOSE THE CLIENT WRITE-HOLE (all match writes go through the RPCs)
-- =============================================================================
DROP POLICY IF EXISTS matchups_insert_own ON public.matchups;
DROP POLICY IF EXISTS queue_delete_own    ON public.matchmaking_queue;


-- =============================================================================
-- SECTION 5 — ACCOUNT DELETION RPC (was called by the client but never existed)
-- =============================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_bal     NUMERIC;
  v_escrow  NUMERIC;
  v_pending NUMERIC;
  v_active  INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT balance, escrow_balance, pending_withdrawal INTO v_bal, v_escrow, v_pending
    FROM public.wallets WHERE user_id = v_uid;
  IF COALESCE(v_bal,0) > 0 OR COALESCE(v_escrow,0) > 0 OR COALESCE(v_pending,0) > 0 THEN
    RAISE EXCEPTION 'withdraw your remaining balance before deleting your account';
  END IF;

  SELECT COUNT(*) INTO v_active FROM public.matchups
   WHERE (user1_id = v_uid OR user2_id = v_uid)
     AND status IN ('pending','matched','live','scoring');
  IF v_active > 0 THEN
    RAISE EXCEPTION 'you have active matchups — wait for them to settle first';
  END IF;

  -- Soft delete: KYC/AML rules require retaining financial records, so flag the
  -- account for compliance-side processing rather than hard-deleting here.
  UPDATE public.profiles SET deletion_requested_at = NOW() WHERE id = v_uid;
END;
$$;


-- =============================================================================
-- SECTION 6 — GRANTS
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.expire_matchmaking_queue() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION
  public.place_lineup_order(UUID, NUMERIC),
  public.cancel_lineup_order(UUID),
  public.request_account_deletion()
TO authenticated;


-- =============================================================================
-- SECTION 7 — FIX BROKEN profiles_protect_cols TRIGGER
-- =============================================================================
-- lock_protected_profile_cols() copied five columns that live on WALLETS, not
-- profiles (stripe_customer_id, pending_withdrawal, lifetime_winnings,
-- last_deposit_at, last_withdrawal_at). On any authenticated profile UPDATE the
-- trigger raised `record "new" has no field "stripe_customer_id"` — silently
-- breaking onboarding (state/dob/pin) and every other user profile write.
-- Recreate it referencing only columns that exist on profiles.
CREATE OR REPLACE FUNCTION public.lock_protected_profile_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Money / leaderboard / compliance state — never settable by users.
  NEW.total_wins     := OLD.total_wins;
  NEW.total_losses   := OLD.total_losses;
  NEW.total_earnings := OLD.total_earnings;
  NEW.rank_tier      := OLD.rank_tier;
  NEW.is_banned      := OLD.is_banned;
  NEW.kyc_status     := OLD.kyc_status;
  NEW.referred_by    := OLD.referred_by;
  NEW.total_entries  := OLD.total_entries;

  -- State is locked after onboarding writes it once (C-9).
  IF OLD.state IS NOT NULL THEN NEW.state := OLD.state; END IF;

  -- Terms acceptance is append-only.
  IF OLD.terms_accepted_at IS NOT NULL THEN
    NEW.terms_accepted_at := OLD.terms_accepted_at;
    NEW.terms_version     := OLD.terms_version;
  END IF;

  RETURN NEW;
END;
$function$;


-- =============================================================================
-- SECTION 8 — ALLOW THE 'winnings' TRANSACTION TYPE
-- =============================================================================
-- settle_matchup credits the winner via credit_wallet(..., 'winnings', ...), but
-- 'winnings' was never in transactions_type_check — so EVERY winning settlement
-- failed with a check-constraint violation (payouts never landed). Add it.
-- (sidebet_* retained as historical-only per the sidebet-removal migration.)
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN (
  'deposit', 'withdrawal', 'entry_fee', 'payout', 'rake', 'escrow_hold',
  'escrow_release', 'refund', 'winnings', 'sidebet_wager', 'sidebet_payout'
));


-- =============================================================================
-- SECTION 9 — FIX settle_matchup: lifetime_winnings lives on WALLETS not profiles
-- =============================================================================
-- settle_matchup set profiles.lifetime_winnings, which doesn't exist on profiles
-- (it's a wallet column) → every winning settlement errored. Keep the profile
-- win/earnings stats; track lifetime_winnings on the wallet where it belongs.
CREATE OR REPLACE FUNCTION public.settle_matchup(p_matchup_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_m         RECORD;
  v_total1    NUMERIC;
  v_total2    NUMERIC;
  v_winner    UUID;
  v_winner_lineup UUID;
  v_all_final BOOLEAN;
BEGIN
  SELECT * INTO v_m FROM public.matchups WHERE id = p_matchup_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'matchup not found'; END IF;
  IF v_m.status IN ('completed','voided','tie') THEN RETURN 'already_settled'; END IF;
  IF v_m.status NOT IN ('matched','live') THEN RETURN 'not_ready'; END IF;
  IF v_m.user2_id IS NULL OR v_m.lineup2_id IS NULL THEN RETURN 'not_ready'; END IF;

  SELECT bool_and(pgs.is_final) INTO v_all_final
    FROM public.lineup_players lp
    JOIN public.player_game_stats pgs ON pgs.player_id = lp.player_id
   WHERE lp.lineup_id IN (v_m.lineup1_id, v_m.lineup2_id);
  IF v_all_final IS NOT TRUE THEN RETURN 'not_ready'; END IF;

  WITH totals AS (
    SELECT lp.lineup_id, SUM(pgs.fantasy_points) AS total
      FROM public.lineup_players lp
      JOIN public.player_game_stats pgs ON pgs.player_id = lp.player_id
     WHERE lp.lineup_id IN (v_m.lineup1_id, v_m.lineup2_id)
     GROUP BY lp.lineup_id
  )
  SELECT
    COALESCE((SELECT total FROM totals WHERE lineup_id = v_m.lineup1_id), 0),
    COALESCE((SELECT total FROM totals WHERE lineup_id = v_m.lineup2_id), 0)
  INTO v_total1, v_total2;

  UPDATE public.lineups SET fantasy_points_total = v_total1 WHERE id = v_m.lineup1_id;
  UPDATE public.lineups SET fantasy_points_total = v_total2 WHERE id = v_m.lineup2_id;

  IF v_total1 > v_total2 THEN
    v_winner := v_m.user1_id; v_winner_lineup := v_m.lineup1_id;
  ELSIF v_total2 > v_total1 THEN
    v_winner := v_m.user2_id; v_winner_lineup := v_m.lineup2_id;
  ELSE
    UPDATE public.matchups SET status='tie', completed_at=NOW() WHERE id = p_matchup_id;
    PERFORM public.release_escrow(v_m.user1_id, v_m.entry_tier);
    PERFORM public.release_escrow(v_m.user2_id, v_m.entry_tier);
    UPDATE public.lineups SET status='completed' WHERE id IN (v_m.lineup1_id, v_m.lineup2_id);
    RETURN 'settled';
  END IF;

  IF v_winner = v_m.user1_id THEN
    PERFORM public.release_escrow(v_m.user1_id, v_m.entry_tier);
    PERFORM public.consume_escrow(v_m.user2_id, v_m.entry_tier);
  ELSE
    PERFORM public.release_escrow(v_m.user2_id, v_m.entry_tier);
    PERFORM public.consume_escrow(v_m.user1_id, v_m.entry_tier);
  END IF;

  PERFORM public.credit_wallet(
    v_winner, v_m.payout_amount - v_m.entry_tier, 'winnings',
    p_matchup_id, 'matchup', 'Matchup payout');

  -- lifetime_winnings is a WALLET stat.
  UPDATE public.wallets
     SET lifetime_winnings = lifetime_winnings + (v_m.payout_amount - v_m.entry_tier)
   WHERE user_id = v_winner;

  UPDATE public.profiles
     SET total_wins = total_wins + 1,
         total_earnings = total_earnings + (v_m.payout_amount - v_m.entry_tier)
   WHERE id = v_winner;
  UPDATE public.profiles
     SET total_losses = total_losses + 1
   WHERE id = CASE WHEN v_winner = v_m.user1_id THEN v_m.user2_id ELSE v_m.user1_id END;

  UPDATE public.matchups
     SET status='completed', winner_user_id = v_winner,
         winner_lineup_id = v_winner_lineup, completed_at = NOW()
   WHERE id = p_matchup_id;
  UPDATE public.lineups SET status='completed' WHERE id IN (v_m.lineup1_id, v_m.lineup2_id);

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_winner, 'game_final', 'You won', 'Tap to view your matchup',
          jsonb_build_object('matchup_id', p_matchup_id)),
         (CASE WHEN v_winner = v_m.user1_id THEN v_m.user2_id ELSE v_m.user1_id END,
          'game_final', 'You lost', 'Better luck next time',
          jsonb_build_object('matchup_id', p_matchup_id));

  RETURN 'settled';
END;
$function$;
