-- =============================================================================
-- Push Notification Triggers
-- Uses pg_net to call the send-notification Edge Function when:
--   1. A matchup chat message is sent -> notify the opponent
--   2. A matchup is matched -> notify both users
--   3. Lead changes in an active matchup -> notify both users
-- =============================================================================

-- New notification preference columns.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_chat_message  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_matchup_score BOOLEAN NOT NULL DEFAULT TRUE;

-- Internal schema for SECURITY DEFINER helpers.
CREATE SCHEMA IF NOT EXISTS internal;

-- Helper: fire-and-forget push notification via Edge Function.
-- Webhook secret is stored inside SECURITY DEFINER so it is never visible
-- to authenticated/anon roles.
CREATE OR REPLACE FUNCTION internal.send_push_notification(
  p_user_id UUID,
  p_type    TEXT,
  p_title   TEXT,
  p_body    TEXT,
  p_data    JSONB DEFAULT $body2${}$body2$::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  c_secret TEXT := $x$btht-notify-db-2026-internal$x$;
  c_url    TEXT := $x$https://tynhpwljqmxakcqfxsxt.supabase.co/functions/v1/send-notification$x$;
BEGIN
  PERFORM net.http_post(
    url     := c_url,
    headers := jsonb_build_object(
      $k$Content-Type$k$,  $k$application/json$k$,
      $k$Authorization$k$, $k$Bearer $k$ || c_secret
    ),
    body := jsonb_build_object(
      $k$user_id$k$, p_user_id,
      $k$type$k$,    p_type,
      $k$title$k$,   p_title,
      $k$body$k$,    p_body,
      $k$data$k$,    p_data
    )
  );
END;
$func$;

-- Trigger 1: Chat message -> notify opponent
CREATE OR REPLACE FUNCTION public.trg_notify_matchup_chat()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_matchup   RECORD;
  v_sender    TEXT;
  v_recipient UUID;
BEGIN
  SELECT user1_id, user2_id, status INTO v_matchup FROM public.matchups WHERE id = NEW.matchup_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_matchup.status NOT IN ($s$matched$s$, $s$live$s$, $s$scoring$s$) THEN RETURN NEW; END IF;
  v_recipient := CASE WHEN v_matchup.user1_id = NEW.user_id THEN v_matchup.user2_id ELSE v_matchup.user1_id END;
  IF v_recipient IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(display_name, username, $s$Someone$s$) INTO v_sender FROM public.profiles WHERE id = NEW.user_id;
  PERFORM internal.send_push_notification(
    v_recipient, $s$matchup_chat$s$, COALESCE(v_sender, $s$Someone$s$) || $s$ sent a message$s$,
    substring(NEW.content FROM 1 FOR 100),
    jsonb_build_object($s$matchup_id$s$, NEW.matchup_id, $s$type$s$, $s$matchup_chat$s$)
  );
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS after_matchup_message_insert ON public.matchup_messages;
CREATE TRIGGER after_matchup_message_insert
  AFTER INSERT ON public.matchup_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_matchup_chat();

-- Trigger 2: Matchup matched -> notify both users
CREATE OR REPLACE FUNCTION public.trg_notify_matchup_matched()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_u1_name TEXT; v_u2_name TEXT; v_wager NUMERIC;
BEGIN
  IF NEW.status <> $s$matched$s$ OR OLD.status = $s$matched$s$ THEN RETURN NEW; END IF;
  SELECT COALESCE(display_name, username, $s$Opponent$s$) INTO v_u1_name FROM public.profiles WHERE id = NEW.user1_id;
  SELECT COALESCE(display_name, username, $s$Opponent$s$) INTO v_u2_name FROM public.profiles WHERE id = NEW.user2_id;
  v_wager := COALESCE(NEW.settled_wager, NEW.user1_max_wager, 0);
  PERFORM internal.send_push_notification(NEW.user1_id, $s$matchup_found$s$, $s$🏀 Match found!$s$,
    $s$You''re matched vs $s$ || COALESCE(v_u2_name,$s$Opponent$s$) || $s$ · $$s$ || v_wager::TEXT || $s$ on the line$s$,
    jsonb_build_object($s$matchup_id$s$, NEW.id, $s$type$s$, $s$matchup_found$s$));
  PERFORM internal.send_push_notification(NEW.user2_id, $s$matchup_found$s$, $s$🏀 Match found!$s$,
    $s$You''re matched vs $s$ || COALESCE(v_u1_name,$s$Opponent$s$) || $s$ · $$s$ || v_wager::TEXT || $s$ on the line$s$,
    jsonb_build_object($s$matchup_id$s$, NEW.id, $s$type$s$, $s$matchup_found$s$));
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS after_matchup_status_matched ON public.matchups;
CREATE TRIGGER after_matchup_status_matched
  AFTER UPDATE ON public.matchups FOR EACH ROW EXECUTE FUNCTION public.trg_notify_matchup_matched();

-- Trigger 3: Score lead change -> notify both users
CREATE OR REPLACE FUNCTION public.trg_notify_matchup_score()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_u1_name TEXT; v_u2_name TEXT; v_was_leading_1 BOOLEAN; v_now_leading_1 BOOLEAN;
BEGIN
  IF NEW.status NOT IN ($s$matched$s$, $s$live$s$, $s$scoring$s$) THEN RETURN NEW; END IF;
  IF NEW.user1_score IS NULL OR NEW.user2_score IS NULL THEN RETURN NEW; END IF;
  IF NEW.user1_score = OLD.user1_score AND NEW.user2_score = OLD.user2_score THEN RETURN NEW; END IF;
  v_was_leading_1 := COALESCE(OLD.user1_score, 0) > COALESCE(OLD.user2_score, 0);
  v_now_leading_1 := NEW.user1_score > NEW.user2_score;
  IF v_was_leading_1 = v_now_leading_1 THEN RETURN NEW; END IF;
  SELECT COALESCE(display_name, username, $s$P1$s$) INTO v_u1_name FROM public.profiles WHERE id = NEW.user1_id;
  SELECT COALESCE(display_name, username, $s$P2$s$) INTO v_u2_name FROM public.profiles WHERE id = NEW.user2_id;
  IF v_now_leading_1 THEN
    PERFORM internal.send_push_notification(NEW.user1_id, $s$matchup_score$s$, $s$📈 You took the lead!$s$,
      v_u1_name || $s$ $s$ || NEW.user1_score::TEXT || $s$ · $s$ || v_u2_name || $s$ $s$ || NEW.user2_score::TEXT,
      jsonb_build_object($s$matchup_id$s$, NEW.id, $s$type$s$, $s$matchup_score$s$));
    PERFORM internal.send_push_notification(NEW.user2_id, $s$matchup_score$s$, $s$📉 You fell behind$s$,
      v_u2_name || $s$ $s$ || NEW.user2_score::TEXT || $s$ · $s$ || v_u1_name || $s$ $s$ || NEW.user1_score::TEXT,
      jsonb_build_object($s$matchup_id$s$, NEW.id, $s$type$s$, $s$matchup_score$s$));
  ELSE
    PERFORM internal.send_push_notification(NEW.user2_id, $s$matchup_score$s$, $s$📈 You took the lead!$s$,
      v_u2_name || $s$ $s$ || NEW.user2_score::TEXT || $s$ · $s$ || v_u1_name || $s$ $s$ || NEW.user1_score::TEXT,
      jsonb_build_object($s$matchup_id$s$, NEW.id, $s$type$s$, $s$matchup_score$s$));
    PERFORM internal.send_push_notification(NEW.user1_id, $s$matchup_score$s$, $s$📉 You fell behind$s$,
      v_u1_name || $s$ $s$ || NEW.user1_score::TEXT || $s$ · $s$ || v_u2_name || $s$ $s$ || NEW.user2_score::TEXT,
      jsonb_build_object($s$matchup_id$s$, NEW.id, $s$type$s$, $s$matchup_score$s$));
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS after_matchup_score_update ON public.matchups;
CREATE TRIGGER after_matchup_score_update
  AFTER UPDATE ON public.matchups FOR EACH ROW EXECUTE FUNCTION public.trg_notify_matchup_score();