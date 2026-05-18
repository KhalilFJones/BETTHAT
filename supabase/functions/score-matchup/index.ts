// =============================================================================
// score-matchup — settles ready matchups by delegating to the `settle_matchup`
// SECURITY DEFINER RPC.
// =============================================================================
// Invocation modes:
//   - { matchup_id: "<uuid>" }  — settle exactly one matchup
//   - {}                         — sweep all live/matched matchups and try to
//                                  settle each (RPC returns 'not_ready' for
//                                  matchups whose games aren't final yet)
//
// All scoring math, fantasy-point aggregation, payout, and side-effects (wallet
// credits, profile stat updates, notifications) live inside the RPC.
//
// Auth: must be invoked with the service-role key (pg_cron, scheduled job, or
// admin tool). User JWTs are rejected.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  // Service-role only.
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${SERVICE_KEY}`) {
    return resp(401, { error: 'service role required' });
  }

  let body: { matchup_id?: string } = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine */ }

  if (body.matchup_id) {
    const { data, error } = await supabase.rpc('settle_matchup', {
      p_matchup_id: body.matchup_id,
    });
    if (error) return resp(500, { error: error.message });
    return resp(200, { result: data });
  }

  // Sweep mode.
  const { data: matchups, error: listErr } = await supabase
    .from('matchups')
    .select('id, status')
    .in('status', ['matched', 'live']);
  if (listErr) return resp(500, { error: listErr.message });

  const results: Array<{ id: string; result: string | null; error?: string }> = [];
  for (const m of matchups ?? []) {
    const { data, error } = await supabase.rpc('settle_matchup', {
      p_matchup_id: m.id,
    });
    if (error) {
      results.push({ id: m.id, result: null, error: error.message });
    } else {
      results.push({ id: m.id, result: data as string });
    }
  }
  return resp(200, { swept: results.length, results });
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
