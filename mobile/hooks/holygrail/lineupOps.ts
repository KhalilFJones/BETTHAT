// =============================================================================
// Lineup mutation primitives — single source of truth for total_cap_used.
// Always SUM(lineup_players.frozen_price) instead of math on stale React Query
// cache. Eliminates the drift bug where adding/removing rapidly produces a
// total that doesn't match the actual roster.
// =============================================================================

import { supabase } from '@/lib/supabase';

/**
 * Recompute lineups.total_cap_used as SUM(lineup_players.frozen_price) for
 * the given lineup_id. Run this after every lineup_player insert/delete.
 *
 * Goes through the `recompute_lineup_cap` RPC (row-locks the lineup, then
 * SUMs + UPDATEs in one round trip) rather than a client-side SELECT-then-
 * UPDATE. The two-step version raced: two lineup_players mutations for the
 * same lineup in flight at once (e.g. an add on the Draft Market screen
 * still in flight — React Query doesn't cancel mutations on unmount — while
 * Player Detail fires its own add/remove) could let whichever SELECT ran
 * first still finish its UPDATE last, reverting total_cap_used to a stale,
 * too-low total. The lock makes the last writer always reflect every insert/
 * delete that had committed before it started.
 */
export async function recomputeLineupCap(lineupId: string): Promise<number> {
  const { data, error } = await supabase.rpc(
    'recompute_lineup_cap' as never,
    { p_lineup_id: lineupId } as never,
  );
  if (error) throw error;
  return Number(data);
}
