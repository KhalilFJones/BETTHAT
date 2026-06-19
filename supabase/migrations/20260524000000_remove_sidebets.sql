-- =============================================================================
-- BETTHAT — REMOVE SIDEBETS (full feature drop)
-- =============================================================================
-- The side-bet feature (player prop OVER/UNDER wagers) is being cut entirely.
-- This migration removes every backend object it touched, in dependency-safe
-- order, and cleans up the columns / constraints / config keys it left behind.
--
-- Mobile screens, the navigation tab, the service layer, and the
-- send-notification PREF_COLUMN entries are removed in the client commit.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — UNSCHEDULE ALL SIDEBET CRON JOBS
-- =============================================================================
-- refresh-open-sidebets (mv refresh), expire-sidebets, and purge-sidebet-messages
-- all reference sidebet objects dropped below; unschedule them or pg_cron will
-- error on every fire once the tables are gone.

SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname IN ('refresh-open-sidebets', 'expire-sidebets', 'purge-sidebet-messages');


-- =============================================================================
-- SECTION 2 — DROP VIEW + TABLES (CASCADE clears indexes/policies/triggers/FKs)
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS public.mv_open_sidebets CASCADE;

DROP TABLE IF EXISTS public.sidebet_messages  CASCADE;
DROP TABLE IF EXISTS public.sidebet_reactions CASCADE;
DROP TABLE IF EXISTS public.sidebets          CASCADE;


-- =============================================================================
-- SECTION 3 — DROP THE SIDEBET RPCS
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_sidebet(UUID, TEXT, DECIMAL, TEXT, DECIMAL, TEXT, UUID);
DROP FUNCTION IF EXISTS public.accept_sidebet(UUID);


-- =============================================================================
-- SECTION 4 — DROP PROFILE SIDEBET COUNTERS
-- =============================================================================
-- The protected-columns trigger (lock_protected_profile_cols) references the
-- two sidebet counters, so it must be recreated WITHOUT them before the columns
-- can be dropped. win_rate (GENERATED) depends only on total_wins/total_losses,
-- so dropping the sidebet counters is safe.

CREATE OR REPLACE FUNCTION public.lock_protected_profile_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role may write anything; trust it.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Money / leaderboard / compliance state — never settable by users.
  NEW.total_wins            := OLD.total_wins;
  NEW.total_losses          := OLD.total_losses;
  NEW.total_earnings        := OLD.total_earnings;
  NEW.rank_tier             := OLD.rank_tier;
  NEW.is_banned             := OLD.is_banned;
  NEW.kyc_status            := OLD.kyc_status;
  NEW.referred_by           := OLD.referred_by;
  NEW.total_entries         := OLD.total_entries;
  NEW.stripe_customer_id    := OLD.stripe_customer_id;
  NEW.pending_withdrawal    := OLD.pending_withdrawal;
  NEW.lifetime_winnings     := OLD.lifetime_winnings;
  NEW.last_deposit_at       := OLD.last_deposit_at;
  NEW.last_withdrawal_at    := OLD.last_withdrawal_at;

  -- C-9: state is locked after onboarding writes it once. Once non-null,
  -- only service_role can change it (support-ticket / re-KYC path).
  IF OLD.state IS NOT NULL THEN
    NEW.state := OLD.state;
  END IF;

  -- Terms acceptance is append-only.
  IF OLD.terms_accepted_at IS NOT NULL THEN
    NEW.terms_accepted_at := OLD.terms_accepted_at;
    NEW.terms_version     := OLD.terms_version;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS total_sidebets_won,
  DROP COLUMN IF EXISTS total_sidebets_lost;


-- =============================================================================
-- SECTION 5 — DROP NOTIFICATION-PREFERENCE SIDEBET COLUMNS
-- =============================================================================

ALTER TABLE public.notification_preferences
  DROP COLUMN IF EXISTS push_sidebet_received,
  DROP COLUMN IF EXISTS push_sidebet_result;


-- =============================================================================
-- SECTION 6 — TRANSACTION TYPES: retain sidebet_* as historical-only
-- =============================================================================
-- The sidebet FEATURE is removed, but production ledgers may already contain
-- transactions of type 'sidebet_wager' / 'sidebet_payout'. Financial history
-- must never be invalidated, and no NEW rows of these types can be created once
-- the RPCs and tables are gone — so we intentionally leave the
-- transactions.type CHECK constraint untouched (sidebet_* remain valid for
-- historical rows only). This is deliberately a no-op; documented so the
-- omission is clearly a choice, not an oversight.


-- =============================================================================
-- SECTION 7 — REMOVE SIDEBET CONFIG KEYS
-- =============================================================================

DELETE FROM public.app_config
 WHERE key IN ('max_sidebet_wager', 'min_sidebet_wager', 'sidebet_rake_percentage');


-- =============================================================================
-- END
-- =============================================================================
