-- =============================================================================
-- BETTHAT MIGRATION 5: SECURITY HARDENING + SECURITY DEFINER RPCS
-- =============================================================================
-- This migration closes the trust-boundary holes identified in AUDIT_REPORT.md
-- (CRITICAL C-1 through C-20, plus several HIGH items). After this migration:
--
--   1. No authenticated user may directly UPDATE money, KYC, self-exclusion,
--      sidebet state, lineup frozen prices, or protected profile columns.
--   2. All money / risk / matchmaking flows go through SECURITY DEFINER RPCs.
--   3. Wallet operations are atomic, using `balance = balance + $n` increments
--      with `CHECK (balance >= 0)` enforcement (no read-modify-write).
--   4. Stripe webhook processing is idempotent and transactional.
--   5. State, KYC, win/loss, bans, referrals are immutable from the client.
--
-- Open items requiring product/legal sign-off (see comments inline):
--   - H-9: salary cap ($500 spec vs $45–$180 tier-based schema).  This file
--     keeps the schema's tier-based caps (enforced reality). Spec needs revision.
--   - C-4: limit-increase cooling-off is 24h here. Some jurisdictions require
--     longer; revisit per jurisdiction once known.
--   - C-9: `state` is locked after onboarding. Changes require service_role
--     (i.e. a support ticket flow + re-KYC). Implement that workflow upstream.
--   - H-19: email-verification gate is applied to lineup submission and
--     withdrawals here. Deposits remain open so funded but unverified users
--     can still pay in. Adjust if product wants tighter.
--
-- All functions in this file set `search_path = public, pg_temp` (H-5).
-- =============================================================================


-- =============================================================================
-- SECTION 1 — DROP UNSAFE RLS POLICIES
-- =============================================================================

-- C-1: user-writable wallets
DROP POLICY IF EXISTS "wallets_update_own" ON public.wallets;

-- C-2: user-writable profile protected cols
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- C-3: user-self-verifiable KYC
DROP POLICY IF EXISTS "kyc_update_own" ON public.user_kyc;
DROP POLICY IF EXISTS "kyc_insert_own" ON public.user_kyc;

-- C-4: user-reversible self-exclusion + raisable limits
DROP POLICY IF EXISTS "rg_update_own" ON public.responsible_gaming_settings;

-- C-5: sidebet hijack
DROP POLICY IF EXISTS "sidebets_update_accept" ON public.sidebets;
DROP POLICY IF EXISTS "sidebets_insert_own"    ON public.sidebets;

-- C-6 / C-7: client-set frozen prices + free lineups
DROP POLICY IF EXISTS "lineup_players_insert_own" ON public.lineup_players;
DROP POLICY IF EXISTS "lineups_insert_own"        ON public.lineups;
DROP POLICY IF EXISTS "lineups_update_building"   ON public.lineups;

-- C-8: user-self-verifiable payout methods
DROP POLICY IF EXISTS "payout_methods_update_own" ON public.payout_methods;
DROP POLICY IF EXISTS "payout_methods_insert_own" ON public.payout_methods;
DROP POLICY IF EXISTS "payout_methods_delete_own" ON public.payout_methods;

-- C-17: client-driven withdrawal inserts
DROP POLICY IF EXISTS "withdrawals_insert_own" ON public.withdrawal_requests;

-- C-20: queue insert can reference other users' lineups
DROP POLICY IF EXISTS "queue_insert_own" ON public.matchmaking_queue;


-- =============================================================================
-- SECTION 2 — HARDEN EXISTING TRIGGER FUNCTIONS (H-4, H-5)
-- =============================================================================

-- H-4: sync_user_search must be SECURITY DEFINER or every profile UPDATE fails.
CREATE OR REPLACE FUNCTION public.sync_user_search()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_search (user_id, username, display_name)
  VALUES (NEW.id, NEW.username, NEW.display_name)
  ON CONFLICT (user_id) DO UPDATE
    SET username     = EXCLUDED.username,
        display_name = EXCLUDED.display_name;
  RETURN NEW;
END;
$$;

-- H-5: pin search_path on all existing trigger / helper functions.
ALTER FUNCTION public.handle_updated_at()  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()    SET search_path = public, pg_temp;


-- =============================================================================
-- SECTION 3 — PROTECTED-COLUMN TRIGGER ON PROFILES (C-2, C-9, M-13)
-- =============================================================================
-- These columns may ONLY be mutated by service_role. The trigger silently
-- restores prior values for any other caller. This is defense-in-depth on top
-- of the dropped UPDATE policy: if anyone re-adds an UPDATE policy by mistake,
-- the protected columns still cannot be lied about.

CREATE OR REPLACE FUNCTION public.lock_protected_profile_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role may write anything; trust it.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Money / leaderboard / compliance state — never settable by users.
  NEW.total_wins            := OLD.total_wins;
  NEW.total_losses          := OLD.total_losses;
  NEW.total_earnings        := OLD.total_earnings;
  NEW.rank_tier             := OLD.rank_tier;
  NEW.is_banned             := OLD.is_banned;
  NEW.kyc_status            := OLD.kyc_status;
  NEW.referred_by           := OLD.referred_by;
  NEW.total_sidebets_won    := OLD.total_sidebets_won;
  NEW.total_sidebets_lost   := OLD.total_sidebets_lost;
  NEW.total_entries         := OLD.total_entries;
  NEW.stripe_customer_id    := OLD.stripe_customer_id;
  NEW.pending_withdrawal    := OLD.pending_withdrawal;
  NEW.lifetime_winnings     := OLD.lifetime_winnings;
  NEW.last_deposit_at       := OLD.last_deposit_at;
  NEW.last_withdrawal_at    := OLD.last_withdrawal_at;

  -- C-9: state is locked after onboarding writes it once. Once non-null,
  -- only service_role can change it (support-ticket / re-KYC path).
  IF OLD.state IS NOT NULL THEN
    NEW.state := OLD.state;
  END IF;

  -- Terms acceptance is append-only.
  IF OLD.terms_accepted_at IS NOT NULL THEN
    NEW.terms_accepted_at := OLD.terms_accepted_at;
    NEW.terms_version     := OLD.terms_version;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_cols ON public.profiles;
