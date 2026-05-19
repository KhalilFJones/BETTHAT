# BETTHAT — Audit Report (cliff_dev)

**Audit basis:** static read of every SQL migration, every Edge Function, and the React Native mobile source on `cliff_dev` at SHA `ab340ba…`. No code was executed; no live DB queries were run against the BettThat Supabase project beyond a `list_tables` summary. No tests exist to verify runtime behavior.

**Headline:** the app does not function end-to-end today. Several CRITICAL RLS holes let any authenticated user mint money, self-verify KYC, un-self-exclude, and hijack other users' sidebets. The Stripe webhook handler references columns that don't exist (insert fails on first delivery). The `score-matchup` Edge Function references columns and FKs that don't exist (matchups can never settle). The mobile app's matchup/sidebet/wallet flows write to columns that don't exist or violate enabled RLS. The dynamic pricing engine described in the locked spec is not implemented anywhere — prices only decay. The client lineup builder uses 5 player slots; the schema and spec say 3. None of these are subtle: each is a hard fail on first real user.

**Severity counts:**
- CRITICAL: 20
- HIGH: 32
- MEDIUM: 22
- LOW: 10

Coverage caveats are listed at the end.

---

## CRITICAL — real-money / game-integrity / hard-broken flows

### C-1 — `wallets_update_own` lets a user UPDATE their own balance
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`
**Policy:** `CREATE POLICY "wallets_update_own" ON public.wallets FOR UPDATE USING (auth.uid() = user_id);`
**Impact:** Any authenticated user can run `UPDATE public.wallets SET balance = 999999 WHERE user_id = auth.uid()`. Unlimited money creation. The mobile app currently relies on this (it directly updates `wallets.balance` from `deposit.tsx`, `withdraw.tsx`, `matchup/create.tsx`, `sidebet/create.tsx`, `sidebet/[id].tsx`).
**Fix:** Drop the UPDATE policy. Expose `SECURITY DEFINER` RPCs only: `credit_wallet`, `debit_wallet`, `move_to_escrow`, `release_escrow`. Each does the mutation atomically using `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 AND balance + $1 >= 0` (uses optimistic increment, not read-modify-write).

### C-2 — `profiles_update_own` lets a user set their own wins/earnings/ban/KYC/state
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`
**Policy:** `CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);`
**Impact:** User can self-set `total_wins`, `total_losses`, `total_earnings`, `rank_tier`, `is_banned = false`, `kyc_status = 'verified'` (set on profile, separate from `user_kyc` row), `state` (geo bypass), `referred_by` (claim referral bonus), `total_sidebets_won`, `total_entries`, `terms_accepted_at`, `tutorial_completed`, `total_deposited`, `total_withdrawn`, `pending_withdrawal`, `lifetime_winnings`, `stripe_customer_id`. Leaderboards, ranks, bans, KYC, and geo-restriction are all defeatable.
**Fix:** Replace blanket UPDATE policy with `WITH CHECK` constraints, or use a BEFORE UPDATE trigger that resets protected columns to OLD values unless `current_setting('role')` is service_role. Concretely:
```sql
CREATE OR REPLACE FUNCTION lock_protected_profile_cols() RETURNS TRIGGER AS $$
BEGIN
  NEW.total_wins        := OLD.total_wins;
  NEW.total_losses      := OLD.total_losses;
  NEW.total_earnings    := OLD.total_earnings;
  NEW.rank_tier         := OLD.rank_tier;
  NEW.is_banned         := OLD.is_banned;
  NEW.kyc_status        := OLD.kyc_status;
  NEW.state             := OLD.state;     -- locked after onboarding; re-issue via support
  NEW.referred_by       := OLD.referred_by;
  NEW.total_sidebets_won := OLD.total_sidebets_won;
  NEW.total_sidebets_lost := OLD.total_sidebets_lost;
  NEW.total_entries     := OLD.total_entries;
  NEW.last_active_at    := OLD.last_active_at;
  RETURN NEW;
END$$ LANGUAGE plpgsql;
CREATE TRIGGER profiles_protect_cols BEFORE UPDATE ON public.profiles
  FOR EACH ROW WHEN (current_setting('request.jwt.claim.role', true) <> 'service_role')
  EXECUTE FUNCTION lock_protected_profile_cols();
```

### C-3 — `user_kyc.kyc_update_own` lets a user self-set `status = 'verified'`
**File:** `supabase/migrations/20250101000001_betthat_schema_addendum.sql`
**Policy:** `CREATE POLICY "kyc_update_own" ON public.user_kyc FOR UPDATE USING (auth.uid() = user_id);`
**Impact:** KYC bypass. The whole KYC table becomes performative.
**Fix:** Remove UPDATE policy. KYC writes only via service-role from the KYC provider webhook (Persona/Stripe Identity callback) into a `process_kyc_event(...)` RPC. Same for `profiles.kyc_status` (see C-2).

### C-4 — `responsible_gaming_settings` UPDATE lets a user un-self-exclude and raise their own limits
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`
**Policy:** `CREATE POLICY "rg_update_own" ON public.responsible_gaming_settings FOR UPDATE USING (auth.uid() = user_id);`
**Impact:** Self-exclusion is a regulatory commitment (and in some jurisdictions a legal one); user can flip `self_excluded_until` to NULL and resume. Same for daily/weekly/monthly deposit and loss limits — user raises their own limit and bypasses harm-reduction. Compliance violation.
**Fix:** Drop UPDATE policy. RPCs only: `set_deposit_limit(daily, weekly, monthly)`, `set_loss_limit(...)`, `request_self_exclusion(days)`. Limit *increases* are queued with a cooling-off period (24–72h depending on jurisdiction); decreases apply immediately. Self-exclusion is one-way (can only end after `self_excluded_until` elapses naturally, server-side).

### C-5 — `sidebets_update_accept` lets ANY non-creator UPDATE the entire row
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`
**Policy:** `CREATE POLICY "sidebets_update_accept" ON public.sidebets FOR UPDATE USING (status = 'open' AND auth.uid() != creator_id);`
**Impact:** Sidebet hijacking. Any non-creator can update `wager_amount`, `line_value`, `creator_side`, `winner_id`, `payout_amount`, `status`, `is_open`. They can: rewrite the bet, force themselves as winner, or set payout to $999,999.
**Fix:** Drop policy. Expose `accept_sidebet(sidebet_id uuid)` RPC that atomically — in one transaction — sets `opponent_id = auth.uid()`, `status = 'matched'`, and escrows the wager from caller's wallet (via `move_to_escrow`).

