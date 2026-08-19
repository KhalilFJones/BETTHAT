-- =============================================================================
-- Social Feed — posts, likes, comments
-- Backs app/(tabs)/social.tsx (the centre nav tab). A post is free text plus
-- an optional attached player "position" card (the Figma Stock block with the
-- Buy / Sell footer), so `player_id` + `attachment_*` travel together.
-- =============================================================================

create table if not exists public.social_posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 2000),
  -- Optional attached player card.
  player_id         uuid references public.nba_players(id) on delete set null,
  attachment_kind   text check (attachment_kind in ('buy','sell')),
  attachment_price  numeric(10,2),
  attachment_at     timestamptz,
  share_count       integer not null default 0 check (share_count >= 0),
  created_at        timestamptz not null default now(),
  -- An attachment is all-or-nothing: no orphan prices without a player.
  constraint social_posts_attachment_complete check (
    (player_id is null and attachment_kind is null and attachment_price is null)
    or (player_id is not null and attachment_kind is not null and attachment_price is not null)
  )
);

create table if not exists public.social_post_likes (
  post_id    uuid not null references public.social_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.social_post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.social_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists social_posts_created_at_idx   on public.social_posts (created_at desc);
create index if not exists social_posts_user_idx         on public.social_posts (user_id, created_at desc);
create index if not exists social_post_likes_user_idx    on public.social_post_likes (user_id);
create index if not exists social_post_comments_post_idx on public.social_post_comments (post_id, created_at desc);

alter table public.social_posts         enable row level security;
alter table public.social_post_likes    enable row level security;
alter table public.social_post_comments enable row level security;

-- The feed is public to signed-in users; writes are always self-scoped, and
-- `with check` on insert stops a client forging another user's authorship.
drop policy if exists social_posts_select on public.social_posts;
create policy social_posts_select on public.social_posts
  for select to authenticated using (true);

drop policy if exists social_posts_insert on public.social_posts;
create policy social_posts_insert on public.social_posts
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists social_posts_update on public.social_posts;
create policy social_posts_update on public.social_posts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists social_posts_delete on public.social_posts;
create policy social_posts_delete on public.social_posts
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists social_post_likes_select on public.social_post_likes;
create policy social_post_likes_select on public.social_post_likes
  for select to authenticated using (true);

drop policy if exists social_post_likes_insert on public.social_post_likes;
create policy social_post_likes_insert on public.social_post_likes
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists social_post_likes_delete on public.social_post_likes;
create policy social_post_likes_delete on public.social_post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists social_post_comments_select on public.social_post_comments;
create policy social_post_comments_select on public.social_post_comments
  for select to authenticated using (true);

drop policy if exists social_post_comments_insert on public.social_post_comments;
create policy social_post_comments_insert on public.social_post_comments
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists social_post_comments_delete on public.social_post_comments;
create policy social_post_comments_delete on public.social_post_comments
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── Composer follow-up: 5000-char bodies + audience scoping ─────────────────
alter table public.social_posts drop constraint if exists social_posts_body_check;
alter table public.social_posts
  add constraint social_posts_body_check check (char_length(body) between 1 and 5000);

alter table public.social_posts
  add column if not exists audience text not null default 'everyone';

alter table public.social_posts drop constraint if exists social_posts_audience_check;
alter table public.social_posts
  add constraint social_posts_audience_check check (audience in ('everyone', 'friends'));

-- Visibility is enforced in RLS rather than in the client query: a
-- friends-only post must not be readable by a non-friend even if someone
-- talks to PostgREST directly.
drop policy if exists social_posts_select on public.social_posts;
create policy social_posts_select on public.social_posts
  for select to authenticated
  using (
    audience = 'everyone'
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.friends f
      where f.status = 'accepted'
        and (
          (f.requester_id = (select auth.uid()) and f.recipient_id = social_posts.user_id)
          or (f.recipient_id = (select auth.uid()) and f.requester_id = social_posts.user_id)
        )
    )
  );

