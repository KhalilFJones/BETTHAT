-- =============================================================================
-- 03_stripe_idempotency.sql — webhook handler is idempotent
-- =============================================================================
-- Verifies: processing the same event_id twice credits the wallet only once.
-- Also verifies missing user_id metadata results in 'failed' status.
-- =============================================================================

BEGIN;

SELECT plan(6);

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('77777777-7777-7777-7777-777777777777', 'stripe@t.com', NOW());
INSERT INTO public.profiles (id, username, state, terms_accepted_at, terms_version, kyc_status)
VALUES ('77777777-7777-7777-7777-777777777777', 'stripeuser', 'NJ', NOW(), '1.0', 'verified');
INSERT INTO public.wallets (user_id) VALUES ('77777777-7777-7777-7777-777777777777');

-- First webhook delivery — should credit $50.
SELECT is(
  public.process_stripe_event(
    'evt_test_001', 'payment_intent.succeeded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'pi_test_001',
          'amount_received', 5000,
          'metadata', jsonb_build_object('user_id', '77777777-7777-7777-7777-777777777777')
        )
      )
    )
  )::TEXT,
  'processed',
  'first delivery returns "processed"'
);

SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '77777777-7777-7777-7777-777777777777'),
  '50.00',
  'balance is $50 after first delivery'
);

-- Replay — should be detected as duplicate.
SELECT is(
  public.process_stripe_event(
    'evt_test_001', 'payment_intent.succeeded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'pi_test_001',
          'amount_received', 5000,
          'metadata', jsonb_build_object('user_id', '77777777-7777-7777-7777-777777777777')
        )
      )
    )
  )::TEXT,
  'duplicate',
  'replay returns "duplicate"'
);

SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '77777777-7777-7777-7777-777777777777'),
  '50.00',
  'balance is still $50 after replay (no double-credit)'
);

-- Missing user_id should fail without crediting.
SELECT is(
  public.process_stripe_event(
    'evt_test_002', 'payment_intent.succeeded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object('id', 'pi_test_002', 'amount_received', 1000, 'metadata', '{}'::JSONB)
      )
    )
  )::TEXT,
  'failed',
  'missing user_id returns "failed"'
);

-- Unknown event type should be ignored.
SELECT is(
  public.process_stripe_event(
    'evt_test_003', 'customer.subscription.created',
    '{"data": {"object": {}}}'::JSONB
  )::TEXT,
  'ignored',
  'unknown event type returns "ignored"'
);

SELECT * FROM finish();
ROLLBACK;