### C-6 — `lineup_players_insert_own` lets a user set `frozen_price` to anything
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`
**Policy:** insert allowed if the parent lineup belongs to caller and is `building`. The `frozen_price` column is user-supplied — there is **no** check that it matches `player_prices.current_price` at insert time.
**Impact:** Pick 3 superstars at `frozen_price = $0.01` each, fit any salary cap, run the strongest possible lineup at the lowest tier. Total game-integrity collapse.
**Fix:** Drop INSERT policy. `submit_lineup(entry_tier, player_ids uuid[])` RPC snapshots `player_prices.current_price` server-side, validates `SUM(frozen_price) BETWEEN min_cap AND salary_cap` (from `entry_tier_caps`), and inserts all three `lineup_players` atomically. Schema: consider making `frozen_price` revoke-default (`GRANT SELECT ON lineup_players TO authenticated; REVOKE INSERT, UPDATE ON lineup_players FROM authenticated;`).

### C-7 — `lineups_insert_own` doesn't enforce wallet deduction
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`
**Policy:** insert allowed if `user_id = auth.uid()`. `entry_tier` is user-supplied; nothing in the insert path debits the wallet.
**Impact:** User inserts an `$50` lineup row without ever paying $50. They get matched, their opponent escrows real money, they risk zero. Free upside.
**Fix:** Drop INSERT policy. `submit_lineup_and_match(entry_tier numeric, player_ids uuid[])` RPC must, in one transaction: (1) verify `wallet.balance >= entry_fee` and not self-excluded, (2) escrow `entry_fee`, (3) insert `lineups` row, (4) insert `lineup_players` with server-set frozen prices, (5) attempt FIFO match against an open matchup, else create one and enqueue.

### C-8 — `payout_methods` UPDATE lets a user self-set `is_verified = true`
**File:** `supabase/migrations/20250101000003_betthat_production_gaps.sql`
**Policy:** `CREATE POLICY "payout_methods_update_own" ON public.payout_methods FOR UPDATE USING (auth.uid() = user_id);`
**Impact:** Create a fake payout method, flip `is_verified` to true, withdraw. Direct fraud path.
**Fix:** Remove UPDATE policy. Verification is written only by service-role after Plaid/Stripe Identity confirmation. User-facing UI to manage payout methods uses RPCs (`add_payout_method`, `remove_payout_method`, `set_default_payout_method`).

### C-9 — `profiles.state` is user-writable; state restrictions are bypassable
**Files:** `mobile/app/(auth)/onboarding.tsx` writes `profiles.state`; `profiles_update_own` (mig 1) lets user update it freely later.
**Impact:** User signs up in NY (blocked), picks AZ at onboarding, plays normally. Or in NY, edits profile later to flip state with no consequence. State-restriction enforcement (geo-blocking) is enforced nowhere server-side; the table exists but isn't gated against.
**Fix:** Lock `state` after onboarding via the protected-cols trigger from C-2. State changes require a support ticket flow (re-KYC, optional IP geo-check). All real-money operations (`submit_lineup`, `accept_sidebet`, `request_withdrawal`) must read `state_restrictions WHERE state_code = profiles.state` and refuse if `is_allowed = false`.

### C-10 — `stripe-webhook/index.ts` references columns that don't exist
**File:** `supabase/functions/stripe-webhook/index.ts`
- ~line 35: `.from('stripe_webhook_events').select('id').eq('stripe_event_id', event.id).single()` — `.single()` throws on 0 rows. First-ever event raises an error before recording.
- ~line 44–48: insert uses `{ stripe_event_id, type, payload, processed: false }`. Schema columns are `event_type`, `payload`, `status` (text enum). No `type` column, no `processed` boolean. Insert fails.
- ~line 113–115: update uses `{ processed: true, processed_at }`. Schema has `status`, no `processed`. Fails.
- ~line 124: update uses `{ error: err.message }`. Schema has `error_message`. Fails.
**Impact:** First Stripe webhook delivery throws on `.single()`. If you bypass that with `.maybeSingle()`, the INSERT fails on missing columns. **The webhook handler is non-functional. No deposit ever credits a wallet via the real Stripe flow.** Stripe will retry forever, and the schema's intended idempotency machinery is unused.
**Fix:** Rename: `type → event_type`, `processed → status` (with values `'pending'|'processed'|'failed'|'ignored'`), `error → error_message`. Use `.maybeSingle()`. Better: see C-11 — one RPC.

### C-11 — `stripe-webhook` idempotency + business logic are not atomic
**File:** `supabase/functions/stripe-webhook/index.ts`
**Flow:** SELECT existing → INSERT event → switch (credit wallet, insert transaction, send notification) → UPDATE status. Each step is a separate `await`; no transaction.
**Impact:** Two concurrent webhook deliveries (Stripe retries) can both pass the SELECT check; one wins the INSERT (UNIQUE on `stripe_event_id`), but business logic may have already partially run twice → double credit.
**Fix:** Single `SECURITY DEFINER` RPC `process_stripe_event(event_id text, event_type text, payload jsonb)` that does INSERT … ON CONFLICT (stripe_event_id) DO NOTHING and uses the affected row count to decide whether to process. All wallet/transaction writes inside the same transaction.

### C-12 — `stripe-webhook` wallet credit is read-modify-write
**File:** `supabase/functions/stripe-webhook/index.ts` ~lines 60–77
Reads `wallet.balance`, computes `newBalance`, UPDATEs. Concurrent matchup-payout + deposit can both read stale balance and overwrite each other → lost money.
**Fix:** Same RPC as C-11: `UPDATE wallets SET balance = balance + $1, total_deposited = total_deposited + $1 WHERE user_id = $2 RETURNING balance;` — atomic increment, never read-modify-write.

### C-13 — `stripe-webhook` `transactions` insert is missing `wallet_id`
**File:** `supabase/functions/stripe-webhook/index.ts` ~lines 79–85
Schema: `transactions.wallet_id UUID NOT NULL`. Insert omits it. Fails on NOT NULL.
**Fix:** Look up `wallet.id` and include in insert (or do it inside the RPC).

