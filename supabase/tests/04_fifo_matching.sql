-- =============================================================================
-- 04_fifo_matching.sql — submit_lineup_and_match FIFO ordering
-- =============================================================================
-- Verifies: the first pending matchup at the same tier is the one a new
-- submission joins (FIFO).
--
-- Requires a separate session that can authenticate as a user, which pgtap
-- can't do natively without a JWT. We test the equivalent SQL pattern that
-- the RPC uses internally — picking the oldest pending matchup with
-- user2_id IS NULL.
-- =============================================================================

BEGIN;

SELECT plan(3);

-- Create three pending matchups at $5 tier, oldest first.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('88888888-8888-8888-8888-888888888881', 'm1@t.com', NOW()),
  ('88888888-8888-8888-8888-888888888882', 'm2@t.com', NOW()),
  ('88888888-8888-8888-8888-888888888883', 'm3@t.com', NOW());
INSERT INTO public.profiles (id, username, state, terms_accepted_at, terms_version, kyc_status) VALUES
  ('88888888-8888-8888-8888-888888888881', 'm1', 'NJ', NOW(), '1.0', 'verified'),
  ('88888888-8888-8888-8888-888888888882', 'm2', 'NJ', NOW(), '1.0', 'verified'),
  ('88888888-8888-8888-8888-888888888883', 'm3', 'NJ', NOW(), '1.0', 'verified');
INSERT INTO public.wallets (user_id, balance) VALUES
  ('88888888-8888-8888-8888-888888888881', 50),
  ('88888888-8888-8888-8888-888888888882', 50),
  ('88888888-8888-8888-8888-888888888883', 50);
INSERT INTO public.lineups (id, user_id, entry_tier, status, total_cap_used) VALUES
  ('99999999-9999-9999-9999-999999999991', '88888888-8888-8888-8888-888888888881', 5, 'submitted', 50),
  ('99999999-9999-9999-9999-999999999992', '88888888-8888-8888-8888-888888888882', 5, 'submitted', 50);

INSERT INTO public.matchups (id, lineup1_id, user1_id, entry_tier, pot_amount, rake_amount, payout_amount, status, created_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '99999999-9999-9999-9999-999999999991', '88888888-8888-8888-8888-888888888881', 5, 5, 0, 5, 'pending', NOW() - INTERVAL '2 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '99999999-9999-9999-9999-999999999992', '88888888-8888-8888-8888-888888888882', 5, 5, 0, 5, 'pending', NOW() - INTERVAL '1 minute');

-- Verify the FIFO selection picks the oldest first.
SELECT is(
  (SELECT id::TEXT FROM public.matchups
    WHERE status = 'pending' AND entry_tier = 5 AND user2_id IS NULL
    ORDER BY created_at ASC LIMIT 1),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'oldest pending matchup is selected by FIFO logic'
);

-- After consuming the oldest, the next-oldest should be selected.
UPDATE public.matchups
   SET user2_id = '88888888-8888-8888-8888-888888888883', status = 'matched'
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

SELECT is(
  (SELECT id::TEXT FROM public.matchups
    WHERE status = 'pending' AND entry_tier = 5 AND user2_id IS NULL
    ORDER BY created_at ASC LIMIT 1),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'next-oldest matchup is selected after first is consumed'
);

-- No pending matchups at a different tier.
SELECT is(
  (SELECT COUNT(*) FROM public.matchups
    WHERE status = 'pending' AND entry_tier = 50 AND user2_id IS NULL),
  0::BIGINT,
  'no pending matchups at unused tier'
);

SELECT * FROM finish();
ROLLBACK;
