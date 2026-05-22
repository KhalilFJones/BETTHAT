-- TEST ONLY: SECURITY DEFINER RPC to simulate an opponent match after 10 seconds.
-- Normal matchup updates are done server-side (no UPDATE policy exists for client users).
-- This function verifies the matchup is still 'pending' and owned by p_user_id
-- before updating, so it cannot be abused to manipulate other users' matchups.
CREATE OR REPLACE FUNCTION public.test_auto_match(
  p_matchup_id uuid,
  p_user_id     uuid,
  p_lineup_id   uuid,
  p_wager       numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matchups
    WHERE id = p_matchup_id
      AND user1_id = p_user_id
      AND status = 'pending'
  ) THEN RETURN; END IF;

  UPDATE matchups SET
    status          = 'matched',
    user2_id        = p_user_id,
    lineup2_id      = p_lineup_id,
    user2_max_wager = p_wager,
    settled_wager   = p_wager,
    pot_amount      = ROUND(p_wager * 2, 2),
    rake_amount     = ROUND(p_wager * 2 * 0.035, 2),
    payout_amount   = ROUND(p_wager * 2 * 0.965, 2),
    matched_at      = now()
  WHERE id = p_matchup_id;
END;
$body$;
