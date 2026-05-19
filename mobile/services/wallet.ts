// Thin RPC wrappers for wallet / payment flows.
// All real-money mutations go through server-side SECURITY DEFINER RPCs —
// no client code ever UPDATEs `wallets`, `profiles.*deposit*`, or `transactions`
// directly. See supabase/migrations/20260513000000_security_hardening_and_rpcs.sql.

import { supabase } from '@/lib/supabase';

export interface PaymentIntentResult {
  client_secret: string;
  payment_intent_id: string;
  customer_id: string;
  publishable_key: string;
}

export class EmailUnverifiedError extends Error {
  code = 'email_unverified' as const;
  constructor() {
    super('Please verify your email before depositing funds. Check your inbox for the confirmation link.');
  }
}

/** Creates a Stripe PaymentIntent. Client opens the Stripe payment sheet with the returned client_secret. */
export async function createPaymentIntent(amount: number): Promise<PaymentIntentResult> {
  const { data, error } = await supabase.functions.invoke<PaymentIntentResult & { error?: string }>(
    'create-payment-intent',
    { body: { amount } },
  );
  if (error) {
    // supabase-js stuffs non-2xx response bodies into FunctionsHttpError.context.
    // Try to read the json body for a typed code.
    const ctx: any = (error as any).context;
    let bodyText = '';
    try { bodyText = ctx?.body ? await ctx.body.text() : ''; } catch { /* noop */ }
    if (bodyText.includes('email_unverified')) {
      throw new EmailUnverifiedError();
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('no response from create-payment-intent');
  if ((data as any).error === 'email_unverified') {
    throw new EmailUnverifiedError();
  }
  return data;
}

export interface WithdrawalResult {
  withdrawal_request_id: string;
}

export async function requestWithdrawal(
  amount: number,
  payoutMethodId: string,
): Promise<WithdrawalResult> {
  // The RPC types are regenerated post-migration; until then, cast the name.
  const { data, error } = await supabase.rpc(
    'request_withdrawal' as never,
    { p_amount: amount, p_payout_method_id: payoutMethodId } as never,
  );
  if (error) throw new Error(error.message);
  return { withdrawal_request_id: data as unknown as string };
}
