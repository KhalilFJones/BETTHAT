import { supabase } from '@/lib/supabase';

export interface PlaceOrderResult {
  matchup_id: string;
  matched: boolean;
  settled_wager?: number;
}

/**
 * Place an order on a built lineup at an open max wager ($5–$50).
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

/** Cancel a still-pending order and release the escrowed wager back to balance. */
export async function cancelLineupOrder(matchupId: string): Promise<void> {
  const { error } = await supabase.rpc(
    'cancel_lineup_order' as never,
    { p_matchup_id: matchupId } as never,
  );
  if (error) throw new Error(error.message);
}