### C-14 — `score-matchup/index.ts` references columns and FKs that don't exist
**File:** `supabase/functions/score-matchup/index.ts`
- `select('… creator_lineup:lineups!lineups_matchup_id_fkey(…)')` — there is **no** FK `lineups.matchup_id` in the schema. Matchups reference lineups via `matchups.lineup1_id` / `matchups.lineup2_id`, the opposite direction. Query fails.
- Uses `matchup.creator_id` and `matchup.opponent_id` — schema columns are `user1_id` and `user2_id`. Wrong column names.
- Uses `matchup.pot` — schema is `pot_amount`.
- Uses `matchup.entry_fee` — no such column. Schema has `entry_tier` and `pot_amount`.
- Uses `wallet.total_earnings` — `wallets` has no such column. `profiles.total_earnings` exists but it's a different table.
- Calls `supabase.rpc('increment_total_earnings' as any, …)`, `rpc('increment_wins')`, `rpc('increment_losses')` — none of these RPCs are defined in any migration.
- `supabase.from('wallets').update({ total_earnings: supabase.rpc(...) })` — assigning a Promise to a column. Invalid.
**Impact:** `score-matchup` is non-functional. No matchup ever resolves. Entry fees stay locked in escrow forever. **Live games cannot pay out.**
**Fix:** Rewrite the function. Move all logic into a `settle_matchup(matchup_id uuid)` SECURITY DEFINER RPC that: aggregates fantasy points from `player_game_stats` via `lineup_players → lineups → matchups`, checks `is_final`, computes payout (`pot_amount - rake_amount`), credits winner via atomic UPDATE, inserts paired transactions, updates `profiles.total_wins`/`losses`/`total_earnings`, in one transaction. Schedule via pg_cron or invoke from a game-final webhook.

### C-15 — `mobile/app/matchup/create.tsx` writes to columns that don't exist and uses wrong types
**File:** `mobile/app/matchup/create.tsx`
- Insert into `lineups`: keys `salary_cap`, `total_salary`, `entry_tier: \`$${entryFee}\`` (string). Schema has `total_cap_used` (not `total_salary`), no `salary_cap` column, and `entry_tier DECIMAL(6,2)` (not text). Insert fails or coerces wrong.
- Insert into `lineup_players`: keys `slot_position` (text e.g. `'PG'`), `price_at_selection`. Schema columns are `slot_number INT BETWEEN 1 AND 3` and `frozen_price`. Names and types don't match. Insert fails.
- Query into `matchups`: `.eq('entry_tier', \`$${entryFee}\` as ...)` — column is DECIMAL, value is string. `.neq('creator_id', ...)`, `.is('opponent_id', null)` — columns are `user1_id`/`user2_id`.
- Insert into `matchups`: keys `creator_id`, `entry_fee`, `pot` — none exist.
- Update `matchups`: keys `opponent_id`, `pot`, `rake_amount` — `pot` doesn't exist.
- Direct UPDATE on `wallets` (re C-1).
**Impact:** Entire matchup-create flow is broken end-to-end. Either an early insert fails and the user sees the generic 'error' phase, or RLS denies the matchup INSERT silently (see H-6). Either way, no matchups exist.
**Fix:** Replace the entire `submitLineup.mutationFn` body with a single call to `submit_lineup_and_match` RPC (see C-7). Client passes player IDs + tier; RPC returns matchup_id.

### C-16 — `mobile/app/wallet/deposit.tsx` directly credits wallet from the client ("Simulate Deposit")
**File:** `mobile/app/wallet/deposit.tsx` ~lines 40–58
The "Simulate Deposit" button reads wallet, computes newBal, UPDATEs wallets, inserts a transaction — directly from client. This is exactly the C-1 vulnerability used intentionally for dev. **In production this is your live free-money button.**
**Fix:** Remove the simulate path. Real flow must be: client → `create-payment-intent` Edge Function → Stripe SDK payment sheet → user pays → Stripe webhook (server) → atomic wallet credit. Client never directly modifies balance.

### C-17 — `mobile/app/wallet/withdraw.tsx` directly debits wallet from the client
**File:** `mobile/app/wallet/withdraw.tsx` ~lines 21–34
Same anti-pattern. Plus inserts a 'pending' transaction with no `wallet_id`, no `withdrawal_requests` row, no KYC check, no responsible-gaming check, no payout-method check. Min withdrawal hard-coded $5 vs `app_config.min_withdrawal = 10.00` (drift).
**Fix:** Replace with `request_withdrawal(amount, payout_method_id)` RPC that checks: KYC verified, amount ≥ app_config.min_withdrawal, `wallet.balance ≥ amount`, payout_method.is_verified, not self-excluded, RG limits — then atomically debits balance, inserts a `withdrawal_requests` row with `status='pending'`, inserts a pending transaction with `wallet_id`. The Stripe transfer/payout completes the workflow via webhook.

### C-18 — `mobile/app/sidebet/create.tsx` writes wrong column names + direct escrow
**File:** `mobile/app/sidebet/create.tsx`
- Insert into `sidebets`: keys `prop_type`, `prop_line`. Schema columns are `stat_category` and `line_value`. Insert fails.
- Direct UPDATE on `wallets` for escrow (re C-1).
- Game lookup `.or('home_team_id.eq.X,away_team_id.eq.X')` — depends on `nba_players.team_id` being populated. Migration #2 added the column but no migration backfills it from `team_abbreviation`. Until imports set both, lookup returns empty and "No upcoming game" fires.
**Fix:** `create_sidebet(player_id, stat_category, line_value, side, wager)` RPC that handles game lookup, escrow, and insert atomically.

### C-19 — `mobile/app/sidebet/[id].tsx` accept flow uses wrong columns and direct escrow
**File:** `mobile/app/sidebet/[id].tsx` accept mutation
- `update({ acceptor_id: profile.id, status: 'matched' })` — schema column is `opponent_id`, not `acceptor_id`.
- Direct UPDATE on `wallets` for escrow (re C-1).
**Impact:** Even if RLS allowed it (it does — see C-5), the update writes to a non-existent column → fails. Combined with C-5's hijack policy, this is a fortress of bugs.
**Fix:** `accept_sidebet(sidebet_id)` RPC. Client makes one call.

### C-20 — `matchmaking_queue` insert policy doesn't verify lineup ownership
**File:** `supabase/migrations/20250101000002_betthat_performance_and_gaps.sql`
**Policy:** `CREATE POLICY "queue_insert_own" ON public.matchmaking_queue FOR INSERT WITH CHECK (auth.uid() = user_id);`
Checks `user_id` but not that `lineup_id` belongs to caller. A malicious user could queue someone else's lineup (UNIQUE `lineup_id` would then block the rightful owner from queueing).
**Fix:** `WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid()))`. Better: write into queue via RPC only.

---

## HIGH — security, correctness, broken flows