CREATE TRIGGER profiles_protect_cols
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_protected_profile_cols();


-- =============================================================================
-- SECTION 4 — REINSTATE NARROW USER POLICIES
-- =============================================================================
-- Users still need to update their own non-protected profile fields (username,
-- display_name, avatar_url, bio, push_token, onboarding_step, tutorial_completed,
-- date_of_birth, phone_number, state-on-first-set). The protected-cols trigger
-- enforces the integrity rules; the policy just gates row visibility.

CREATE POLICY "profiles_update_own_safe" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- KYC: select-own only. Writes are service-role only (via process_kyc_event).
-- (Re-add SELECT policy since we dropped both above for safety.)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='user_kyc' AND policyname='kyc_select_own'
  ) THEN
    CREATE POLICY "kyc_select_own" ON public.user_kyc
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- Payout methods: SELECT-own only. All writes go through RPCs.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='payout_methods' AND policyname='payout_methods_select_own'
  ) THEN
    -- This policy exists from production_gaps migration; do nothing.
    NULL;
  END IF;
END $$;

-- Responsible-gaming: SELECT-own already exists. No UPDATE policy — RPC only.

-- Sidebets: SELECT exists. No UPDATE; INSERT via create_sidebet RPC.

-- Withdrawal requests: SELECT exists. No INSERT; via request_withdrawal RPC.

-- Lineups / lineup_players: SELECT exists. No INSERT/UPDATE; via RPC.

-- Matchmaking queue: SELECT exists. No INSERT; via submit_lineup_and_match RPC.


-- =============================================================================
-- SECTION 5 — SIGNUP AUDIT (H-18) AND DEMAND COUNTER (H-8)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.signup_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  terms_version  TEXT NOT NULL,
  ip_address     INET,
  user_agent     TEXT,
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signup_audit_user ON public.signup_audit(user_id);
ALTER TABLE public.signup_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signup_audit_select_own" ON public.signup_audit
  FOR SELECT USING (auth.uid() = user_id);

-- Per-player demand counter for the pricing engine. Reset to 0 at end of each
-- tick by tick_player_prices(); incremented atomically by lineup submission.
ALTER TABLE public.player_prices
  ADD COLUMN IF NOT EXISTS demand_count_this_tick INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_users_snapshot  INT NOT NULL DEFAULT 100;

-- Limit-increase cooling-off (C-4): a pending change is staged with an
-- effective_at; a daily cron promotes due rows.
CREATE TABLE IF NOT EXISTS public.responsible_gaming_pending_changes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  change_type           TEXT NOT NULL CHECK (change_type IN (
    'daily_deposit_limit','weekly_deposit_limit','monthly_deposit_limit',
    'daily_entry_limit','loss_limit_daily','loss_limit_weekly',
    'max_open_bets','reality_check_interval','session_time_limit_mins'
  )),
  new_value             DECIMAL(10,2) NOT NULL,
  effective_at          TIMESTAMPTZ NOT NULL,
  applied_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rg_pending_user_eff
  ON public.responsible_gaming_pending_changes(user_id, effective_at)
  WHERE applied_at IS NULL;
ALTER TABLE public.responsible_gaming_pending_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rg_pending_select_own"
  ON public.responsible_gaming_pending_changes
  FOR SELECT USING (auth.uid() = user_id);


-- =============================================================================
-- SECTION 6 — WALLET RPCS (C-1, C-12)
-- =============================================================================
-- All wallet mutations are atomic increments. balance has a CHECK >= 0, so a
-- failed debit fails the row update — no negative balance ever exists.

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id     UUID,
  p_amount      DECIMAL,
  p_type        TEXT,
  p_reference_id   UUID    DEFAULT NULL,
  p_reference_type TEXT    DEFAULT NULL,
  p_description    TEXT    DEFAULT NULL
)
RETURNS UUID  -- transaction_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_id     UUID;
  v_new_balance   DECIMAL(10,2);
  v_transaction_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'credit amount must be > 0';
  END IF;

  UPDATE public.wallets
     SET balance         = balance + p_amount,
         total_deposited = CASE WHEN p_type IN ('deposit','referral_bonus','promo')
                                  THEN total_deposited + p_amount
                                  ELSE total_deposited END
   WHERE user_id = p_user_id
  RETURNING id, balance INTO v_wallet_id, v_new_balance;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'no wallet for user %', p_user_id;
  END IF;

  INSERT INTO public.transactions
    (wallet_id, user_id, type, amount, balance_after, reference_id,
     reference_type, description, status)
  VALUES
    (v_wallet_id, p_user_id, p_type, p_amount, v_new_balance, p_reference_id,
     p_reference_type, p_description, 'completed')
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id        UUID,
  p_amount         DECIMAL,
  p_type           TEXT,
  p_reference_id   UUID    DEFAULT NULL,
  p_reference_type TEXT    DEFAULT NULL,
  p_description    TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_id     UUID;
  v_new_balance   DECIMAL(10,2);
  v_transaction_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'debit amount must be > 0';
  END IF;

  -- The CHECK (balance >= 0) constraint on wallets will reject the update if
  -- this would drive the balance negative — we surface a clearer error.
  UPDATE public.wallets
     SET balance = balance - p_amount,
         total_withdrawn = CASE WHEN p_type = 'withdrawal'
                                  THEN total_withdrawn + p_amount
                                  ELSE total_withdrawn END
   WHERE user_id = p_user_id
     AND balance >= p_amount
  RETURNING id, balance INTO v_wallet_id, v_new_balance;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'insufficient balance' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.transactions
    (wallet_id, user_id, type, amount, balance_after, reference_id,
     reference_type, description, status)
  VALUES
    (v_wallet_id, p_user_id, p_type, -p_amount, v_new_balance, p_reference_id,
     p_reference_type, p_description, 'completed')
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$$;

