import { supabase } from '@/lib/supabase';

export type StatCategory =
  | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers'
  | 'three_pointers' | 'pts_reb_ast' | 'pts_reb' | 'pts_ast' | 'reb_ast';

export type Side = 'OVER' | 'UNDER';

export interface CreateSidebetInput {
  playerId: string;
  statCategory: StatCategory;
  lineValue: number;
  side: Side;
  wagerAmount: number;
  reasoning?: string;
  targetUserId?: string;
}

export async function createSidebet(input: CreateSidebetInput): Promise<string> {
  // RPC name types regenerate post-migration.
  const { data, error } = await supabase.rpc(
    'create_sidebet' as never,
    {
      p_player_id: input.playerId,
      p_stat_category: input.statCategory,
      p_line_value: input.lineValue,
      p_creator_side: input.side,
      p_wager_amount: input.wagerAmount,
      p_creator_reasoning: input.reasoning ?? null,
      p_target_user_id: input.targetUserId ?? null,
    } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

export async function acceptSidebet(sidebetId: string): Promise<void> {
  const { error } = await supabase.rpc(
    'accept_sidebet' as never,
    { p_sidebet_id: sidebetId } as never,
  );
  if (error) throw new Error(error.message);
}