### H-1 — `send-notification` preference check is silently broken
**File:** `supabase/functions/send-notification/index.ts` ~lines 30–33
`const prefKey = type as keyof typeof prefs; if (prefs[prefKey] === false) return resp(200, { skipped: true });`
`type` is `'matchup_found'`, `'deposit_confirmed'`, etc. The actual columns are `push_matchup_found`, `push_deposit_confirmed`, etc. `prefs['matchup_found']` is always undefined → check never trips → opt-outs are ignored.
**Fix:** Lookup `prefs['push_' + type]` with an explicit allow-list mapping.

### H-2 — `send-notification` has no auth gate
**File:** `supabase/functions/send-notification/index.ts`
The function accepts `{ user_id, type, title, body }` from any caller. Supabase Edge Functions verify JWT by default, but the function doesn't inspect the JWT to ensure it's service-role (internal call only) — an authenticated user could call it and push arbitrary content to any other user.
**Fix:** Check `req.headers.get('Authorization')` against `SUPABASE_SERVICE_ROLE_KEY` directly, OR validate that the caller's JWT claims include `role: 'service_role'`. Reject end-user calls.

### H-3 — `send-notification` reads `profiles.push_token`; the multi-device tokens table is unused
**File:** `supabase/functions/send-notification/index.ts` ~lines 50–55
Migration 2 added `push_notification_tokens` for multi-device support. This function still reads single-token `profiles.push_token`. Tablet + phone user only gets pushes on whichever device wrote last.
**Fix:** `SELECT token FROM push_notification_tokens WHERE user_id = $1 AND is_active = TRUE` and send to each.

### H-4 — `sync_user_search` trigger is not SECURITY DEFINER → all profile updates fail
**File:** `supabase/migrations/20250101000001_betthat_schema_addendum.sql`
`sync_user_search()` runs AFTER INSERT/UPDATE on `profiles` and writes to `user_search`. `user_search` has RLS enabled with only a `SELECT` policy. The trigger runs as the caller's role → INSERT/UPDATE on `user_search` is denied by RLS → trigger raises → parent profile UPDATE rolls back.
**Impact:** User cannot update their profile (onboarding completion writes `username`, `display_name`, `state`). Onboarding is currently blocked.
**Fix:** `CREATE OR REPLACE FUNCTION public.sync_user_search() RETURNS TRIGGER ... SECURITY DEFINER SET search_path = public, pg_temp;`

### H-5 — Trigger functions in `public` lack `SET search_path`
**Files:** all migrations. `handle_updated_at`, `sync_user_search` (also H-4), `handle_new_user` (has it), `handle_new_user_v2`/`v3` (have it).
Hardening practice: every function in `public` should `SET search_path = pg_temp` or `public, pg_temp` to mitigate search-path-hijack vulnerabilities (CVE-class).
**Fix:** `ALTER FUNCTION public.handle_updated_at() SET search_path = pg_temp;` etc.

### H-6 — `matchups` has no INSERT/UPDATE policies but client INSERTs/UPDATEs
**File:** `supabase/migrations/20250101000000_betthat_initial_schema.sql`; `mobile/app/matchup/create.tsx`
`matchups` has RLS enabled and only SELECT policies. Client-side INSERT/UPDATE from `matchup/create.tsx` should fail with "permission denied". Either the create flow has never been exercised against the live DB, or it's failing silently.
**Fix:** Do not add client INSERT/UPDATE policies. Move matchup mutations entirely behind `submit_lineup_and_match`, `cancel_matchup`, `settle_matchup` RPCs that run as service_role.

### H-7 — Lineup slot count mismatch: client says 5, schema/spec say 3
**Files:**
- Spec: "3v3 lineup validation (exactly 3 players)".
- Schema: `lineup_players.slot_number BETWEEN 1 AND 3`. `entry_tier_caps` configured for 3 players.
- Client: `mobile/stores/lineup.store.ts` defines 5 slots (PG/SG/SF/PF/C). `mobile/app/(tabs)/lineup.tsx` checks `filledSlots === 5` to enable submit.
**Impact:** Client tries to submit 5 players to a 3-row table that names columns differently anyway (C-15). 100% blocked.
**Fix:** Bring client to 3-player lineup. Decide whether positions are constrained (PG/SG/SF? Any 3?). If positions are unconstrained, drop the per-slot position from the store; `slot_number` is just 1/2/3. If constrained, encode allowed combinations.

### H-8 — Pricing engine: locked spec formula is NOT IMPLEMENTED
**Spec:** `price_delta = (demand * 0.35) + ((base - current) * 0.008) + (velocity * 0.3) + noise`. Hard floor 60% / ceiling 180%. Cold-start cap 8–10× multiplier, sqrt friction curve at low user counts. Demand upward-only on acceleration. No synthetic demand.
**Actual:** The only pricing logic is the `decay-price-velocity` pg_cron job (every 5 min) in migration 3, which multiplicatively decays `price_velocity`, `price_acceleration`, and decrements `demand_count_1h` by 1. **There is no `price_delta` computation anywhere. There is no increase in price ever.** No selection-driven demand is recorded. `total_selections` exists on `player_prices` but is never written.
**Compliance impact:** The skill-game legal classification relies on emergent, demand-driven pricing — which doesn't exist. Currently the only price movement is monotonic decay toward floor.
**Fix:** Implement the pricing engine as a SECURITY DEFINER RPC `tick_player_prices()` (or new `price-engine` Edge Function) that for each unlocked player:
1. Reads `current_price`, `base_price`, `price_velocity`, `demand_count_1h`.
2. Computes `demand_force = upward_only(demand_count_1h_this_tick * 0.35)`.
3. Computes `gravity = (base_price - current_price) * 0.008` (mean reversion).
4. Computes `velocity_term = price_velocity * 0.3`.
5. Adds Gaussian noise (small).
6. Applies cold-start cap (`min(demand_force, 8 * sqrt(active_users)) — friction curve at low N`).
7. Clamps the new price to `[base * 0.60, base * 1.80]` (already columns).
8. Writes back; inserts a `price_history` row.
And track per-selection demand by inserting into a counter on `lineup_players` insert (server-side, via the same RPC that handles `submit_lineup`).

### H-9 — Salary cap: spec ($500) vs schema ($45–$180)
**Spec:** "$500 salary cap enforcement".
**Schema:** `entry_tier_caps` seeds caps $45/$75/$105/$135/$180 by tier; min $12/$25/$40/$55/$75.
With 3 players, a $500 cap implies avg $166/player — possible but inconsistent with seeded values and with `player_prices.base_price_range` from `price_engine_config` ($5–$80). **Needs human resolution.** Treating as HIGH because cap correctness gates the entire game.
**Fix:** Confirm with product. Either update spec text to reflect tier-based caps, or revise `entry_tier_caps` to match a $500 unified cap and adjust the base-price ranges accordingly.