create index if not exists social_posts_audience_idx on public.social_posts (audience, created_at desc);

-- ── Sharing a matchup to the feed ───────────────────────────────────────────
-- `matchups`, `lineups` and `lineup_players` are all participant- or
-- friends-scoped, so a bare matchup_id would render as an empty card for
-- everyone else in the feed. Widening those policies would expose both
-- players' full lineup rows to the public the moment one of them posted, so
-- instead the post carries a snapshot of exactly what the card shows.
--
-- Fantasy points are deliberately NOT snapshotted — player_game_stats is
-- already readable by any authenticated user, so the card re-reads them live
-- and a shared live matchup keeps ticking for every viewer.
alter table public.social_posts
  add column if not exists matchup_id uuid references public.matchups(id) on delete set null,
  add column if not exists matchup_snapshot jsonb;

alter table public.social_posts drop constraint if exists social_posts_matchup_complete;
alter table public.social_posts
  add constraint social_posts_matchup_complete check (
    (matchup_id is null and matchup_snapshot is null)
    or (matchup_id is not null and matchup_snapshot is not null)
  );

alter table public.social_posts drop constraint if exists social_posts_single_attachment;
alter table public.social_posts
  add constraint social_posts_single_attachment check (
    player_id is null or matchup_id is null
  );

create index if not exists social_posts_matchup_idx on public.social_posts (matchup_id);

-- ── Follows · per-post comment permission · GIF replies ─────────────────────
alter table public.social_posts
  add column if not exists allow_comments boolean not null default true;

create table if not exists public.user_follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint user_follows_no_self check (follower_id <> following_id)
);
create index if not exists user_follows_following_idx on public.user_follows (following_id);
create index if not exists user_follows_follower_idx  on public.user_follows (follower_id, created_at desc);
alter table public.user_follows enable row level security;

drop policy if exists user_follows_select on public.user_follows;
create policy user_follows_select on public.user_follows for select to authenticated using (true);
drop policy if exists user_follows_insert on public.user_follows;
create policy user_follows_insert on public.user_follows for insert to authenticated
  with check (follower_id = (select auth.uid()));
drop policy if exists user_follows_delete on public.user_follows;
create policy user_follows_delete on public.user_follows for delete to authenticated
  using (follower_id = (select auth.uid()));

alter table public.social_post_comments
  add column if not exists gif_url text,
  add column if not exists parent_id uuid references public.social_post_comments(id) on delete cascade;
create index if not exists social_post_comments_parent_idx on public.social_post_comments (parent_id, created_at);

alter table public.social_post_comments drop constraint if exists social_post_comments_body_check;
alter table public.social_post_comments
  add constraint social_post_comments_content check (
    (body is not null and char_length(body) between 1 and 1000)
    or (gif_url is not null and char_length(gif_url) <= 2048)
  );
alter table public.social_post_comments alter column body drop not null;

-- Comments respect the post's setting in RLS, not just the UI.
drop policy if exists social_post_comments_insert on public.social_post_comments;
create policy social_post_comments_insert on public.social_post_comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.social_posts p
                where p.id = social_post_comments.post_id and p.allow_comments = true)
  );

-- ── GIFs on posts (independent of the player/matchup attachment) ────────────
alter table public.social_posts add column if not exists gif_url text;
alter table public.social_posts alter column body drop not null;

alter table public.social_posts drop constraint if exists social_posts_body_check;
alter table public.social_posts
  add constraint social_posts_body_check
  check (body is null or char_length(body) between 1 and 5000);

alter table public.social_posts drop constraint if exists social_posts_gif_len;
alter table public.social_posts
  add constraint social_posts_gif_len check (gif_url is null or char_length(gif_url) <= 2048);

alter table public.social_posts drop constraint if exists social_posts_has_content;
alter table public.social_posts
  add constraint social_posts_has_content check (
    body is not null or gif_url is not null or player_id is not null or matchup_id is not null
  );
