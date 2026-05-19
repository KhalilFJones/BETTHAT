import { supabase } from '@/lib/supabase';

export interface DepositLimits {
  daily?: number | null;
  weekly?: number | null;
  monthly?: number | null;
}

export async function setDepositLimit(limits: DepositLimits): Promise<void> {
  // RPC name types regenerate post-migration.
  const { error } = await supabase.rpc(
    'set_deposit_limit' as never,
    {
      p_daily: limits.daily ?? null,
      p_weekly: limits.weekly ?? null,
      p_monthly: limits.monthly ?? null,
    } as never,
  );
  if (error) throw new Error(error.message);
}

/** One-way self-exclusion. Permanent excludes cannot be reversed by the user. */
export async function requestSelfExclusion(
  durationDays: number,
  permanent = false,
): Promise<void> {
  const { error } = await supabase.rpc(
    'request_self_exclusion' as never,
    { p_days: durationDays, p_permanent: permanent } as never,
  );
  if (error) throw new Error(error.message);
}