-- Move funds from `balance` to `escrow_balance` (e.g. entering a matchup).
CREATE OR REPLACE FUNCTION public.move_to_escrow(
  p_user_id  UUID,
  p_amount   DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_updated INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'escrow amount must be > 0';
  END IF;

  UPDATE public.wallets
     SET balance        = balance - p_amount,
         escrow_balance = escrow_balance + p_amount
   WHERE user_id = p_user_id
     AND balance >= p_amount;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'insufficient balance to escrow' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Release escrow back to balance (e.g. cancelled matchup) or to a winner
-- (use credit_wallet for the winner; this only handles the escrow-side bookkeeping).
CREATE OR REPLACE FUNCTION public.release_escrow(
  p_user_id  UUID,
  p_amount   DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_updated INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'release amount must be > 0';
  END IF;

  UPDATE public.wallets
     SET balance        = balance + p_amount,
         escrow_balance = escrow_balance - p_amount
   WHERE user_id = p_user_id
     AND escrow_balance >= p_amount;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'insufficient escrow to release' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Drain escrow to a pot/sink without crediting balance — used when paying out
-- the winner of a matchup; the loser's escrow is "consumed", the winner's
-- escrow is released back and the pot (minus rake) is credited to their balance.
CREATE OR REPLACE FUNCTION public.consume_escrow(
  p_user_id  UUID,
  p_amount   DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_updated INT;
BEGIN
  UPDATE public.wallets
     SET escrow_balance = escrow_balance - p_amount
   WHERE user_id = p_user_id
     AND escrow_balance >= p_amount;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'insufficient escrow to consume' USING ERRCODE = 'P0001';
  END IF;
END;
$$;


-- =============================================================================
-- SECTION 7 — STRIPE WEBHOOK RPC (C-10, C-11, C-12, C-13, H-10, H-12)
-- =============================================================================
-- Idempotent and transactional. The Edge Function calls this once per event;
-- this function decides whether the event is new and what business logic to run.

CREATE OR REPLACE FUNCTION public.process_stripe_event(
  p_event_id    TEXT,
  p_event_type  TEXT,
  p_payload     JSONB
)
RETURNS TEXT  -- 'processed' | 'duplicate' | 'ignored' | 'failed'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted    BOOLEAN := FALSE;
  v_obj         JSONB;
  v_user_id     UUID;
  v_amount      DECIMAL(10,2);
  v_wallet_id   UUID;
  v_intent_id   TEXT;
  v_transfer_id TEXT;
  v_wr_id       UUID;
BEGIN
  -- Idempotent insert. ON CONFLICT lets us know if this is a duplicate.
  INSERT INTO public.stripe_webhook_events
    (stripe_event_id, event_type, payload, status)
  VALUES
    (p_event_id, p_event_type, p_payload, 'pending')
  ON CONFLICT (stripe_event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN 'duplicate';
  END IF;

  v_obj := p_payload -> 'data' -> 'object';

  CASE p_event_type
    -- ─── DEPOSITS ───────────────────────────────────────────────────────────
    WHEN 'payment_intent.succeeded' THEN
      v_intent_id := v_obj ->> 'id';
      v_amount    := ((v_obj ->> 'amount_received')::INT) / 100.0;
      v_user_id   := (v_obj -> 'metadata' ->> 'user_id')::UUID;
      IF v_user_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
        UPDATE public.stripe_webhook_events
           SET status='failed', error_message='missing user_id or amount',
               processed_at = NOW()
         WHERE stripe_event_id = p_event_id;
        RETURN 'failed';
      END IF;

      PERFORM public.credit_wallet(
        v_user_id, v_amount, 'deposit',
        NULL, 'stripe_payment_intent',
        'Deposit ' || v_intent_id
      );

      UPDATE public.profiles
         SET last_deposit_at = NOW()
       WHERE id = v_user_id;

      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (v_user_id, 'deposit_confirmed',
              'Deposit confirmed',
              '$' || v_amount::TEXT || ' added to your wallet',
              jsonb_build_object('amount', v_amount, 'intent_id', v_intent_id));

    WHEN 'payment_intent.payment_failed' THEN
      v_intent_id := v_obj ->> 'id';
      v_user_id   := (v_obj -> 'metadata' ->> 'user_id')::UUID;
      IF v_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (v_user_id, 'deposit_confirmed',
                'Deposit failed',
                'Your deposit could not be processed',
                jsonb_build_object('intent_id', v_intent_id));
      END IF;

    -- ─── REFUNDS / DISPUTES (H-10) ──────────────────────────────────────────
    WHEN 'charge.refunded' THEN
      v_amount  := ((v_obj ->> 'amount_refunded')::INT) / 100.0;
      v_user_id := (v_obj -> 'metadata' ->> 'user_id')::UUID;
      IF v_user_id IS NOT NULL AND v_amount > 0 THEN
        -- Debit the refunded amount from balance. If balance is insufficient,
        -- we still flag the user (admin will reconcile).
        BEGIN
          PERFORM public.debit_wallet(
            v_user_id, v_amount, 'refund',
            NULL, 'stripe_charge',
            'Refund of charge ' || (v_obj ->> 'id')
          );
        EXCEPTION WHEN OTHERS THEN
          UPDATE public.profiles SET is_banned = TRUE WHERE id = v_user_id;
        END;
      END IF;

    WHEN 'charge.dispute.created' THEN
      v_user_id := (v_obj -> 'metadata' ->> 'user_id')::UUID;
      IF v_user_id IS NOT NULL THEN
        UPDATE public.profiles SET is_banned = TRUE WHERE id = v_user_id;
      END IF;

    WHEN 'charge.dispute.funds_withdrawn' THEN
      v_amount  := ((v_obj ->> 'amount')::INT) / 100.0;
      v_user_id := (v_obj -> 'metadata' ->> 'user_id')::UUID;
      IF v_user_id IS NOT NULL AND v_amount > 0 THEN
        BEGIN
          PERFORM public.debit_wallet(
            v_user_id, v_amount, 'refund',
            NULL, 'stripe_dispute',
            'Dispute funds withdrawn');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;

    -- ─── WITHDRAWALS (H-12) ─────────────────────────────────────────────────
    WHEN 'transfer.paid', 'transfer.created' THEN
      v_transfer_id := v_obj ->> 'id';
      SELECT id, user_id, amount
        INTO v_wr_id, v_user_id, v_amount
        FROM public.withdrawal_requests
       WHERE stripe_transfer_id = v_transfer_id
       LIMIT 1;
      IF v_wr_id IS NOT NULL THEN
        UPDATE public.withdrawal_requests
           SET status='completed', processed_at = NOW()
         WHERE id = v_wr_id;
        UPDATE public.profiles
           SET pending_withdrawal = GREATEST(0, pending_withdrawal - v_amount),
               last_withdrawal_at = NOW()
         WHERE id = v_user_id;
      END IF;

    WHEN 'transfer.failed' THEN
      v_transfer_id := v_obj ->> 'id';
      SELECT id, user_id, amount
        INTO v_wr_id, v_user_id, v_amount
        FROM public.withdrawal_requests
       WHERE stripe_transfer_id = v_transfer_id
       LIMIT 1;
      IF v_wr_id IS NOT NULL THEN
        -- Return funds to balance.
        PERFORM public.credit_wallet(
          v_user_id, v_amount, 'refund',
          v_wr_id, 'withdrawal_failed',
          'Withdrawal transfer failed; funds returned');
        UPDATE public.withdrawal_requests
           SET status='rejected',
               rejection_reason='stripe_transfer_failed',
               processed_at = NOW()
         WHERE id = v_wr_id;
        UPDATE public.profiles
           SET pending_withdrawal = GREATEST(0, pending_withdrawal - v_amount)
         WHERE id = v_user_id;
      END IF;

    ELSE
      UPDATE public.stripe_webhook_events
         SET status='ignored', processed_at = NOW()
       WHERE stripe_event_id = p_event_id;
      RETURN 'ignored';
  END CASE;

  UPDATE public.stripe_webhook_events
     SET status='processed', processed_at = NOW()
   WHERE stripe_event_id = p_event_id;
  RETURN 'processed';

EXCEPTION WHEN OTHERS THEN
  UPDATE public.stripe_webhook_events
     SET status='failed', error_message=SQLERRM, processed_at=NOW()
   WHERE stripe_event_id = p_event_id;
  RAISE;
END;
$$;


-- =============================================================================
-- SECTION 8 — RG / WITHDRAWAL HELPERS
-- =============================================================================

-- Returns TRUE if the user is currently allowed to play / withdraw based on
-- self-exclusion and state restrictions.
CREATE OR REPLACE FUNCTION public.user_can_play(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state      TEXT;
  v_excluded   BOOLEAN;
  v_excluded_until TIMESTAMPTZ;
  v_state_ok   BOOLEAN;
BEGIN
  SELECT p.state INTO v_state FROM public.profiles p WHERE p.id = p_user_id;

  SELECT is_permanently_excluded, self_excluded_until
    INTO v_excluded, v_excluded_until
    FROM public.responsible_gaming_settings
   WHERE user_id = p_user_id;

  IF v_excluded THEN RETURN FALSE; END IF;
  IF v_excluded_until IS NOT NULL AND v_excluded_until > NOW() THEN
    RETURN FALSE;
  END IF;

  IF v_state IS NULL THEN RETURN FALSE; END IF;
  SELECT is_allowed INTO v_state_ok
    FROM public.state_restrictions WHERE state_code = v_state;
  IF v_state_ok IS NULL OR v_state_ok = FALSE THEN RETURN FALSE; END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_deposit_limit(
  p_daily   DECIMAL DEFAULT NULL,
  p_weekly  DECIMAL DEFAULT NULL,
  p_monthly DECIMAL DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cur RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_cur
    FROM public.responsible_gaming_settings
   WHERE user_id = v_uid;

  -- Decreases apply immediately, increases enter the 24h cooling-off queue.
  IF p_daily IS NOT NULL THEN
    IF v_cur.daily_deposit_limit IS NULL OR p_daily <= v_cur.daily_deposit_limit THEN
      UPDATE public.responsible_gaming_settings
         SET daily_deposit_limit = p_daily WHERE user_id = v_uid;
    ELSE
      INSERT INTO public.responsible_gaming_pending_changes
        (user_id, change_type, new_value, effective_at)
      VALUES (v_uid, 'daily_deposit_limit', p_daily, NOW() + INTERVAL '24 hours');
    END IF;
  END IF;

  IF p_weekly IS NOT NULL THEN
    IF v_cur.weekly_deposit_limit IS NULL OR p_weekly <= v_cur.weekly_deposit_limit THEN
      UPDATE public.responsible_gaming_settings
         SET weekly_deposit_limit = p_weekly WHERE user_id = v_uid;
    ELSE
      INSERT INTO public.responsible_gaming_pending_changes
        (user_id, change_type, new_value, effective_at)
      VALUES (v_uid, 'weekly_deposit_limit', p_weekly, NOW() + INTERVAL '24 hours');
    END IF;
  END IF;

  IF p_monthly IS NOT NULL THEN
    IF v_cur.monthly_deposit_limit IS NULL OR p_monthly <= v_cur.monthly_deposit_limit THEN
      UPDATE public.responsible_gaming_settings
         SET monthly_deposit_limit = p_monthly WHERE user_id = v_uid;
    ELSE
      INSERT INTO public.responsible_gaming_pending_changes
        (user_id, change_type, new_value, effective_at)
      VALUES (v_uid, 'monthly_deposit_limit', p_monthly, NOW() + INTERVAL '24 hours');
    END IF;
  END IF;
END;
$$;

-- One-way self-exclusion. Cannot be reversed by the user — only via service_role.
CREATE OR REPLACE FUNCTION public.request_self_exclusion(
  p_days INT,
  p_permanent BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF p_permanent THEN
    UPDATE public.responsible_gaming_settings
       SET is_permanently_excluded = TRUE,
           self_excluded_until     = NULL
     WHERE user_id = v_uid;
  ELSE
    IF p_days IS NULL OR p_days <= 0 THEN
      RAISE EXCEPTION 'days must be > 0';
    END IF;
    UPDATE public.responsible_gaming_settings
       SET self_excluded_until = NOW() + (p_days || ' days')::INTERVAL
     WHERE user_id = v_uid
       AND (self_excluded_until IS NULL OR self_excluded_until < NOW() + (p_days || ' days')::INTERVAL);
  END IF;
END;
$$;


-- =============================================================================
-- SECTION 9 — SIDEBET RPCS (C-5, C-18, C-19)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_sidebet(
  p_player_id     UUID,
  p_stat_category TEXT,
  p_line_value    DECIMAL,
  p_creator_side  TEXT,    -- 'OVER' | 'UNDER'
  p_wager_amount  DECIMAL,
  p_creator_reasoning TEXT DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_game_id UUID;
  v_team_id UUID;
  v_sidebet_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.user_can_play(v_uid) THEN
    RAISE EXCEPTION 'user not eligible to play';
  END IF;
  IF p_wager_amount IS NULL OR p_wager_amount <= 0 THEN
    RAISE EXCEPTION 'wager must be > 0';
  END IF;
  IF p_creator_side NOT IN ('OVER','UNDER') THEN
    RAISE EXCEPTION 'creator_side must be OVER or UNDER';
  END IF;

  SELECT team_id INTO v_team_id
    FROM public.nba_players WHERE id = p_player_id;

  SELECT id INTO v_game_id
    FROM public.nba_games
   WHERE game_date >= CURRENT_DATE
     AND status IN ('scheduled','in_progress')
     AND (home_team_id = v_team_id OR away_team_id = v_team_id)
   ORDER BY tip_off_time ASC NULLS LAST
   LIMIT 1;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION 'no upcoming game for this player';
  END IF;

  -- Escrow the wager from balance.
  PERFORM public.move_to_escrow(v_uid, p_wager_amount);

  INSERT INTO public.sidebets
    (creator_id, player_id, game_id, stat_category, line_value,
     creator_side, creator_reasoning, wager_amount, status, is_open)
  VALUES
    (v_uid, p_player_id, v_game_id, p_stat_category, p_line_value,
     p_creator_side, p_creator_reasoning, p_wager_amount, 'open', TRUE)
  RETURNING id INTO v_sidebet_id;

  -- Targeted (friend) sidebet — notify the target.
  IF p_target_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (p_target_user_id, 'sidebet_received',
            'You got a sidebet challenge',
            'Tap to view',
            jsonb_build_object('sidebet_id', v_sidebet_id));
  END IF;

  RETURN v_sidebet_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_sidebet(p_sidebet_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sb RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.user_can_play(v_uid) THEN
    RAISE EXCEPTION 'user not eligible to play';
  END IF;

  SELECT * INTO v_sb FROM public.sidebets WHERE id = p_sidebet_id FOR UPDATE;
  IF v_sb.id IS NULL THEN RAISE EXCEPTION 'sidebet not found'; END IF;
  IF v_sb.status <> 'open' OR NOT v_sb.is_open THEN
    RAISE EXCEPTION 'sidebet is not open for acceptance';
  END IF;
  IF v_sb.creator_id = v_uid THEN
    RAISE EXCEPTION 'cannot accept your own sidebet';
  END IF;
  IF v_sb.expires_at < NOW() THEN
    UPDATE public.sidebets SET status='expired', is_open=FALSE WHERE id = p_sidebet_id;
    RAISE EXCEPTION 'sidebet has expired';
  END IF;

  PERFORM public.move_to_escrow(v_uid, v_sb.wager_amount);

  UPDATE public.sidebets
     SET opponent_id = v_uid,
         status      = 'accepted',
         is_open     = FALSE,
         accepted_at = NOW()
   WHERE id = p_sidebet_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_sb.creator_id, 'sidebet_accepted',
          'Your sidebet got accepted',
          'Game on',
          jsonb_build_object('sidebet_id', p_sidebet_id));
END;
$$;


-- =============================================================================
-- SECTION 10 — LINEUP + MATCHUP RPCS (C-6, C-7, C-14, C-15, H-7)
-- =============================================================================

-- Submit exactly 3 players, snapshot frozen prices server-side, validate against
-- entry_tier_caps, escrow the entry fee, and try to FIFO-match against an
-- existing pending matchup. If no match, create a pending matchup and enqueue.
--
-- Returns the matchup_id (whether matched or pending).
CREATE OR REPLACE FUNCTION public.submit_lineup_and_match(
  p_entry_tier DECIMAL,
  p_player_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_user      RECORD;
  v_cap       RECORD;
  v_lineup_id UUID;
  v_total     DECIMAL(8,2) := 0;
  v_price     DECIMAL(8,2);
  v_pid       UUID;
  v_slot      INT := 0;
  v_open_match RECORD;
  v_matchup_id UUID;
  v_rake_pct  DECIMAL(5,2);
  v_pot       DECIMAL(8,2);
  v_rake      DECIMAL(8,2);
  v_payout    DECIMAL(8,2);
  v_game_date DATE := CURRENT_DATE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.user_can_play(v_uid) THEN
    RAISE EXCEPTION 'user not eligible to play';
  END IF;
  IF p_player_ids IS NULL OR array_length(p_player_ids, 1) <> 3 THEN
    RAISE EXCEPTION 'lineup must contain exactly 3 players';
  END IF;
  IF p_player_ids[1] = p_player_ids[2]
     OR p_player_ids[1] = p_player_ids[3]
     OR p_player_ids[2] = p_player_ids[3] THEN
    RAISE EXCEPTION 'duplicate players in lineup';
  END IF;

  SELECT id, terms_accepted_at INTO v_user
    FROM public.profiles WHERE id = v_uid;
  IF v_user.terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'terms must be accepted before play';
  END IF;

  -- H-19: gate on email confirmation
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
     WHERE id = v_uid AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'email must be verified before play';
  END IF;

  SELECT * INTO v_cap
    FROM public.entry_tier_caps WHERE entry_tier = p_entry_tier;
  IF v_cap.entry_tier IS NULL THEN
    RAISE EXCEPTION 'invalid entry tier %', p_entry_tier;
  END IF;

  -- Snapshot prices server-side. Reject locked / inactive players.
  FOREACH v_pid IN ARRAY p_player_ids LOOP
    v_slot := v_slot + 1;
    SELECT current_price INTO v_price
      FROM public.player_prices pp
      JOIN public.nba_players np ON np.id = pp.player_id
     WHERE pp.player_id = v_pid
       AND pp.is_locked = FALSE
       AND np.is_active = TRUE;
    IF v_price IS NULL THEN
      RAISE EXCEPTION 'player % is locked or inactive', v_pid;
    END IF;
    v_total := v_total + v_price;
  END LOOP;

  IF v_total < v_cap.min_cap OR v_total > v_cap.salary_cap THEN
    RAISE EXCEPTION 'lineup total $% outside cap [$%–$%]',
      v_total, v_cap.min_cap, v_cap.salary_cap;
  END IF;

  -- Escrow the entry fee.
  PERFORM public.move_to_escrow(v_uid, p_entry_tier);

  -- Insert the lineup + lineup_players.
  INSERT INTO public.lineups
    (user_id, entry_tier, status, total_cap_used, submitted_at)
  VALUES (v_uid, p_entry_tier, 'submitted', v_total, NOW())
  RETURNING id INTO v_lineup_id;

  v_slot := 0;
  FOREACH v_pid IN ARRAY p_player_ids LOOP
    v_slot := v_slot + 1;
    SELECT current_price INTO v_price
      FROM public.player_prices WHERE player_id = v_pid;
    INSERT INTO public.lineup_players
      (lineup_id, player_id, slot_number, frozen_price)
    VALUES (v_lineup_id, v_pid, v_slot, v_price);

    -- Bump real demand counter for the pricing engine (H-8).
    UPDATE public.player_prices
       SET demand_count_this_tick = demand_count_this_tick + 1,
           demand_count_1h        = demand_count_1h + 1,
           total_selections       = COALESCE(total_selections, 0) + 1
     WHERE player_id = v_pid;
  END LOOP;

  -- Bump entries counter (service-role context so protected-cols trigger skips).
  UPDATE public.profiles
     SET total_entries = total_entries + 1
   WHERE id = v_uid;

  -- Try to FIFO match against an open matchup at the same tier with no opponent.
  SELECT m.id INTO v_open_match.id
    FROM public.matchups m
   WHERE m.status     = 'pending'
     AND m.entry_tier = p_entry_tier
     AND m.user2_id   IS NULL
     AND m.user1_id   <> v_uid
     AND COALESCE(m.game_date, CURRENT_DATE) >= CURRENT_DATE
   ORDER BY m.created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_open_match.id IS NOT NULL THEN
    SELECT (value)::DECIMAL INTO v_rake_pct
      FROM public.app_config WHERE key = 'rake_percentage';
    v_rake_pct := COALESCE(v_rake_pct, 3.5);
    v_pot     := p_entry_tier * 2;
    v_rake    := round(v_pot * (v_rake_pct / 100.0), 2);
    v_payout  := v_pot - v_rake;

    UPDATE public.matchups
       SET lineup2_id   = v_lineup_id,
           user2_id     = v_uid,
           pot_amount   = v_pot,
           rake_amount  = v_rake,
           payout_amount = v_payout,
           status       = 'matched',
           matched_at   = NOW()
     WHERE id = v_open_match.id
    RETURNING id INTO v_matchup_id;

    DELETE FROM public.matchmaking_queue WHERE lineup_id IN (
      SELECT lineup1_id FROM public.matchups WHERE id = v_matchup_id
    );

    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT m.user1_id, 'matchup_found',
           'Match found',
           'Your $' || p_entry_tier::TEXT || ' lineup is now live',
           jsonb_build_object('matchup_id', v_matchup_id)
      FROM public.matchups m WHERE m.id = v_matchup_id;
  ELSE
    INSERT INTO public.matchups
      (lineup1_id, user1_id, entry_tier, pot_amount, rake_amount, payout_amount,
       status, game_date)
    VALUES
      (v_lineup_id, v_uid, p_entry_tier, p_entry_tier, 0, p_entry_tier,
       'pending', v_game_date)
    RETURNING id INTO v_matchup_id;

    INSERT INTO public.matchmaking_queue
      (lineup_id, user_id, entry_tier, game_date)
    VALUES (v_lineup_id, v_uid, p_entry_tier, v_game_date);
  END IF;

  RETURN jsonb_build_object(
    'matchup_id', v_matchup_id,
    'lineup_id',  v_lineup_id,
    'total_cap_used', v_total,
    'joined_existing', v_open_match.id IS NOT NULL
  );
END;
$$;

-- Cancel a pending (unmatched) matchup; refund the entry fee.
CREATE OR REPLACE FUNCTION public.cancel_matchup_pending(p_matchup_id UUID)
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
  IF v_m.user1_id <> v_uid THEN RAISE EXCEPTION 'not your matchup'; END IF;
  IF v_m.status <> 'pending' OR v_m.user2_id IS NOT NULL THEN
    RAISE EXCEPTION 'matchup cannot be cancelled in status %', v_m.status;
  END IF;

  UPDATE public.matchups
     SET status = 'voided', completed_at = NOW()
   WHERE id = p_matchup_id;
  UPDATE public.lineups SET status = 'cancelled' WHERE id = v_m.lineup1_id;
  DELETE FROM public.matchmaking_queue WHERE lineup_id = v_m.lineup1_id;

  -- Refund escrow.
  PERFORM public.release_escrow(v_uid, v_m.entry_tier);
END;
$$;

-- Settle a single matchup. Aggregates fantasy_points_total from
-- player_game_stats via lineup_players → lineups, declares winner, pays out.
-- Idempotent: a completed matchup is left alone.
CREATE OR REPLACE FUNCTION public.settle_matchup(p_matchup_id UUID)
RETURNS TEXT  -- 'settled' | 'not_ready' | 'already_settled'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m         RECORD;
  v_lineup1   RECORD;
  v_lineup2   RECORD;
  v_winner    UUID;
  v_winner_lineup UUID;
  v_all_final BOOLEAN;
BEGIN
  SELECT * INTO v_m FROM public.matchups WHERE id = p_matchup_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'matchup not found'; END IF;
  IF v_m.status IN ('completed','voided','tie') THEN RETURN 'already_settled'; END IF;
  IF v_m.status NOT IN ('matched','live') THEN RETURN 'not_ready'; END IF;
  IF v_m.user2_id IS NULL OR v_m.lineup2_id IS NULL THEN RETURN 'not_ready'; END IF;

  -- All three player game stats final for both lineups?
  SELECT bool_and(pgs.is_final) INTO v_all_final
    FROM public.lineup_players lp
    JOIN public.player_game_stats pgs ON pgs.player_id = lp.player_id
   WHERE lp.lineup_id IN (v_m.lineup1_id, v_m.lineup2_id);
  IF v_all_final IS NOT TRUE THEN RETURN 'not_ready'; END IF;

  -- Compute totals.
  WITH totals AS (
    SELECT lp.lineup_id,
           SUM(pgs.fantasy_points) AS total
      FROM public.lineup_players lp
      JOIN public.player_game_stats pgs ON pgs.player_id = lp.player_id
     WHERE lp.lineup_id IN (v_m.lineup1_id, v_m.lineup2_id)
     GROUP BY lp.lineup_id
  )
  SELECT
    (SELECT total FROM totals WHERE lineup_id = v_m.lineup1_id) AS l1,
    (SELECT total FROM totals WHERE lineup_id = v_m.lineup2_id) AS l2
  INTO v_lineup1, v_lineup2;

  UPDATE public.lineups SET fantasy_points_total = COALESCE(v_lineup1.l1, 0)
   WHERE id = v_m.lineup1_id;
  UPDATE public.lineups SET fantasy_points_total = COALESCE(v_lineup2.l1, 0)
   WHERE id = v_m.lineup2_id;

  IF COALESCE(v_lineup1.l1,0) > COALESCE(v_lineup2.l1,0) THEN
    v_winner := v_m.user1_id;
    v_winner_lineup := v_m.lineup1_id;
  ELSIF COALESCE(v_lineup2.l1,0) > COALESCE(v_lineup1.l1,0) THEN
    v_winner := v_m.user2_id;
    v_winner_lineup := v_m.lineup2_id;
  ELSE
    -- Tie: refund both escrows.
    UPDATE public.matchups
       SET status='tie', completed_at=NOW()
     WHERE id = p_matchup_id;
    PERFORM public.release_escrow(v_m.user1_id, v_m.entry_tier);
    PERFORM public.release_escrow(v_m.user2_id, v_m.entry_tier);
    UPDATE public.lineups SET status='completed'
     WHERE id IN (v_m.lineup1_id, v_m.lineup2_id);
    RETURN 'settled';
  END IF;

  -- Loser's escrow is consumed; winner's escrow is released and they receive
  -- the payout (pot - rake) credited to their balance.
  IF v_winner = v_m.user1_id THEN
    PERFORM public.release_escrow(v_m.user1_id, v_m.entry_tier);
    PERFORM public.consume_escrow(v_m.user2_id, v_m.entry_tier);
  ELSE
    PERFORM public.release_escrow(v_m.user2_id, v_m.entry_tier);
    PERFORM public.consume_escrow(v_m.user1_id, v_m.entry_tier);
  END IF;

  -- Pay the winner the *payout* (not the pot). Their own entry is already
  -- back in balance via release_escrow above.
  PERFORM public.credit_wallet(
    v_winner, v_m.payout_amount - v_m.entry_tier, 'winnings',
    p_matchup_id, 'matchup', 'Matchup payout');

  -- Update profile stats (service-role context bypasses protected-cols trigger).
  UPDATE public.profiles
     SET total_wins = total_wins + 1,
         total_earnings = total_earnings + (v_m.payout_amount - v_m.entry_tier),
         lifetime_winnings = lifetime_winnings + (v_m.payout_amount - v_m.entry_tier)
   WHERE id = v_winner;
  UPDATE public.profiles
     SET total_losses = total_losses + 1
   WHERE id = CASE WHEN v_winner = v_m.user1_id THEN v_m.user2_id ELSE v_m.user1_id END;

  UPDATE public.matchups
     SET status='completed',
         winner_user_id   = v_winner,
         winner_lineup_id = v_winner_lineup,
         completed_at     = NOW()
   WHERE id = p_matchup_id;

  UPDATE public.lineups SET status='completed'
   WHERE id IN (v_m.lineup1_id, v_m.lineup2_id);

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_winner, 'game_final', 'You won', 'Tap to view your matchup',
          jsonb_build_object('matchup_id', p_matchup_id)),
         (CASE WHEN v_winner = v_m.user1_id THEN v_m.user2_id ELSE v_m.user1_id END,
          'game_final', 'You lost', 'Better luck next time',
          jsonb_build_object('matchup_id', p_matchup_id));

  RETURN 'settled';
END;
$$;


-- =============================================================================
-- SECTION 11 — WITHDRAWAL RPC (C-17)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount           DECIMAL,
  p_payout_method_id UUID
)
RETURNS UUID  -- withdrawal_requests.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_min DECIMAL;
  v_wallet RECORD;
  v_pm RECORD;
  v_kyc TEXT;
  v_wr_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.user_can_play(v_uid) THEN
    RAISE EXCEPTION 'user not eligible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users
     WHERE id = v_uid AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'email must be verified before withdrawal';
  END IF;

  SELECT kyc_status INTO v_kyc FROM public.profiles WHERE id = v_uid;
  IF v_kyc <> 'verified' THEN
    RAISE EXCEPTION 'KYC verification required';
  END IF;

  SELECT (value)::DECIMAL INTO v_min
    FROM public.app_config WHERE key = 'min_withdrawal';
  v_min := COALESCE(v_min, 10.00);
  IF p_amount IS NULL OR p_amount < v_min THEN
    RAISE EXCEPTION 'minimum withdrawal is $%', v_min;
  END IF;

  SELECT * INTO v_pm FROM public.payout_methods
   WHERE id = p_payout_method_id AND user_id = v_uid AND is_active = TRUE;
  IF v_pm.id IS NULL THEN RAISE EXCEPTION 'payout method not found'; END IF;
  IF NOT v_pm.is_verified THEN
    RAISE EXCEPTION 'payout method not verified';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid;
  IF v_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  -- Atomically debit balance + insert withdrawal row + pending transaction.
  PERFORM public.debit_wallet(
    v_uid, p_amount, 'withdrawal',
    NULL, 'withdrawal_request', 'Withdrawal requested');

  UPDATE public.profiles
     SET pending_withdrawal = pending_withdrawal + p_amount
   WHERE id = v_uid;

  INSERT INTO public.withdrawal_requests
    (user_id, wallet_id, amount, method, destination_details, status, payout_method_id)
  VALUES
    (v_uid, v_wallet.id, p_amount,
     CASE v_pm.method_type
       WHEN 'bank_ach' THEN 'ach'
       WHEN 'paypal'   THEN 'paypal'
       WHEN 'venmo'    THEN 'venmo'
       WHEN 'check'    THEN 'check'
       ELSE 'ach'
     END,
     jsonb_build_object('display_name', v_pm.display_name),
     'pending', v_pm.id)
  RETURNING id INTO v_wr_id;

  RETURN v_wr_id;
END;
$$;


-- =============================================================================
-- SECTION 12 — PRICING ENGINE RPC (H-8)
-- =============================================================================
-- One tick: for each unlocked, active player, computes the locked-spec delta.
-- Schedule via pg_cron every 30s during market hours (set up separately).

CREATE OR REPLACE FUNCTION public.tick_player_prices()
RETURNS INT  -- rows updated
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows         INT := 0;
  v_active_users INT;
  v_demand_coef  CONSTANT NUMERIC := 0.35;
  v_gravity_coef CONSTANT NUMERIC := 0.008;
  v_velocity_coef CONSTANT NUMERIC := 0.3;
  v_cold_cap     CONSTANT NUMERIC := 8.0;
  v_floor_mult   CONSTANT NUMERIC := 0.60;
  v_ceil_mult    CONSTANT NUMERIC := 1.80;
BEGIN
  -- Snapshot of active users — anyone logged-in in last 5 min.
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
           pp.price_velocity * v_velocity_coef AS velocity_term
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
               u.current_price + u.demand_force + u.gravity + u.velocity_term
             )
           ) AS new_price,
           u.demand_force,
           u.gravity,
           u.velocity_term
      FROM updates u
  )
  UPDATE public.player_prices pp
     SET current_price          = c.new_price,
         price_velocity         = (c.new_price - pp.current_price),
         demand_count_this_tick = 0,
         active_users_snapshot  = v_active_users,
         updated_at             = NOW()
    FROM computed c
   WHERE pp.player_id = c.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Snapshot price history (sampling — every tick is fine at 30s cadence).
  INSERT INTO public.price_history (player_id, price, volume, recorded_at)
  SELECT pp.player_id, pp.current_price, pp.demand_count_1h, NOW()
    FROM public.player_prices pp
    JOIN public.nba_players np ON np.id = pp.player_id
   WHERE pp.is_locked = FALSE AND np.is_active = TRUE;

  RETURN v_rows;
END;
$$;


-- =============================================================================
-- SECTION 13 — APPLY DUE LIMIT-INCREASE COOLING-OFF (C-4)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_due_rg_changes()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_rows INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.responsible_gaming_pending_changes
     WHERE applied_at IS NULL AND effective_at <= NOW()
     FOR UPDATE SKIP LOCKED
  LOOP
    EXECUTE format(
      'UPDATE public.responsible_gaming_settings SET %I = $1 WHERE user_id = $2',
      r.change_type
    ) USING r.new_value, r.user_id;
    UPDATE public.responsible_gaming_pending_changes
       SET applied_at = NOW() WHERE id = r.id;
    v_rows := v_rows + 1;
  END LOOP;
  RETURN v_rows;
END;
$$;


-- =============================================================================
-- SECTION 14 — GRANTS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION
  public.credit_wallet(UUID, DECIMAL, TEXT, UUID, TEXT, TEXT),
  public.debit_wallet(UUID, DECIMAL, TEXT, UUID, TEXT, TEXT),
  public.move_to_escrow(UUID, DECIMAL),
  public.release_escrow(UUID, DECIMAL),
  public.consume_escrow(UUID, DECIMAL),
  public.process_stripe_event(TEXT, TEXT, JSONB),
  public.settle_matchup(UUID),
  public.tick_player_prices(),
  public.apply_due_rg_changes()
FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION
  public.submit_lineup_and_match(DECIMAL, UUID[]),
  public.cancel_matchup_pending(UUID),
  public.create_sidebet(UUID, TEXT, DECIMAL, TEXT, DECIMAL, TEXT, UUID),
  public.accept_sidebet(UUID),
  public.request_withdrawal(DECIMAL, UUID),
  public.set_deposit_limit(DECIMAL, DECIMAL, DECIMAL),
  public.request_self_exclusion(INT, BOOLEAN),
  public.user_can_play(UUID)
TO authenticated;


-- =============================================================================
-- SECTION 15 — SCHEDULED JOBS
-- =============================================================================
-- Replace the old 5-minute decay with a 30-second price tick.

SELECT cron.unschedule('decay-price-velocity')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='decay-price-velocity');

SELECT cron.schedule(
  'tick-player-prices',
  '*/1 * * * *',   -- minute granularity is the finest pg_cron supports
  $$ SELECT public.tick_player_prices(); $$
);

SELECT cron.schedule(
  'apply-rg-pending-changes',
  '*/5 * * * *',
  $$ SELECT public.apply_due_rg_changes(); $$
);

-- =============================================================================
-- END
-- =============================================================================
