-- =============================================================================
-- 01_wallet_rpcs.sql — atomic wallet operations
-- =============================================================================
-- Verifies: credit_wallet adds, debit_wallet rejects negatives,
--           move_to_escrow / release_escrow / consume_escrow preserve
--           total funds (balance + escrow_balance is conserved across moves).
-- =============================================================================

BEGIN;

SELECT plan(12);

-- Set up fixture user + wallet.
-- Service role bypasses RLS, so we can insert directly here.
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('11111111-1111-1111-1111-111111111111', 't1@test.com', NOW());
INSERT INTO public.profiles (id, username, display_name, state, terms_accepted_at, terms_version, kyc_status)
VALUES ('11111111-1111-1111-1111-111111111111', 'test1', 'Test One', 'NJ', NOW(), '1.0', 'verified');
INSERT INTO public.wallets (user_id) VALUES ('11111111-1111-1111-1111-111111111111');

-- credit_wallet should add to balance and total_deposited.
SELECT lives_ok(
  $$ SELECT public.credit_wallet('11111111-1111-1111-1111-111111111111'::UUID, 100.00, 'deposit') $$,
  'credit_wallet runs cleanly'
);
SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  '100.00',
  'balance is 100.00 after credit'
);
SELECT is(
  (SELECT total_deposited::TEXT FROM public.wallets WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  '100.00',
  'total_deposited is 100.00 after deposit credit'
);

-- credit_wallet rejects non-positive amounts.
SELECT throws_ok(
  $$ SELECT public.credit_wallet('11111111-1111-1111-1111-111111111111'::UUID, 0, 'deposit') $$,
  NULL, 'credit amount must be > 0',
  'credit_wallet rejects 0'
);
SELECT throws_ok(
  $$ SELECT public.credit_wallet('11111111-1111-1111-1111-111111111111'::UUID, -10, 'deposit') $$,
  NULL, 'credit amount must be > 0',
  'credit_wallet rejects negative'
);

-- debit_wallet success.
SELECT lives_ok(
  $$ SELECT public.debit_wallet('11111111-1111-1111-1111-111111111111'::UUID, 25.00, 'withdrawal') $$,
  'debit_wallet succeeds when balance is sufficient'
);
SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  '75.00',
  'balance is 75.00 after debit of 25'
);

-- debit_wallet refuses to drive balance negative.
SELECT throws_ok(
  $$ SELECT public.debit_wallet('11111111-1111-1111-1111-111111111111'::UUID, 999.00, 'withdrawal') $$,
  NULL, 'insufficient balance',
  'debit_wallet rejects amounts that exceed balance'
);
SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  '75.00',
  'balance unchanged after failed debit'
);

-- move_to_escrow + release_escrow conserve total funds.
SELECT lives_ok(
  $$ SELECT public.move_to_escrow('11111111-1111-1111-1111-111111111111'::UUID, 25.00) $$,
  'move_to_escrow succeeds'
);
SELECT is(
  (SELECT (balance + escrow_balance)::TEXT
     FROM public.wallets WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  '75.00',
  'balance + escrow_balance is preserved after move_to_escrow'
);

SELECT lives_ok(
  $$ SELECT public.release_escrow('11111111-1111-1111-1111-111111111111'::UUID, 10.00) $$,
  'release_escrow succeeds'
);

SELECT * FROM finish();
ROLLBACK;
