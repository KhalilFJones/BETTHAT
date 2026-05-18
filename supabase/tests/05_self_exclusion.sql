-- =============================================================================
-- 05_self_exclusion.sql — RG self-exclusion is one-way + user_can_play gates
-- =============================================================================

BEGIN;

SELECT plan(5);

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rg@t.com', NOW());
INSERT INTO public.profiles (id, username, state, terms_accepted_at, terms_version, kyc_status) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rguser', 'NJ', NOW(), '1.0', 'verified');
INSERT INTO public.wallets (user_id) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.responsible_gaming_settings (user_id) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Eligible by default.
SELECT is(
  public.user_can_play('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID),
  TRUE,
  'fresh user is eligible to play'
);

-- Apply 30-day exclusion directly (the request_self_exclusion RPC needs auth.uid()).
UPDATE public.responsible_gaming_settings
   SET self_excluded_until = NOW() + INTERVAL '30 days'
 WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT is(
  public.user_can_play('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID),
  FALSE,
  'user with active self-exclusion is NOT eligible'
);

-- Past-dated exclusion expires automatically.
UPDATE public.responsible_gaming_settings
   SET self_excluded_until = NOW() - INTERVAL '1 day'
 WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT is(
  public.user_can_play('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID),
  TRUE,
  'user becomes eligible again once self-exclusion period elapses'
);

-- Permanent exclusion is one-way: even nulling self_excluded_until shouldn't
-- restore eligibility while is_permanently_excluded is TRUE.
UPDATE public.responsible_gaming_settings
   SET is_permanently_excluded = TRUE, self_excluded_until = NULL
 WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT is(
  public.user_can_play('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID),
  FALSE,
  'permanently excluded user is NOT eligible'
);

-- State restriction also blocks eligibility.
UPDATE public.responsible_gaming_settings
   SET is_permanently_excluded = FALSE WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
UPDATE public.state_restrictions SET is_allowed = FALSE WHERE state_code = 'NJ';

SELECT is(
  public.user_can_play('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID),
  FALSE,
  'user in a disallowed state is NOT eligible'
);

SELECT * FROM finish();
ROLLBACK;