### H-10 — `stripe-webhook` ignores refunds, disputes, chargebacks
**File:** `supabase/functions/stripe-webhook/index.ts`
Only handles `payment_intent.succeeded`, `payment_intent.payment_failed`, `transfer.created`. No handler for `charge.refunded`, `charge.dispute.created`, `charge.dispute.funds_withdrawn`, `payment_intent.canceled`, `account.updated`. Disputed funds are debited from your Stripe balance but never debited from the user's wallet → free money via chargeback.
**Fix:** Add cases for `charge.refunded` (debit `lifetime_winnings` and balance, audit), `charge.dispute.created` (freeze wallet via flag, halt withdrawals), `charge.dispute.funds_withdrawn` (debit balance, write audit), `charge.dispute.closed` (un-freeze on close-for-merchant, hold on close-for-customer). Maintain an `admin_audit_log` entry for each.

### H-11 — `stripe-webhook` calls `send-notification` synchronously inside the handler
**File:** `supabase/functions/stripe-webhook/index.ts`
`await supabase.functions.invoke('send-notification', …)` is inside the webhook handler. Expo push API can take seconds → handler can exceed Stripe's 10s timeout → Stripe retries → idempotency must catch it (currently broken per C-10/C-11) → double credit risk.
**Fix:** Don't await notification sends in the webhook. Insert a row into `notifications` and let a pg_cron worker (or `notifications_unsent_push` partial index, already created) drive the push fan-out.

### H-12 — `stripe-webhook` `transfer.created` handler doesn't actually settle withdrawal
**File:** `supabase/functions/stripe-webhook/index.ts` ~lines 91–104
Just `.update({ status: 'completed' }).eq('stripe_transfer_id', transfer.id)`. No wallet/`pending_withdrawal` adjustment, no `withdrawal_requests` status update. The withdrawal was speculatively debited client-side (C-17), so the bookkeeping is already incorrect by the time this fires.
**Fix:** Real flow: `request_withdrawal` RPC moves balance → `pending_withdrawal`. On `transfer.created` (or `transfer.paid`), zero out `pending_withdrawal` for the matched user, mark `withdrawal_requests.status = 'completed'`, mark transaction `status = 'completed'`. On `transfer.failed`, return funds to balance.

### H-13 — Realtime subscription does not clean up between focuses
**File:** `mobile/app/matchup/[id].tsx`, `mobile/app/sidebet/[id].tsx`
`supabase.channel(...).subscribe()` + `supabase.removeChannel(channel)` is OK on unmount. But if the user navigates away and returns to the same screen (back nav with stack preservation), or hot-reloads, the same channel can be opened twice.
**Fix:** Guard channel creation by id, or use `expo-router`'s `useFocusEffect` to subscribe/unsubscribe on focus rather than mount.

### H-14 — No realtime subscription to wallet/profile
**File:** `mobile/hooks/useAuth.ts`
Deposit → webhook → wallet credited server-side → client shows stale balance until manual refetch. Same for profile (wins/losses after matchup settle).
**Fix:** Subscribe to `wallets WHERE user_id = me` and `profiles WHERE id = me` UPDATE events; invalidate the relevant React Query keys.

### H-15 — `useAuth.fetchUserData` uses `.single()` — race on signup
**File:** `mobile/hooks/useAuth.ts` lines ~33–37
`.single()` throws when 0 rows. If `handle_new_user` trigger races with the immediate fetch, errors.
**Fix:** `.maybeSingle()`.

### H-16 — `mobile/app/wallet/withdraw.tsx` min $5 ≠ `app_config.min_withdrawal` $10
**File:** `mobile/app/wallet/withdraw.tsx` line 16. Already covered partially in C-17.
**Fix:** Drive from `app_config` (or honor whichever the product team chooses; remove the conflict).

### H-17 — `mobile/lib/database.types.ts` is likely stale
**Status:** intentionally not read due to 31 KB size.
Given that Edge Functions and screens reference columns that don't exist (C-10, C-14, C-15, C-18, C-19, H-25, H-26), the generated types either lag the migrations or are loose enough to compile mismatches.
**Fix:** Regenerate after schema fixes: `supabase gen types typescript --project-id tynhpwljqmxakcqfxsxt > mobile/lib/database.types.ts`. Re-audit.

### H-18 — `signup.tsx` does not record terms acceptance, IP, user-agent
**File:** `mobile/app/(auth)/signup.tsx`
Real-money apps must capture terms-acceptance version + timestamp + IP/UA at signup for legal defensibility. `profiles.terms_accepted_at` and `terms_version` exist (migration 3) but are never set.
**Fix:** Add a checkbox at signup. Insert/update `profiles.terms_accepted_at = now()`, `terms_version = $current_terms_version` (read from `app_config`), and record IP/UA into a new `signup_audit` table or `admin_audit_log`.

### H-19 — Email verification not enforced
**File:** `mobile/app/(auth)/signup.tsx`
`supabase.auth.signUp({ email, password })` with no `emailRedirectTo` and no client-side gate. Depends entirely on the Supabase project's auth settings.
**Fix:** Confirm email confirmations are required at the auth-settings layer. Gate `submit_lineup`, `request_withdrawal`, deposit on `auth.users.email_confirmed_at IS NOT NULL`.

### H-20 — Hard-coded state list in onboarding
**File:** `mobile/app/(auth)/onboarding.tsx` lines 14–29
`US_STATES` is hard-coded. `state_restrictions` (51 seeded rows) is the source of truth.
**Fix:** `SELECT state_code, state_name FROM state_restrictions WHERE is_allowed = true ORDER BY state_name;` to populate.

### H-21 — Age calc has timezone edge case
**File:** `mobile/app/(auth)/onboarding.tsx` line 50
`new Date(\`${y}-${m}-${d}\`)` parses as UTC midnight; for PT-zone users at edge dates, age computes off by a day.
**Fix:** `new Date(year, month - 1, day)` (local), and compare with explicit year/month/day arithmetic.

### H-22 — `useState(() => …)` misused as effect in lineup screen
**File:** `mobile/app/(tabs)/lineup.tsx` lines 27–32
`useState(() => { if (params.tier && !tier) setTier(...); });` — calls setTier inside useState initializer (setState during render). React anti-pattern; will warn and may behave inconsistently in concurrent mode.
**Fix:** `useEffect(() => { if (params.tier && !tier) setTier(...); }, [params.tier]);`

