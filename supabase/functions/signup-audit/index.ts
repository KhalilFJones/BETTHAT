// =============================================================================
// signup-audit — capture terms acceptance + IP + UA for legal defensibility.
// =============================================================================
// Client-side terms acceptance (signup.tsx checkbox) is captured here together
// with the server-observed IP and User-Agent, so we have an immutable record
// even if the client lies about either. Stored to public.signup_audit, keyed
// on the authenticated user.
//
// Auth: must be called with the user's JWT (default Edge Function behavior).
// We don't trust client-provided user_id — we read it from the verified JWT.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resp(405, { error: 'method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return resp(401, { error: 'missing authorization' });
  }

  // Identify the user via the verified JWT.
  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return resp(401, { error: 'invalid token' });

  let body: { terms_version?: string } = {};
  try { body = await req.json(); } catch { /* tolerate empty */ }

  const termsVersion = body.terms_version ?? '1.0';

  // Extract IP from common forwarded headers. CF / Cloudflare / Fly / Supabase
  // typically use x-forwarded-for; fall back to x-real-ip.
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip  = xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;

  const ua = req.headers.get('user-agent') ?? null;

  const svc = createClient(supabaseUrl, serviceKey);
  const { error } = await svc.from('signup_audit').insert({
    user_id: user.id,
    terms_version: termsVersion,
    ip_address: ip,
    user_agent: ua,
  });
  if (error) return resp(500, { error: error.message });

  return resp(200, { ok: true });
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
