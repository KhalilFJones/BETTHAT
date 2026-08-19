import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { MatchupSnapshot } from '@/components/social/SharedMatchupCard';

// =============================================================================
// The matchups a user can attach to a post — anything they're a participant in
// that has actually been placed. RLS already restricts this to their own
// matchups; the `.or()` is what picks the right side of each row.
// =============================================================================

export interface ShareableMatchup {
  id: string;
  status: string;
  game_date: string;
  payout_amount: number | null;
  user1_id: string;
  user2_id: string | null;
  l1: LineupSide | null;
  l2: LineupSide | null;
  u1: ProfileSide | null;
  u2: ProfileSide | null;
}

interface LineupSide {
  id: string;
  user_id: string;
  lineup_players: Array<{
    slot_number: number;
    nba_players: { id: string; full_name: string } | null;
  }>;
}

interface ProfileSide {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

const SHAREABLE_STATUSES = ['pending', 'matched', 'live', 'completed'];

export function useShareableMatchups(userId: string | undefined) {
  return useQuery({
    queryKey: ['shareable-matchups', userId],
    queryFn: async (): Promise<ShareableMatchup[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('matchups')
        .select(`
          id, status, game_date, payout_amount, user1_id, user2_id,
          l1:lineups!matchups_lineup1_id_fkey(id, user_id,
            lineup_players(slot_number, nba_players(id, full_name))),
          l2:lineups!matchups_lineup2_id_fkey(id, user_id,
            lineup_players(slot_number, nba_players(id, full_name))),
          u1:profiles!matchups_user1_id_fkey(id, username, display_name, avatar_url),
          u2:profiles!matchups_user2_id_fkey(id, username, display_name, avatar_url)
        `)
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .in('status', SHAREABLE_STATUSES)
        .order('game_date', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as ShareableMatchup[];
    },
    enabled: !!userId,
  });
}

/**
 * Flatten a matchup into the snapshot stored on the post.
 *
 * Only identity travels — who faced whom, in which slot. Fantasy points are
 * left out on purpose so SharedMatchupCard can read them live from the
 * world-readable player_game_stats instead of freezing them at post time.
 */
export function buildMatchupSnapshot(m: ShareableMatchup, meId: string): MatchupSnapshot | null {
  const iAmUser1 = m.user1_id === meId;
  const mine = iAmUser1 ? m.l1 : m.l2;
  const theirs = iAmUser1 ? m.l2 : m.l1;
  const opponent = iAmUser1 ? m.u2 : m.u1;
  if (!mine) return null;

  const bySlot = (side: LineupSide | null, slot: number) =>
    side?.lineup_players?.find((lp) => lp.slot_number === slot)?.nba_players ?? null;

  const slots = (mine.lineup_players ?? [])
    .slice()
    .sort((a, b) => a.slot_number - b.slot_number)
    .map((lp) => {
      const t = bySlot(theirs, lp.slot_number);
      return {
        slot: lp.slot_number,
        mine: { player_id: lp.nba_players?.id ?? '', name: lp.nba_players?.full_name ?? 'Unknown' },
        theirs: t ? { player_id: t.id, name: t.full_name } : null,
      };
    })
    .filter((s) => s.mine.player_id);

  return {
    matchup_id: m.id,
    game_date: m.game_date,
    format: `${slots.length} v ${slots.length}  Head to Head`,
    payout: Number(m.payout_amount ?? 0),
    opponent: opponent
      ? { id: opponent.id, username: opponent.display_name || opponent.username, avatar_url: opponent.avatar_url }
      : null,
    slots,
  };
}

/** Human label for the picker rows. */
export function matchupPhaseLabel(status: string, gameDate: string): string {
  if (status === 'completed') return 'Final';
  if (status === 'live') return 'Live now';
  if (status === 'pending') return 'Waiting for opponent';
  const today = new Date().toISOString().slice(0, 10);
  return gameDate > today ? 'Upcoming' : 'Matched';
}
