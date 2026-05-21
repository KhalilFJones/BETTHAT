-- =============================================================================
-- Fix: notification_preferences INSERT policy + handle_new_user trigger
--
-- Problem 1: notification_preferences had no INSERT policy, causing the
--   settings.tsx upsert to silently fail for any user whose row wasn't
--   seeded by the trigger yet.
--
-- Problem 2: handle_new_user did not insert a notification_preferences row,
--   so users created before this fix had no row at all.
-- =============================================================================

-- 1. Add INSERT policy so upsert in settings.tsx works as a fallback
CREATE POLICY notif_prefs_insert_own
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 2. Update handle_new_user to also seed notification_preferences
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'preferred_username',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance, escrow_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.responsible_gaming_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 4. Fix lineups_update_building: WITH CHECK was defaulting to USING, which
--    rejected the 'building' → 'submitted' status transition. Split them.
DROP POLICY IF EXISTS lineups_update_building ON public.lineups;
CREATE POLICY lineups_update_building ON public.lineups
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'building')
  WITH CHECK (auth.uid() = user_id);

-- 6. Fix sidebets_update_accept: same WITH CHECK issue — after accepting,
--    status changes away from 'open', so new row would fail the default check.
--    Note: accept_sidebet RPC is SECURITY DEFINER and bypasses RLS; this is
--    a defensive fix in case any direct-update path is added later.
DROP POLICY IF EXISTS sidebets_update_accept ON public.sidebets;
CREATE POLICY sidebets_update_accept ON public.sidebets
  FOR UPDATE
  USING (status = 'open' AND is_open = true AND auth.uid() <> creator_id)
  WITH CHECK (auth.uid() = opponent_id OR auth.uid() = creator_id);

INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.notification_preferences)
ON CONFLICT (user_id) DO NOTHING;