### H-23 — `sidebets.acceptor_id` doesn't exist; client uses it everywhere
**Files:** `mobile/app/sidebet/[id].tsx`, `mobile/app/(tabs)/sidebets.tsx`. References `sidebets!sidebets_acceptor_id_fkey`, `acceptor_id.eq.`, etc.
Schema column is `opponent_id`. Sidebet "my bets" tab and accept flow are broken.
**Fix:** Rename all references to `opponent_id`. If naming "acceptor_id" reads better, alias in a view.

### H-24 — `profile.tsx` reads `achievements.icon`, `achievements.title` — schema has `icon_url`, `name`
**File:** `mobile/app/(tabs)/profile.tsx` ~lines 137–138
Renders empty strings; achievements look unstyled.
**Fix:** Use `name` and (if you want emoji) add `icon_emoji` column or use `<Image>` of `icon_url`.

### H-25 — `friends` table: client uses `addressee_id`, schema is `recipient_id`
**File:** `mobile/app/friends.tsx`
Multiple `.eq('addressee_id', ...)` and FK alias `friends!friends_addressee_id_fkey`. Schema column is `recipient_id`. **Friends feature is non-functional.**
**Fix:** Rename to `recipient_id` everywhere.

### H-26 — `settings.tsx` references RG column names that don't exist
**File:** `mobile/app/settings.tsx`
Reads/writes `responsible_gaming_settings.is_self_excluded`, `weekly_spend_limit`, `self_exclusion_until`. Schema columns are `is_permanently_excluded`, `loss_limit_weekly`, `self_excluded_until`.
**Impact:** Self-exclusion writes wrong columns → fails silently → user thinks they self-excluded but it didn't take. **Critical for compliance.**
**Fix:** Match schema column names. Also see C-4 — must go through an RPC, not direct upsert.

### H-27 — `settings.tsx` notification prefs UI is a no-op
**File:** `mobile/app/settings.tsx` ~line 38
`updateNotifPref = useMutation({ mutationFn: async (_updates) => { /* no-op */ } })`. UI toggles look functional but persist nothing. Misleading; user thinks they've opted out but they haven't (also re H-1).
**Fix:** Wire to `notification_preferences` table (exists per migration 3).

### H-28 — `profiles.email` does not exist
**File:** `mobile/app/settings.tsx` ~line 99 reads `profile?.email`. Schema has no `email` column on profiles — it lives on `auth.users`. Always undefined; falls back to `user.email`.
**Fix:** Just use `user.email`. Or add a denormalized `email` to profiles (driven by signup trigger) if you need to query it.

### H-29 — `mv_player_market` column drift between mig 3 and mig 4
**File:** `supabase/migrations/20250101000002_…` creates MV with `id`, `team_abbreviation`. `…000003_…` drops + recreates with `player_id`, `team_abbr`. Client (`mobile/app/(tabs)/lineup.tsx`) reads `player_id`, `team_abbr` (final shape).
This works at clean-deploy time. But the cron job `refresh-player-market` (mig 3) was scheduled against the old MV definition. After mig 4's DROP, the cron's REFRESH CONCURRENTLY needs the new MV's unique index — it has one — so it works. Just fragile; document.

### H-30 — `mv_player_market` REFRESH CONCURRENTLY every 30s
**File:** `supabase/migrations/20250101000002_…` cron `refresh-player-market`
A full MV re-query every 30 seconds doesn't scale; cost grows with player + price rows. Concurrent refresh takes a brief lock; OK for now but doesn't replace a real cache.
**Fix later:** Replace MV with a denormalized `player_market` table updated via triggers on `player_prices`/`player_season_stats` changes. Same data, real-time, no cron.

### H-31 — Weekly leaderboard cron counts ties as losses
**File:** `supabase/migrations/20250101000002_…` `recalculate-weekly-leaderboard`
`COUNT(CASE WHEN m.winner_user_id != p.id AND m.status = 'completed' THEN 1 END)` — includes rows where `winner_user_id IS NULL` (ties). Inflates losses by tie count.
**Fix:** Add `AND m.winner_user_id IS NOT NULL`.

### H-32 — Three separate `auth.users` AFTER INSERT triggers
**Files:** migrations 1, 2, 3 each add a separate trigger (`handle_new_user`, `_v2`, `_v3`) for different INSERTs.
- `handle_new_user` lacks ON CONFLICT — duplicate fires error out and roll back auth.users.
- Ordering between three AFTER INSERT triggers on the same event is by name in Postgres; reproducible but brittle.
**Fix:** Consolidate into one `handle_new_user_full(NEW)` trigger function with all INSERTs and ON CONFLICT DO NOTHING throughout.

---

## MEDIUM — design system / quality

### M-1 — Design system completely diverges from the locked spec
**Spec:** IBM Plex Mono on numerics; green `#26D782` and red `#F24236` reserved for price-movement direction only; Jet Black `#0A0A0C` base; full dark mode.
**Actual:**
- `mobile/tailwind.config.js`: fonts are Inter (`Inter_400Regular`, etc.) — and **`expo-font` isn't called anywhere** to load them; fonts fall through to System. No IBM Plex anything; no mono.
- Greens used are `#22C55E` and `#26C783` variants — different hex from spec. Reds are `#EF4444` (spec is `#F24236`). Used decoratively for: win/loss banners, transaction types (`mobile/app/wallet.tsx`), prop-side over/under (`mobile/lib/utils.ts`), salary cap warnings (`mobile/lib/utils.ts`), error states, friends "Ignore" button. Reserved spec usage (price direction) is the only place they're correctly applied — and price-direction UI isn't even built yet (charts not implemented).
- Base color `#0a0a0a` (close enough to `#0A0A0C`, but inconsistent across files).
- `package.json` doesn't depend on any IBM Plex font package.
**Fix:**
1. Install `@expo-google-fonts/ibm-plex-mono` and `@expo-google-fonts/ibm-plex-sans`. Load via `useFonts` in `_layout.tsx` behind `SplashScreen.preventAutoHideAsync()`.
2. Update `tailwind.config.js`: `fontFamily: { sans: ['IBMPlexSans_400Regular', ...], mono: ['IBMPlexMono_500Medium', ...], …}`.
3. Add tokens `priceUp: '#26D782'`, `priceDown: '#F24236'` — and ONLY use them for price deltas.
4. For win/loss results, transaction direction, prop direction, salary warnings: introduce neutral semantic tokens (`win`, `loss`, `warning`, `success`) with hexes that aren't the price-direction colors.
5. Update `mobile/lib/utils.ts` color helpers accordingly.
6. Apply mono on all numeric/data text via `font-mono` class.

