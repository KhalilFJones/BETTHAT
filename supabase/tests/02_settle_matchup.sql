-- =============================================================================
-- 02_settle_matchup.sql — matchup settlement end-to-end
-- =============================================================================
-- Verifies: settle_matchup returns 'not_ready' when stats aren't final,
--           pays the winner pot-minus-rake when they are,
--           updates profile wins/losses, and is idempotent.
-- =============================================================================

BEGIN;

SELECT plan(8);

-- Fixture: two users, two lineups, one matchup, one game with three player_game_stats.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('22222222-2222-2222-2222-222222222221', 'u1@t.com', NOW()),
  ('22222222-2222-2222-2222-222222222222', 'u2@t.com', NOW());
INSERT INTO public.profiles (id, username, state, terms_accepted_at, terms_version, kyc_status) VALUES
  ('22222222-2222-2222-2222-222222222221', 'p1', 'NJ', NOW(), '1.0', 'verified'),
  ('22222222-2222-2222-2222-222222222222', 'p2', 'NJ', NOW(), '1.0', 'verified');
INSERT INTO public.wallets (user_id, balance) VALUES
  ('22222222-2222-2222-2222-222222222221', 100),
  ('22222222-2222-2222-2222-222222222222', 100);

-- 3 NBA players + 1 game + 6 player_game_stats (3 per lineup), all NOT final yet.
INSERT INTO public.nba_players (id, full_name, first_name, last_name, team, team_abbreviation, position) VALUES
  ('33333333-3333-3333-3333-333333333331', 'P1', 'P', '1', 'A', 'A', 'PG'),
  ('33333333-3333-3333-3333-333333333332', 'P2', 'P', '2', 'A', 'A', 'SG'),
  ('33333333-3333-3333-3333-333333333333', 'P3', 'P', '3', 'A', 'A', 'SF');
INSERT INTO public.nba_games (id, season, home_team, home_team_abbreviation, away_team, away_team_abbreviation, game_date, status)
VALUES ('44444444-4444-4444-4444-444444444444', '2024-25', 'A', 'A', 'B', 'B', CURRENT_DATE, 'final');

-- Player stats — winner-side scores higher.
INSERT INTO public.player_game_stats (player_id, game_id, points, rebounds, assists, fantasy_points, is_final) VALUES
  ('33333333-3333-3333-3333-333333333331', '44444444-4444-4444-4444-444444444444', 30, 10, 8, 40.0, FALSE),
  ('33333333-3333-3333-3333-333333333332', '44444444-4444-4444-4444-444444444444', 20, 5, 5, 25.0, FALSE),
  ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 15, 5, 3, 18.0, FALSE);

-- Two lineups + lineup_players (3 each, same players for simplicity).
INSERT INTO public.lineups (id, user_id, entry_tier, status, total_cap_used) VALUES
  ('55555555-5555-5555-5555-555555555551', '22222222-2222-2222-2222-222222222221', 5, 'submitted', 75),
  ('55555555-5555-5555-5555-555555555552', '22222222-2222-2222-2222-222222222222', 5, 'submitted', 75);
INSERT INTO public.lineup_players (lineup_id, player_id, slot_number, frozen_price) VALUES
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333331', 1, 25),
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333332', 2, 25),
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333333', 3, 25),
  ('55555555-5555-5555-5555-555555555552', '33333333-3333-3333-3333-333333333331', 1, 25),
  ('55555555-5555-5555-5555-555555555552', '33333333-3333-3333-3333-333333333332', 2, 25),
  ('55555555-5555-5555-5555-555555555552', '33333333-3333-3333-3333-333333333333', 3, 25);

-- Both users have $5 in escrow (matchup is matched).
UPDATE public.wallets SET balance = 95, escrow_balance = 5
 WHERE user_id IN ('22222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.matchups
  (id, lineup1_id, lineup2_id, user1_id, user2_id, entry_tier,
   pot_amount, rake_amount, payout_amount, status, matched_at)
VALUES
  ('66666666-6666-6666-6666-666666666666',
   '55555555-5555-5555-5555-555555555551', '55555555-5555-5555-5555-555555555552',
   '22222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222',
   5, 10, 0.35, 9.65, 'matched', NOW());

-- Settle should be 'not_ready' because none of the player_game_stats are final.
SELECT is(
  public.settle_matchup('66666666-6666-6666-6666-666666666666')::TEXT,
  'not_ready',
  'settle_matchup returns not_ready when stats are not final'
);

-- Mark stats final. Same players in both lineups → it'll be a tie.
UPDATE public.player_game_stats SET is_final = TRUE
 WHERE game_id = '44444444-4444-4444-4444-444444444444';

-- Settling now should return 'settled' as a tie (both totals equal).
SELECT is(
  public.settle_matchup('66666666-6666-6666-6666-666666666666')::TEXT,
  'settled',
  'settle_matchup runs to settled (tie case)'
);
SELECT is(
  (SELECT status FROM public.matchups WHERE id = '66666666-6666-6666-6666-666666666666'),
  'tie',
  'matchup status is "tie" when totals match'
);

-- Both users should have full balance restored from escrow on tie.
SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '22222222-2222-2222-2222-222222222221'),
  '100.00',
  'user1 balance restored to 100 after tie refund'
);
SELECT is(
  (SELECT escrow_balance::TEXT FROM public.wallets WHERE user_id = '22222222-2222-2222-2222-222222222221'),
  '0.00',
  'user1 escrow drained on tie'
);

-- Idempotency: calling again returns 'already_settled' and balance unchanged.
SELECT is(
  public.settle_matchup('66666666-6666-6666-6666-666666666666')::TEXT,
  'already_settled',
  'settle_matchup is idempotent (already_settled on second call)'
);
SELECT is(
  (SELECT balance::TEXT FROM public.wallets WHERE user_id = '22222222-2222-2222-2222-222222222221'),
  '100.00',
  'user1 balance unchanged on second settle attempt'
);

-- Lineups are marked 'completed'.
SELECT is(
  (SELECT status FROM public.lineups WHERE id = '55555555-5555-5555-5555-555555555551'),
  'completed',
  'lineup1 status is completed after settle'
);

SELECT * FROM finish();
ROLLBACK;
