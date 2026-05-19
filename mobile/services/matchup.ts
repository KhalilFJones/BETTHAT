import { supabase } from '@/lib/supabase';

export interface SubmitLineupResult {
  matchup_id: string;
  lineup_id: string;
  total_cap_used: number;
  joined_existing: boolean;
}

/**
 * Submit exactly 3 player ids at the given entry tier.
 * Server snapshots frozen prices, enforces salary cap, escrows the entry fee,
 * and attempts FIFO match against an open matchup.
 */
export async function submitLineupAndMatch(
  entryTier: number,
  playerIds: string[],
): Promise<SubmitLineupResult> {
  if (playerIds.length !== 3) {
    throw new Error('lineup must contain exactly 3 players');
  }
  // RPC name types regenerate post-migration.
  const { data, error } = await supabase.rpc(
    'submit_lineup_and_match' as never,
    { p_entry_tier: entryTier, p_player_ids: playerIds } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as SubmitLineupResult;
}

export async function cancelMatchupPending(matchupId: string): Promise<void> {
  const { error } = await supabase.rpc(
    'cancel_matchup_pending' as never,
    { p_matchup_id: matchupId } as never,
  );
  if (error) throw new Error(error.message);
}