### M-2 — `App.tsx` and `index.ts` are dead code
**Files:** `mobile/App.tsx` (default Expo template), `mobile/index.ts`. `mobile/package.json` `"main": "expo-router/entry"` — expo-router bootstraps. These files are never executed.
**Fix:** Delete both.

### M-3 — `tailwind.config.js` content includes non-existent `./components/**`
**Fix:** Remove glob, or create the dir as you extract components.

### M-4 — Fonts in tailwind config don't actually load (see M-1)
**Fix:** Covered by M-1.

### M-5 — Hex colors inline in every screen instead of using tokens
**File:** every screen in `mobile/app/`. Examples: `bg-[#0a0a0a]`, `border-[#2E2E2E]`, `text-[#F59E0B]`, `text-[#71717A]`. Tokens (`bg`, `surface`, `brand`, `text`) defined in `tailwind.config.js` are unused.
**Fix:** Replace inline hex with token classes. Easier to maintain and audit dark-mode compliance.

### M-6 — Dead state in `mobile/app/wallet.tsx`
**File:** `mobile/app/wallet.tsx`
- `tab` state declared (line 14), `Tab` type imported — but the tabs aren't rendered. Always shows overview.
- `setWallet` from `useAuthStore` is destructured but never used.
- `Alert` import is unused.
**Fix:** Remove unused state/imports.

### M-7 — Sidebets feed and accept CTA depend on the C-5 hijack policy
**File:** `mobile/app/(tabs)/sidebets.tsx`, `mobile/app/sidebet/[id].tsx`
Once C-5 is fixed (drop bad UPDATE policy, route accept through RPC), `acceptSidebet` mutation calls the new `accept_sidebet(sidebet_id)` RPC instead of a direct UPDATE.

### M-8 — Business logic lives inside screen components
**Files:** `mobile/app/matchup/create.tsx`, `mobile/app/sidebet/create.tsx`, `mobile/app/sidebet/[id].tsx`, `mobile/app/wallet/deposit.tsx`, `mobile/app/wallet/withdraw.tsx`. Each does 3–7 step DB operations inside the mutation closure.
**Fix:** After RPCs exist (per the CRITICAL fixes), pull each mutation into `mobile/services/matchup.ts`, `services/sidebet.ts`, `services/wallet.ts`. Screens become thin: just `mutation.mutate({...})`.

### M-9 — No error reporting / observability
No Sentry, Bugsnag, LogRocket. Only `console.error`. For real-money app this is a gap.
**Fix:** Add Sentry RN. Hook into React Query global `onError`. Hook into Edge Function `try/catch`.

### M-10 — No tests
`package.json` has no test runner, no `__tests__/`, no `jest.config.js`/`vitest.config.ts`.
**Fix:** Add Vitest (or Jest). Minimum tests: pricing-engine math, salary-cap enforcement, rake calculation, idempotency, wallet RPCs (debit blocks below-zero, etc.).

### M-11 — `mobile/app/sidebet/[id].tsx` hard-codes 5% sidebet rake on the client
**File:** `mobile/app/sidebet/[id].tsx` line 102: `const payout = totalPot * (1 - 0.05);`
Should read from `app_config.sidebet_rake_percentage`. Drift risk.
**Fix:** Pull from `app_config` query or compute server-side and return on the row.

### M-12 — `home.tsx` navigation pushes a non-existent route `/lineup/build`
**File:** `mobile/app/(tabs)/home.tsx` line ~100
`router.push({ pathname: '/lineup/build', params: { tier } })` — but the real route is `/(tabs)/lineup`. Quick-enter is broken.
**Fix:** `router.push({ pathname: '/(tabs)/lineup', params: { tier } })`.

### M-13 — `profiles.win_rate` is GENERATED, but wins/losses are still user-editable (C-2)
GENERATED protection doesn't help if inputs can be lied about. Fix C-2.

### M-14 — `stripe_webhook_events.payload` stores full event JSONB
Includes card brand/last4, customer email, billing details. Supabase encrypts at rest, but PII minimization is good hygiene.
**Fix:** Store a redacted projection (`event.type`, `event.data.object.id`, `event.data.object.metadata`, key fields you need for replay), keep the raw event elsewhere with strict access if needed.

### M-15 — `mobile/lib/database.types.ts` not audited in this pass (31 KB)
**Fix:** After other fixes, regenerate and re-audit; the column-name mismatches throughout suggest this file is stale.

### M-16 — `deposit.tsx` simulate path always offered, even if real intent failed
The `Alert` in `onSuccess` always offers "Simulate Deposit" regardless of whether `create-payment-intent` returned a valid PaymentIntent.
**Fix:** Remove simulate entirely (re C-16). If you keep a dev-only path during build, gate it on `__DEV__` and warn.

### M-17 — Profile screen shows first 9 achievements with no "see all"
**File:** `mobile/app/(tabs)/profile.tsx` ~line 130
Hard-coded `.slice(0, 9)`. There are 15 seeded achievements; user can't browse them.
**Fix:** Link to `/achievements` (file already exists at `mobile/app/achievements.tsx`).

### M-18 — DOB stored in two places: `profiles.date_of_birth` and `user_kyc.date_of_birth`
Drift opportunity if one is updated and the other isn't.
**Fix:** Pick one canonical source — `user_kyc.date_of_birth`. Drop from `profiles` (the `dob` column added in mig 2).

### M-19 — `tier.superstar` and `brand.DEFAULT` share `#F59E0B`
**File:** `mobile/tailwind.config.js`
Visual collision — superstar player tier badge is the same color as CTAs and the brand.
**Fix:** Different superstar accent (purple `#A855F7` is already used elsewhere for stats; pick a fresh one).

### M-20 — `matchup/create.tsx` auto-submits on mount
**File:** `mobile/app/matchup/create.tsx` `useEffect(() => submitLineup.mutate(), [])`
Hot reload, back-nav-and-return, or any remount re-runs the mutation. Combined with the broken column names (C-15) it errors quickly, but on the happy path this would re-escrow.
**Fix:** Track submission state in the store; guard with `if (phase !== 'submitting' || hasSubmitted) return;`. Or use a server-side idempotency key.

### M-21 — Migration filenames use placeholder dates `20250101...`
Files were committed 2026-05-11 but named `20250101...`. Misleading when reading history.
**Fix:** New migrations should use real timestamps. Existing names: leave for now (renaming breaks Supabase migration ordering on existing remote).

### M-22 — `decay-price-velocity` cron comment says "nightly" but it runs every 5 min
**File:** `supabase/migrations/20250101000002_…`
Schedule is `*/5 * * * *` (correct for decay). Comment is wrong.
**Fix:** Update comment.

