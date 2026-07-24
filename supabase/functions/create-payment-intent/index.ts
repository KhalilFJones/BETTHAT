// =============================================================================
// create-payment-intent — creates a Stripe PaymentIntent for wallet deposit.
// =============================================================================
// Flow:
//   1. Client (authenticated) calls this function with { amount } in dollars.
//   2. We validate the user, RG limits, and KYC state if required.
//   3. Get (or create) the Stripe customer for this user.
//   4. Create a PaymentIntent with `metadata: { user_id }` so the webhook can
//      credit the correct wallet when the payment succeeds.
//   5. Return { client_secret, payment_intent_id, publishable_key }.
//
// The actual wallet credit happens server-side via the stripe-webhook handler
// (see `process_stripe_event` RPC). Clients never call credit_wallet directly.
// =============================================================================

import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia' as any,
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resp(405, { error: 'method not allowed' });

  // The function must be called with the user's JWT (default behavior — Edge
  // Functions verify JWT). We use that to identify them and then switch to the
  // service role for DB ops.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return resp(401, { error: 'missing authorization' });
  }

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return resp(401, { error: 'invalid token' });

  // Email-verification gate: deposits require a verified email. OAuth providers
  // (Google / Apple / Facebook) already return verified addresses, so this
  // mainly blocks fresh email/password signups that haven't clicked the
  // confirmation link yet.
  if (!user.email_confirmed_at) {
    return resp(403, {
      error: 'email_unverified',
      message: 'Please verify your email before depositing funds.',
    });
  }

  let body: { amount?: number } = {};
  try {
    body = await req.json();
  } catch {
    return resp(400, { error: 'invalid json' });
  }
  const amount = Number(body.amount);
  if (!amount || amount <= 0 || amount > 5000) {
    return resp(400, { error: 'amount must be 0 < amount <= 5000' });
  }

  const svc = createClient(supabaseUrl, serviceKey);

  // Eligibility check (mirrors user_can_play() in SQL).
  const { data: canPlay } = await svc.rpc('user_can_play', { p_user_id: user.id });
  if (canPlay !== true) {
    return resp(403, { error: 'user is not eligible to deposit' });
  }

  // BUG FIX: this file's own header comment says "we validate the user, RG
  // limits, and KYC state" but only user_can_play() (self-exclusion + state
  // restrictions) was ever actually checked — set_deposit_limit() lets a user
  // configure daily/weekly/monthly caps, but nothing anywhere enforced them,
  // so a self-imposed responsible-gaming deposit limit was silently a no-op.
  // Enforce it here, before a PaymentIntent (and a real Stripe charge) exists.
  const { data: rg } = await svc
    .from('responsible_gaming_settings')
    .select('daily_deposit_limit, weekly_deposit_limit, monthly_deposit_limit')
    .eq('user_id', user.id)
    .maybeSingle();

  if (rg) {
    const windows: Array<{ limit: number | null; label: string; sinceMs: number }> = [
      { limit: rg.daily_deposit_limit,   label: 'daily',   sinceMs: 24 * 3600 * 1000 },
      { limit: rg.weekly_deposit_limit,  label: 'weekly',  sinceMs: 7 * 24 * 3600 * 1000 },
      { limit: rg.monthly_deposit_limit, label: 'monthly', sinceMs: 30 * 24 * 3600 * 1000 },
    ];
    for (const w of windows) {
      if (w.limit == null) continue;
      const since = new Date(Date.now() - w.sinceMs).toISOString();
      const { data: rows } = await svc
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'deposit')
        .eq('status', 'completed')
        .gte('created_at', since);
      const priorTotal = (rows ?? []).reduce((s, r: any) => s + Number(r.amount), 0);
      if (priorTotal + amount > Number(w.limit)) {
        return resp(403, {
          error: 'deposit_limit_exceeded',
          message: `This deposit would exceed your ${w.label} deposit limit of $${Number(w.limit).toFixed(2)}.`,
        });
      }
    }
  }

  // Get or create the Stripe customer for this user.
  const { data: profile } = await svc
    .from('profiles')
    .select('stripe_customer_id, username')
    .eq('id', user.id)
    .maybeSingle();

  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id, username: profile?.username ?? '' },
    });
    customerId = customer.id;
    await svc.from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    customer: customerId,
    metadata: { user_id: user.id },
    automatic_payment_methods: { enabled: true },
  });

  return resp(200, {
    client_secret:      intent.client_secret,
    payment_intent_id:  intent.id,
    customer_id:        customerId,
    publishable_key:    publishableKey,
  });
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
