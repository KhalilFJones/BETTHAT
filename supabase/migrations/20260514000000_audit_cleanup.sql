-- =============================================================================
-- BETTHAT MIGRATION 6: AUDIT CLEANUP (Phase 6)
-- =============================================================================
-- Catches the remaining HIGH / MEDIUM / LOW items from AUDIT_REPORT.md that
-- weren't fixed in the schema-hardening migration:
--
--   H-31: weekly leaderboard cron counts ties as losses
--   L-8:  nba_players.team_id is added but never backfilled from team_abbreviation
--   M-14: stripe_webhook_events.payload stores full Stripe event JSON
--         (cardholder name, customer email, BIN). Redact before INSERT.
--   M-22: cron job comment "nightly" — schedule was actually every 5 min
--         (job has since been unscheduled in Phase 1, so this is moot —
--         documented here for the audit trail).
--
-- =============================================================================


-- =============================================================================
-- H-31 — weekly leaderboard cron: exclude ties from losses
-- =============================================================================

SELECT cron.unschedule('recalculate-weekly-leaderboard')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='recalculate-weekly-leaderboard');

SELECT cron.schedule(
  'recalculate-weekly-leaderboard',
  '0 23 * * 0',  -- Sundays at 23:00 UTC
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
      -- Audit fix: exclude ties (winner_user_id IS NULL) from losses.
      COUNT(CASE
        WHEN m.winner_user_id IS NOT NULL
         AND m.winner_user_id != p.id
         AND m.status = 'completed'
        THEN 1
      END),
      CASE
        WHEN COUNT(CASE WHEN m.status = 'completed' AND m.winner_user_id IS NOT NULL THEN 1 END) > 0
        THEN ROUND(
          100.0 * COUNT(CASE WHEN m.winner_user_id = p.id THEN 1 END)
               / NULLIF(COUNT(CASE WHEN m.status = 'completed' AND m.winner_user_id IS NOT NULL THEN 1 END), 0),
          2
        )
        ELSE 0
      END
    FROM public.profiles p
    LEFT JOIN public.matchups m
      ON (m.user1_id = p.id OR m.user2_id = p.id)
      AND m.completed_at >= NOW() - INTERVAL '7 days'
    GROUP BY p.id
    HAVING COUNT(m.id) > 0
    ON CONFLICT (user_id, period_type, period_key) DO UPDATE
      SET rank = EXCLUDED.rank,
          score = EXCLUDED.score,
          wins = EXCLUDED.wins,
          losses = EXCLUDED.losses,
          win_rate = EXCLUDED.win_rate,
          updated_at = NOW();
  $$
);


-- =============================================================================
-- L-8 — nba_players.team_id backfill from team_abbreviation
-- =============================================================================
-- Migration 2 added the FK but never backfilled. The sidebet game lookup
-- depends on this column being populated.

UPDATE public.nba_players np
   SET team_id = nt.id
  FROM public.nba_teams nt
 WHERE np.team_id IS NULL
   AND np.team_abbreviation = nt.abbreviation;

-- Same for nba_games home/away teams.
UPDATE public.nba_games g
   SET home_team_id = nt.id
  FROM public.nba_teams nt
 WHERE g.home_team_id IS NULL
   AND g.home_team_abbreviation = nt.abbreviation;

UPDATE public.nba_games g
   SET away_team_id = nt.id
  FROM public.nba_teams nt
 WHERE g.away_team_id IS NULL
   AND g.away_team_abbreviation = nt.abbreviation;


-- =============================================================================
-- M-14 — redact PII from stripe_webhook_events.payload going forward
-- =============================================================================
-- Replaces the body of process_stripe_event so the stored payload contains
-- only the fields we actually need for replay/audit, never the raw object
-- (which can include cardholder name, billing address, customer email).

CREATE OR REPLACE FUNCTION public.process_stripe_event(
  p_event_id    TEXT,
  p_event_type  TEXT,
  p_payload     JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted    BOOLEAN := FALSE;
  v_obj         JSONB;
  v_user_id     UUID;
  v_amount      DECIMAL(10,2);
  v_intent_id   TEXT;
  v_transfer_id TEXT;
  v_wr_id       UUID;
  v_redacted    JSONB;
BEGIN
  v_obj := p_payload -> 'data' -> 'object';

  -- M-14: store a redacted projection — keep only the fields we actually
  -- need for replay (id, type, amount fields, metadata). Strip card / billing
  -- / customer-name PII.
  v_redacted := jsonb_build_object(
    'id',       p_payload ->> 'id',
    'type',     p_payload ->> 'type',
    'created',  p_payload ->> 'created',
    'object', jsonb_build_object(
      'id',                v_obj ->> 'id',
      'amount',            v_obj -> 'amount',
      'amount_received',   v_obj -> 'amount_received',
      'amount_refunded',   v_obj -> 'amount_refunded',
      'currency',          v_obj -> 'currency',
      'status',            v_obj -> 'status',
      'metadata',          v_obj -> 'metadata',
      'customer',          v_obj ->> 'customer'   -- ID only, not full object
    )
  );

  INSERT INTO public.stripe_webhook_events
    (stripe_event_id, event_type, payload, status)
  VALUES
    (p_event_id, p_event_type, v_redacted, 'pending')
  ON CONFLICT (stripe_event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN 'duplicate';
  END IF;

  CASE p_event_type
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

    WHEN 'charge.refunded' THEN
      v_amount  := ((v_obj ->> 'amount_refunded')::INT) / 100.0;
      v_user_id := (v_obj -> 'metadata' ->> 'user_id')::UUID;
      IF v_user_id IS NOT NULL AND v_amount > 0 THEN
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
-- M-18 — DOB single source of truth
-- =============================================================================
-- profiles.date_of_birth is kept as the canonical "age verification" field
-- (used by onboarding to gate signup). user_kyc.date_of_birth is the formal
-- KYC provider record (Persona / Stripe Identity callback). These have
-- different purposes and the audit-noted drift is mitigated by:
--
--   - A trigger that keeps user_kyc.date_of_birth in sync when profiles is
--     updated (one-way: profile updates KYC, not the reverse, so KYC submissions
--     are still authoritative once received).
--
-- This is gentler than dropping profiles.date_of_birth (which would force a
-- bigger client refactor of the onboarding form).

CREATE OR REPLACE FUNCTION public.sync_dob_to_kyc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NEW.date_of_birth IS NOT NULL THEN
    UPDATE public.user_kyc
       SET date_of_birth = NEW.date_of_birth
     WHERE user_id = NEW.id
       AND status NOT IN ('verified', 'pending_review');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_dob_to_kyc ON public.profiles;
CREATE TRIGGER profiles_sync_dob_to_kyc
  AFTER UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_dob_to_kyc();


-- =============================================================================
-- M-22 — note about the unscheduled decay-price-velocity cron
-- =============================================================================
-- The decay-price-velocity job has been unscheduled (replaced by
-- tick-player-prices in Phase 1). Nothing to do here — the misleading
-- "nightly" comment lives in the unscheduled job's definition, which is no
-- longer applied. Documented for the audit trail.


-- =============================================================================
-- END
-- =============================================================================
