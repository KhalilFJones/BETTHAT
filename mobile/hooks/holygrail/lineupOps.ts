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
 */
export async function recomputeLineupCap(lineupId: string): Promise<number> {
  const { data: rows, error } = await supabase
    .from('lineup_players')
    .select('frozen_price')
    .eq('lineup_id', lineupId);
  if (error) throw error;
  const total = (rows ?? []).reduce((s, r: any) => s + Number(r.frozen_price ?? 0), 0);
  await supabase
    .from('lineups')
    .update({ total_cap_used: total, updated_at: new Date().toISOString() })
    .eq('id', lineupId);
  return total;
}
