# Supabase RPC tests

These are pgTAP-style integration tests that exercise the SECURITY DEFINER
RPCs introduced in `20260513000000_security_hardening_and_rpcs.sql`. They
need a real Postgres instance with `pgtap` installed — run via:

```bash
# install pgtap once
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pgtap;"

# run all tests against a freshly-migrated local DB
supabase db reset
psql $DATABASE_URL -f supabase/tests/01_wallet_rpcs.sql
psql $DATABASE_URL -f supabase/tests/02_settle_matchup.sql
psql $DATABASE_URL -f supabase/tests/03_stripe_idempotency.sql
psql $DATABASE_URL -f supabase/tests/04_fifo_matching.sql

# or use pg_prove
pg_prove --ext .sql supabase/tests/
```

Each test file:
1. Wraps everything in `BEGIN; ... ROLLBACK;` so it leaves no state.
2. Creates fixture auth.users + profiles + wallets via `auth.uid()` shims.
3. Asserts via `tap.ok` / `tap.is` / `tap.throws_ok`.
