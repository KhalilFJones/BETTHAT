import { supabase } from '@/lib/supabase';

export interface PlaceOrderResult {
  matchup_id: string;
  matched: boolean;
  settled_wager?: number;
}

/**
 * Place an order on a built lineup at an open max wager ($5–$100).
 * Server-side (SECURITY DEFINER) this validates the lineup + cap, escrows the
 * max wager atomically, and FIFO-matches against an open order — releasing each
 * side's escrow above the settled amount. Replaces the old client-side direct
 * inserts, which never escrowed the entry fee.
 */
export async function placeLineupOrder(
  lineupId: string,
  maxWager: number,
): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.rpc(
    'place_lineup_order' as never,
    { p_lineup_id: lineupId, p_max_wager: maxWager } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as PlaceOrderResult;
}

/**
 * Cancel a still-pending order and release the escrowed wager back to
 * balance. This is a SECURITY DEFINER RPC specifically so the "cancel" and
 * "an opponent just matched" paths can't race: the function locks the
 * matchup row and atomically refuses to cancel (raises "already matched")
 * once a second user has committed, instead of resetting a lineup that's
 * actually live.
 */
export async function cancelLineupOrder(matchupId: string): Promise<void> {
  const { error } = await supabase.rpc(
    'cancel_lineup_order' as never,
    { p_matchup_id: matchupId } as never,
  );
  if (error) throw new Error(error.message);
}

// =============================================================================
// FRIEND CHALLENGES — direct 1:1 challenges between friends at a fixed stake
// (as opposed to the open-wager FIFO matchmaking above). Both sides escrow the
// same amount; a matchup is created the moment the recipient accepts.
// =============================================================================

export interface CreateChallengeResult {
  challenge_id: string;
}

/** Send a friend a direct challenge at a fixed stake, using one of your own
 * `building`-status lineups. Escrows your stake immediately. */
export async function createFriendChallenge(
  recipientId: string,
  lineupId: string,
  entryTier: number,
  message?: string,
): Promise<CreateChallengeResult> {
  const { data, error } = await supabase.rpc(
    'create_friend_challenge' as never,
    { p_recipient_id: recipientId, p_lineup_id: lineupId, p_entry_tier: entryTier, p_message: message ?? null } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as CreateChallengeResult;
}

export interface AcceptChallengeResult {
  matchup_id: string;
}

/** Accept an incoming challenge using one of your own `building`-status
 * lineups. Escrows your stake and creates the live matchup. */
export async function acceptFriendChallenge(
  challengeId: string,
  lineupId: string,
): Promise<AcceptChallengeResult> {
  const { data, error } = await supabase.rpc(
    'accept_friend_challenge' as never,
    { p_challenge_id: challengeId, p_lineup_id: lineupId } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as AcceptChallengeResult;
}

/** Decline an incoming challenge — refunds the challenger's escrow. */
export async function declineFriendChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_friend_challenge' as never, { p_challenge_id: challengeId } as never);
  if (error) throw new Error(error.message);
}

/** Cancel a challenge you sent, before the recipient has responded. */
export async function cancelFriendChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_friend_challenge' as never, { p_challenge_id: challengeId } as never);
  if (error) throw new Error(error.message);
}
