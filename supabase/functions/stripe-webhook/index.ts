import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Idempotency — skip if already processed
  const { data: existing } = await supabase
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .single();

  if (existing) {
    return new Response(JSON.stringify({ received: true, skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Record event
  await supabase.from('stripe_webhook_events').insert({
    stripe_event_id: event.id,
    type: event.type,
    payload: event as any,
    processed: false,
  });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const userId = pi.metadata.user_id;
        const amount = pi.amount / 100; // convert cents

        if (!userId) break;

        // Credit wallet
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance, total_deposited')
          .eq('user_id', userId)
          .single();

        if (!wallet) break;

        const newBalance = Number(wallet.balance) + amount;
        const newDeposited = Number(wallet.total_deposited) + amount;

        await supabase.from('wallets').update({
          balance: newBalance,
          total_deposited: newDeposited,
        }).eq('user_id', userId);

        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'deposit',
          amount,
          balance_after: newBalance,
          description: `Stripe deposit ${pi.id}`,
          stripe_payment_intent_id: pi.id,
          status: 'completed',
        });

        // Send notification
        await supabase.functions.invoke('send-notification', {
          body: {
            user_id: userId,
            type: 'deposit_confirmed',
            title: 'Deposit Successful!',
            body: `$${amount.toFixed(2)} has been added to your wallet.`,
          },
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const userId = pi.metadata.user_id;
        if (!userId) break;

        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'deposit',
          amount: pi.amount / 100,
          balance_after: 0,
          description: `Failed deposit ${pi.id}`,
          stripe_payment_intent_id: pi.id,
          status: 'failed',
        });
        break;
      }

      case 'transfer.created': {
        // Stripe Connect payout to user's bank
        const transfer = event.data.object as Stripe.Transfer;
        const userId = transfer.metadata?.user_id;
        if (!userId) break;

        await supabase.from('transactions').update({
          status: 'completed',
        }).eq('stripe_transfer_id', transfer.id).eq('user_id', userId);

        await supabase.functions.invoke('send-notification', {
          body: {
            user_id: userId,
            type: 'withdrawal_processed',
            title: 'Withdrawal Processed',
            body: `$${(transfer.amount / 100).toFixed(2)} is on its way to your bank.`,
          },
        });
        break;
      }
    }

    await supabase.from('stripe_webhook_events').update({
      processed: true,
      processed_at: new Date().toISOString(),
    }).eq('stripe_event_id', event.id);

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('Error handling webhook event:', err);

    await supabase.from('stripe_webhook_events').update({
      error: err.message,
    }).eq('stripe_event_id', event.id);

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
