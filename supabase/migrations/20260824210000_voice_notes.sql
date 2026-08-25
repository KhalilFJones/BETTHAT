-- =============================================================================
-- Voice notes on comments and matchup chat
--
-- A voice note is a first-class message body, not an attachment: a comment or
-- chat message may be text, a GIF, audio, or any combination. That means the
-- existing "must have text" constraints have to widen, and matchup_messages
-- .content has to become nullable — an audio-only message has no text at all.
--
-- Duration is stored alongside the URL so the player can render its length
-- without downloading the file first.
-- =============================================================================

alter table social_post_comments
  add column if not exists audio_url         text,
  add column if not exists audio_duration_ms integer;

alter table matchup_messages
  add column if not exists audio_url         text,
  add column if not exists audio_duration_ms integer;

-- ── matchup_messages ────────────────────────────────────────────────────────
alter table matchup_messages alter column content drop not null;

alter table matchup_messages drop constraint if exists content_not_empty;
alter table matchup_messages add constraint content_not_empty check (
  (content is not null and char_length(content) between 1 and 500)
  or (audio_url is not null and char_length(audio_url) <= 2048)
);

alter table matchup_messages drop constraint if exists matchup_messages_audio_duration;
alter table matchup_messages add constraint matchup_messages_audio_duration check (
  audio_duration_ms is null
  or (audio_duration_ms > 0 and audio_duration_ms <= 120000)   -- 2 min ceiling
);

-- ── social_post_comments ────────────────────────────────────────────────────
alter table social_post_comments drop constraint if exists social_post_comments_content;
alter table social_post_comments add constraint social_post_comments_content check (
  (body is not null and char_length(body) between 1 and 1000)
  or (gif_url is not null and char_length(gif_url) <= 2048)
  or (audio_url is not null and char_length(audio_url) <= 2048)
);

alter table social_post_comments drop constraint if exists social_post_comments_audio_duration;
alter table social_post_comments add constraint social_post_comments_audio_duration check (
  audio_duration_ms is null
  or (audio_duration_ms > 0 and audio_duration_ms <= 120000)
);

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Same folder-per-uid convention as avatars. Public read: a voice note is only
-- discoverable through a comment or message the reader already has access to,
-- and the object key is an unguessable uuid path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-notes', 'voice-notes', true,
  10485760,                                  -- 10 MB; 2 min of AAC is ~250 KB
  array['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Voice notes are publicly readable" on storage.objects;
create policy "Voice notes are publicly readable"
  on storage.objects for select
  using (bucket_id = 'voice-notes');

drop policy if exists "Users can upload their own voice notes" on storage.objects;
create policy "Users can upload their own voice notes"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own voice notes" on storage.objects;
create policy "Users can delete their own voice notes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
