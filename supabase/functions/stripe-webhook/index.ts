// =============================================================================
// Stripe webhook handler — thin pass-through to process_stripe_event RPC.
// =============================================================================
// All idempotency, atomicity, and business-logic dispatching happens inside the
// `process_stripe_event` SECURITY DEFINER RPC. This function:
//   1. Verifies the Stripe signature.
//   2. Forwards (event_id, event_type, payload) to the RPC.
//   3. Returns 200 for known + duplicate + ignored events so Stripe stops
//      retrying; returns 4xx/5xx only on signature failure or DB errors.
//
// Configure the webhook secret as a Supabase Functions secret:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// =============================================================================

import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resp(405, { error: 'method not allowed' });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return resp(400, { error: 'missing stripe-signature' });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return resp(400, { error: 'invalid signature' });
  }

  try {
    const { data, error } = await supabase.rpc('process_stripe_event', {
      p_event_id: event.id,
      p_event_type: event.type,
      p_payload: event as unknown as Record<string, unknown>,
    });
    if (error) {
      console.error('[stripe-webhook] rpc error:', error);
      return resp(500, { error: error.message });
    }
    return resp(200, { result: data });
  } catch (err: any) {
    console.error('[stripe-webhook] unexpected error:', err);
    return resp(500, { error: err?.message ?? 'unknown' });
  }
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
