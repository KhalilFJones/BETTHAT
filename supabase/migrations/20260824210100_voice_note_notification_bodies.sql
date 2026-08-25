-- =============================================================================
-- Notification bodies for voice notes
--
-- notifications.body is NOT NULL. An audio-only message has NULL content, so
-- trg_notify_matchup_chat's substring(NEW.content ...) produced NULL and the
-- failing notification insert rolled back the message itself — the same shape
-- of bug that previously swallowed post likes.
--
-- notify_on_post_comment already coalesced, but to the wrong label: an
-- audio-only comment would have announced itself as "Sent a GIF".
-- =============================================================================

create or replace function public.trg_notify_matchup_chat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_matchup   RECORD;
  v_sender    TEXT;
  v_recipient UUID;
  v_body      TEXT;
BEGIN
  SELECT user1_id, user2_id, status INTO v_matchup
    FROM public.matchups WHERE id = NEW.matchup_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_matchup.status NOT IN ('matched', 'live', 'scoring') THEN RETURN NEW; END IF;

  v_recipient := CASE
    WHEN v_matchup.user1_id = NEW.user_id THEN v_matchup.user2_id
    ELSE v_matchup.user1_id
  END;
  IF v_recipient IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(display_name, username, 'Someone') INTO v_sender
    FROM public.profiles WHERE id = NEW.user_id;

  -- Never NULL: a voice-only message has no text to preview.
  v_body := COALESCE(
    NULLIF(substring(NEW.content FROM 1 FOR 100), ''),
    CASE WHEN NEW.audio_url IS NOT NULL THEN 'Sent a voice note' ELSE 'Sent a message' END
  );

  PERFORM internal.send_push_notification(
    v_recipient,
    'matchup_chat',
    COALESCE(v_sender, 'Someone') || ' sent a message',
    v_body,
    jsonb_build_object('matchup_id', NEW.matchup_id, 'type', 'matchup_chat')
  );
  RETURN NEW;
END;
$function$;

create or replace function public.notify_on_post_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_author        uuid;
  v_name          text;
  v_parent_author uuid;
  v_preview       text;
begin
  select user_id into v_author from social_posts where id = new.post_id;
  select coalesce(display_name, username) into v_name from profiles where id = new.user_id;

  -- Describe whichever body the comment actually has.
  v_preview := left(coalesce(
    nullif(new.body, ''),
    case
      when new.audio_url is not null then 'Sent a voice note'
      when new.gif_url   is not null then 'Sent a GIF'
      else 'Commented'
    end
  ), 120);

  if v_author is not null and v_author <> new.user_id then
    insert into notifications (user_id, type, title, body, data)
    values (v_author, 'post_comment',
            coalesce(v_name, 'Someone') || ' commented on your post',
            v_preview,
            jsonb_build_object('post_id', new.post_id, 'from_user_id', new.user_id));
  end if;

  if new.parent_id is not null then
    select user_id into v_parent_author from social_post_comments where id = new.parent_id;
    if v_parent_author is not null and v_parent_author <> new.user_id and v_parent_author <> v_author then
      insert into notifications (user_id, type, title, body, data)
      values (v_parent_author, 'post_comment',
              coalesce(v_name, 'Someone') || ' replied to your comment',
              v_preview,
              jsonb_build_object('post_id', new.post_id, 'from_user_id', new.user_id));
    end if;
  end if;
  return new;
end $function$;
