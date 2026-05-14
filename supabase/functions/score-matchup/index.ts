import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const RAKE_PCT = 0.035; // 3.5%

/**
 * Called by pg_cron or triggered by game-complete events.
 * Accepts: { matchup_id: string } or scores all live/pending-complete matchups.
 */
Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { matchup_id } = body;

  const query = supabase
    .from('matchups')
    .select(`
      *,
      creator_lineup:lineups!lineups_matchup_id_fkey(
        id,
        user_id,
        lineup_players(
          player_id,
          stats:player_game_stats(fantasy_points, is_final, game_id)
        )
      )
    `)
    .in('status', ['live', 'matched']);

  if (matchup_id) {
    query.eq('id', matchup_id);
  }

  const { data: matchups, error } = await query;
  if (error) return resp(500, { error: error.message });

  const results: any[] = [];

  for (const matchup of matchups ?? []) {
    try {
      const result = await scoreMatchup(matchup);
      results.push({ matchup_id: matchup.id, ...result });
    } catch (err: any) {
      results.push({ matchup_id: matchup.id, error: err.message });
    }
  }

  return resp(200, { processed: results.length, results });
});

async function scoreMatchup(matchup: any) {
  // lineups is an array of all lineups for this matchup
  const allLineups: any[] = Array.isArray(matchup.creator_lineup) ? matchup.creator_lineup : (matchup.creator_lineup ? [matchup.creator_lineup] : []);
  const creatorLineup = allLineups.find((l: any) => l.user_id === matchup.creator_id);
  const opponentLineup = allLineups.find((l: any) => l.user_id === matchup.opponent_id);

  const creatorPlayers = creatorLineup?.lineup_players ?? [];
  const opponentPlayers = opponentLineup?.lineup_players ?? [];

  const creatorScore = calcScore(creatorPlayers);
  const opponentScore = calcScore(opponentPlayers);
  const allFinal = checkAllFinal(creatorPlayers, opponentPlayers);

  // Always update scores
  const updatePayload: any = {
    creator_score: creatorScore,
    opponent_score: opponentScore,
    status: 'live',
  };

  if (allFinal) {
    const pot = Number(matchup.pot);
    const rake = pot * RAKE_PCT;
    const payout = pot - rake;

    let winner_id: string | null = null;
    let isDraw = false;

    if (creatorScore > opponentScore) {
      winner_id = matchup.creator_id;
    } else if (opponentScore > creatorScore) {
      winner_id = matchup.opponent_id;
    } else {
      isDraw = true; // split pot back
    }

    updatePayload.status = 'completed';
    updatePayload.winner_id = winner_id;
    updatePayload.rake_amount = isDraw ? 0 : rake;

    // Release escrow + pay out
    if (!isDraw && winner_id) {
      const loserId = winner_id === matchup.creator_id ? matchup.opponent_id : matchup.creator_id;
      await settleMatchup({ matchup, winner_id, loser_id: loserId, payout, rake });
    } else if (isDraw) {
      await refundMatchup({ matchup });
    }
  }

  await supabase.from('matchups').update(updatePayload).eq('id', matchup.id);

  return { creatorScore, opponentScore, allFinal };
}

function calcScore(lineupPlayers: any[]): number {
  let total = 0;
  for (const lp of lineupPlayers) {
    const stats = Array.isArray(lp.stats) ? lp.stats[0] : lp.stats;
    if (stats?.fantasy_points) total += Number(stats.fantasy_points);
  }
  return Math.round(total * 100) / 100;
}

function checkAllFinal(creatorPlayers: any[], opponentPlayers: any[]): boolean {
  const all = [...creatorPlayers, ...opponentPlayers];
  return all.length > 0 && all.every((lp) => {
    const stats = Array.isArray(lp.stats) ? lp.stats[0] : lp.stats;
    return stats?.is_final === true;
  });
}

async function settleMatchup({ matchup, winner_id, loser_id, payout, rake }: {
  matchup: any;
  winner_id: string;
  loser_id: string;
  payout: number;
  rake: number;
}) {
  // Release escrow for both users
  await releaseEscrow(matchup.creator_id, matchup.entry_fee);
  await releaseEscrow(matchup.opponent_id, matchup.entry_fee);

  // Credit winner
  const { data: walletData } = await supabase.from('wallets').select('balance').eq('user_id', winner_id).single();
  const newBalance = Number(walletData?.balance ?? 0) + payout;

  await supabase.from('wallets').update({
    balance: newBalance,
    total_earnings: supabase.rpc('increment_total_earnings' as any, { user_id: winner_id, amount: payout }),
  }).eq('user_id', winner_id);

  await supabase.from('transactions').insert([
    {
      user_id: winner_id,
      type: 'payout',
      amount: payout,
      balance_after: newBalance,
      description: `Won matchup ${matchup.id}`,
      status: 'completed',
      reference_id: matchup.id,
    },
    {
      user_id: loser_id,
      type: 'entry_fee',
      amount: -matchup.entry_fee,
      balance_after: 0,
      description: `Lost matchup ${matchup.id}`,
      status: 'completed',
      reference_id: matchup.id,
    },
  ]);

  // Update W/L records
  await supabase.rpc('increment_wins' as any, { p_user_id: winner_id });
  await supabase.rpc('increment_losses' as any, { p_user_id: loser_id });

  // Notifications
  const notifBase = { type: 'matchup_result', action_url: `/matchup/${matchup.id}` };
  await supabase.functions.invoke('send-notification', {
    body: {
      ...notifBase, user_id: winner_id, title: '🏆 You Won!',
      body: `You won $${payout.toFixed(2)} in your ${matchup.entry_tier} matchup!`,
    },
  });
  await supabase.functions.invoke('send-notification', {
    body: {
      ...notifBase, user_id: loser_id, title: 'Better luck next time!',
      body: `Your ${matchup.entry_tier} matchup is complete. Keep competing!`,
    },
  });
}

async function refundMatchup({ matchup }: { matchup: any }) {
  await releaseEscrow(matchup.creator_id, matchup.entry_fee);
  await releaseEscrow(matchup.opponent_id, matchup.entry_fee);

  for (const uid of [matchup.creator_id, matchup.opponent_id]) {
    const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', uid).single();
    const newBal = Number(w?.balance ?? 0) + matchup.entry_fee;
    await supabase.from('wallets').update({ balance: newBal }).eq('user_id', uid);
    await supabase.from('transactions').insert({
      user_id: uid, type: 'refund', amount: matchup.entry_fee,
      balance_after: newBal, description: `Draw refund matchup ${matchup.id}`,
      status: 'completed', reference_id: matchup.id,
    });
  }
}

async function releaseEscrow(userId: string, amount: number) {
  const { data: w } = await supabase.from('wallets').select('escrow_balance').eq('user_id', userId).single();
  const newEscrow = Math.max(0, Number(w?.escrow_balance ?? 0) - amount);
  await supabase.from('wallets').update({ escrow_balance: newEscrow }).eq('user_id', userId);
}

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