---

## LOW

### L-1 — `mobile/App.tsx` + `mobile/index.ts` dead code (see M-2).
### L-2 — Fonts silently fall back; no `useFonts()` (see M-1, M-4).
### L-3 — No ErrorBoundary; no `SplashScreen.preventAutoHideAsync` (see M-1).
### L-4 — `forgot-password.tsx` not audited (standard flow, likely fine).
### L-5 — `notifications.tsx`, `achievements.tsx`, `leaderboard.tsx`, `user/[id].tsx` not audited in this pass (lower priority; same patterns likely apply: hex colors, direct queries, possibly wrong column names).
### L-6 — `package.json` missing `@stripe/stripe-react-native` even though Stripe payment sheet is referenced. Add when wiring real deposits.
### L-7 — Placeholder migration dates `20250101…` (see M-21).
### L-8 — `nba_players.team_id` FK added but no backfill from `team_abbreviation`. Sidebet game lookup depends on it.
### L-9 — `mobile/lib/utils.ts` `TIER_CAPS` is a frontend duplicate of `entry_tier_caps` table — drift risk. Fetch instead.
### L-10 — No documented CSP/security-header config; not applicable to RN client, but Stripe webhook & Edge Functions should at least set restrictive CORS.

---

## Coverage caveats

**Read in full:**
- All 4 migration files (`supabase/migrations/2025010100000{0,1,2,3}_*.sql`).
- All 3 Edge Functions (`stripe-webhook`, `score-matchup`, `send-notification`).
- `mobile/App.tsx`, `index.ts`, `app.json`, `package.json`, `tsconfig.json`, `tailwind.config.js`, `babel.config.js`, `global.css`, `.env.example`.
- `mobile/app/_layout.tsx`, `mobile/app/wallet.tsx`, `mobile/app/settings.tsx`, `mobile/app/friends.tsx`.
- `mobile/app/(auth)/_layout.tsx`, `login.tsx`, `signup.tsx`, `onboarding.tsx`.
- `mobile/app/(tabs)/_layout.tsx`, `home.tsx`, `lineup.tsx`, `matchups.tsx`, `sidebets.tsx`, `profile.tsx`.
- `mobile/app/matchup/create.tsx`, `[id].tsx`.
- `mobile/app/sidebet/create.tsx`, `[id].tsx`.
- `mobile/app/wallet/deposit.tsx`, `withdraw.tsx`.
- `mobile/hooks/useAuth.ts`, `mobile/lib/supabase.ts`, `mobile/lib/utils.ts`, `mobile/stores/auth.store.ts`, `mobile/stores/lineup.store.ts`.

**Not read:**
- `mobile/lib/database.types.ts` — 31 KB; skipped to avoid context blowup. Recommend regenerating after fixes and re-auditing.
- `mobile/app/(auth)/forgot-password.tsx`, `mobile/app/notifications.tsx`, `mobile/app/achievements.tsx`, `mobile/app/leaderboard.tsx`, `mobile/app/user/[id].tsx` — lower priority screens; same patterns probably apply.
- `.agents/skills/*` — tooling docs (out of scope for app audit).
- `package-lock.json`, generated/build artifacts.

**Not verifiable from source alone:**
- Live Stripe webhook behavior, env var values, Supabase auth-confirmation settings.
- Runtime crashes, animation correctness, navigation reachability.
- Whether anyone has actually run the matchup create flow end-to-end against the live DB (suspect not, given H-6 + C-15).
- Whether `state_restrictions` is consulted by any code path beyond display in onboarding (it isn't, AFAICT).

---

## Recommended fix order

The CRITICAL findings are interdependent. Fix in this order so each step lands on a working foundation:

1. **C-10/C-11/C-12/C-13** — Stripe webhook: rename columns, move to one `process_stripe_event` SECURITY DEFINER RPC. This unblocks real deposits.
2. **Server-side wallet RPCs** — `credit_wallet`, `debit_wallet`, `move_to_escrow`, `release_escrow`. Atomic increments only.
3. **C-1** — drop `wallets_update_own` UPDATE policy.
4. **C-2, C-3, C-4, C-8, C-9** — drop user-writable policies on `profiles`/`user_kyc`/`responsible_gaming_settings`/`payout_methods`; add protected-cols trigger on profiles; lock state after onboarding.
5. **C-6, C-7, H-7** — `submit_lineup_and_match` RPC with server-set frozen prices, FIFO matching, 3-player constraint. Drop client INSERT policies on `lineups` and `lineup_players`. Rework client `lineup.store.ts` to 3 slots.
6. **C-14** — rewrite `score-matchup` around a `settle_matchup` RPC with correct column names. **Without this, no game ever pays out — top operational priority.**
7. **C-5, C-18, C-19** — `accept_sidebet`, `create_sidebet` RPCs. Drop `sidebets_update_accept` hijack policy.
8. **C-15, C-16, C-17** — rewrite mobile `matchup/create.tsx`, `wallet/deposit.tsx`, `wallet/withdraw.tsx` to call RPCs. Delete the "Simulate Deposit" path.
9. **H-4** — make `sync_user_search` SECURITY DEFINER. (Without this, no one can complete onboarding.)
10. **H-23, H-25, H-26, H-28** — rename mobile column references to match schema (`acceptor_id → opponent_id`, `addressee_id → recipient_id`, RG column names).
11. **H-8** — implement the pricing engine per the locked formula.
12. **H-10, H-12** — finish Stripe webhook coverage (refunds, disputes, transfers).
13. **H-2, H-1, H-3** — fix `send-notification` (auth gate, pref column mapping, multi-device tokens).
14. **H-9** — resolve $500 vs tier-based salary cap with product.
15. Type regeneration (H-17), font/design system (M-1), then remaining MEDIUM/LOW cleanup.

## Items requiring human judgment before fixing

- **H-9** — $500 salary cap vs tier-based caps. Product/legal decision.
- **C-9** — state-change policy after onboarding (immutable? support ticket? re-KYC required?). Compliance + UX decision.
- **C-4** — limit-increase cooling-off period (24h, 48h, 72h?). Jurisdiction-dependent.
- **H-19** — email-verification gate timing (block all actions until verified, or just deposits/withdrawals?). UX call.
- **M-1** — design system: the spec describes a specific palette and font; the implementation uses a different one. Confirm whether the spec is current or the new implementation was an intentional pivot.
- **H-29 / H-30** — keep materialized view or move to denormalized table + triggers? Performance/complexity tradeoff.

---

_Audit generated on 2026-05-13 against `cliff_dev` @ `ab340ba…`._
