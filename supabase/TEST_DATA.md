# BETTHAT — test database state

## All cron jobs are DISABLED

Every one of the 22 `pg_cron` jobs is `active = false`. Nothing writes to the
database on its own any more — no NBA sync, no price ticking, no history
snapshots, no matview refreshes.

This was deliberate. Two of them were the cause of repeated outages:

| job | schedule | damage |
|---|---|---|
| `nba-sync-live` | **every 1 second** | 6.7M rows in `nba_sync_log` (717 MB); also blew the edge-function invocation quota |
| `snapshot-price-history` | every 30 seconds | 786k rows/day → `price_history` hit 1.53M rows / 1.2 GB |

The database ran out of disk once as a result. Re-enable only with a longer
schedule:

```sql
-- inspect
select jobid, jobname, schedule, active from cron.job order by jobid;

-- re-enable a single job at a sane cadence
select cron.alter_job(jobid, schedule := '*/5 * * * *', active := true)
  from cron.job where jobname = 'snapshot-price-history';
```

Do **not** re-enable `nba-sync-live` at its 1-second schedule.

## Seeded data

Fixtures are anchored to the day they were seeded, so the Draft Market empties
out once real time passes them. To roll everything forward (games, tip-offs,
availability, lineups, matchups, price history, and the `game_date` embedded in
shared-matchup post snapshots):

```sql
select public.dev_roll_slate_forward();
```

Safe to re-run; a no-op when the slate already covers today.

Contents:

- **Fixtures** — 5 past dates × 15 final games (every player has a full 5-game
  form history), today = 2 live + 8 scheduled, tomorrow = 10 scheduled.
- **Market** — 273 players priced, 110 locked behind live games, 5 injured.
  `price_history` is ~101 ticks/player (20-min for the last 6h, 4-hourly back
  14 days) — about 6 MB total, deliberately compact.
- **Play state (khalilfjones@gmail.com)** — $500 wallet with $25 escrowed, one
  order in queue, one live matchup, one settled WIN and one settled LOSS, a
  half-built 2-of-3 draft, 2 pending friend challenges, 4 achievements, 3
  unread notifications, 7-row leaderboard.
- **Social** — 9 posts including 2 shared matchups (one live, one settled) and
  2 friends-only posts, one of which is from a NON-friend and must never appear
  in your feed.

## Account prerequisites

`place_lineup_order` gates on `user_can_play()`, which needs `profiles.state`
set to an allowed state and `terms_accepted_at` non-null. Both were NULL on the
real accounts, which silently blocked "Find Match" with `not eligible to play`.
Any new test account needs:

```sql
update profiles set state = 'FL', terms_accepted_at = now(),
                    date_of_birth = '1995-06-15', kyc_status = 'verified'
 where id = '<user-id>';
insert into responsible_gaming_settings (user_id) values ('<user-id>')
  on conflict do nothing;
```
