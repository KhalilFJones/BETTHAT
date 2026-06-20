-- =============================================================================
-- AUDIT FIX: WALLET-COLUMN DRIFT IN DEPOSIT + WITHDRAWAL FLOWS
-- =============================================================================
-- Same class of bug as settle_matchup / lock_protected_profile_cols: these RPCs
-- updated wallet-only columns (last_deposit_at, pending_withdrawal,
-- last_withdrawal_at) on public.profiles, where they DON'T exist. Every Stripe
-- deposit, every withdrawal request, and every withdrawal-transfer event raised
-- `record/column does not exist` and rolled back — so deposits and withdrawals
-- could never complete. Point them at public.wallets (keyed by user_id), where
-- those columns live. (is_banned correctly stays on profiles.)
-- =============================================================================


-- ── request_withdrawal: pending_withdrawal lives on wallets ───────────────────
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_payout_method_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  PERFORM public.debit_wallet(
    v_uid, p_amount, 'withdrawal',
    NULL, 'withdrawal_request', 'Withdrawal requested');

  UPDATE public.wallets
     SET pending_withdrawal = pending_withdrawal + p_amount
   WHERE user_id = v_uid;

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
$function$;


-- ── process_stripe_event: last_deposit_at / pending_withdrawal / last_withdrawal_at on wallets ──
CREATE OR REPLACE FUNCTION public.process_stripe_event(p_event_id text, p_event_type text, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted    INT := 0;   -- holds GET DIAGNOSTICS ROW_COUNT (was BOOLEAN → type error)
  v_obj         JSONB;
  v_user_id     UUID;
  v_amount      DECIMAL(10,2);
  v_intent_id   TEXT;
  v_transfer_id TEXT;
  v_wr_id       UUID;
  v_redacted    JSONB;
BEGIN
  v_obj := p_payload -> 'data' -> 'object';

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
      'customer',          v_obj ->> 'customer'
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

      UPDATE public.wallets
         SET last_deposit_at = NOW()
       WHERE user_id = v_user_id;

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
        UPDATE public.wallets
           SET pending_withdrawal = GREATEST(0, pending_withdrawal - v_amount),
               last_withdrawal_at = NOW()
         WHERE user_id = v_user_id;
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
        UPDATE public.wallets
           SET pending_withdrawal = GREATEST(0, pending_withdrawal - v_amount)
         WHERE user_id = v_user_id;
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
$function$;
