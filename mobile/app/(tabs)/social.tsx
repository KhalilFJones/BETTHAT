// =============================================================================
// BETTHAT — Social Feed (Figma "Insight" frame)
// The centre tab. Three segments on one screen: Feed (designed), Friends and
// LeaderBoard (lightweight lists — the export only specifies Feed).
//
// A post is free text plus an optional attached player card: the spec's Stock
// block with a ticker/name row, a price-change pill, a "Bought at hh:mm" line
// and a Buy / Sell footer button that deep-links into the market.
//
// Price-direction green/red are the spec's row-level tokens (#36A34C /
// #F05D5D == theme.gain / theme.danger).
// =============================================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, Pressable, FlatList,
  ActivityIndicator, RefreshControl, Modal, Image, Alert, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { SharedMatchupCard, type MatchupSnapshot } from '@/components/social/SharedMatchupCard';
import { CommentsSheet } from '@/components/social/CommentsSheet';
import { useFollowing, useFriendIds, useFollowMutation } from '@/hooks/social/useSocialGraph';

const SEGMENTS = [
  { key: 'feed', label: 'Feed' },
  { key: 'friends', label: 'Friends' },
  { key: 'following', label: 'Following' },
  { key: 'leaderboard', label: 'Board' },
] as const;
type Segment = (typeof SEGMENTS)[number]['key'];

const NAV_CLEARANCE = 120; // docked nav pill + safe area

// =============================================================================
// DATA
// =============================================================================

interface FeedPost {
  id: string;
  body: string | null;
  attachment_kind: 'buy' | 'sell' | null;
  attachment_price: number | null;
  attachment_at: string | null;
  share_count: number;
  allow_comments: boolean;
  gif_url: string | null;
  created_at: string;
  matchup_id: string | null;
  matchup_snapshot: MatchupSnapshot | null;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null;
  player: {
    id: string; full_name: string; ticker_handle: string | null; team_abbreviation: string;
    player_prices: { current_price: number; price_change_24h: number | null; price_change_pct_24h: number | null } | null;
  } | null;
  likes: { count: number }[];
  comments: { count: number }[];
}

function useFeed(userId: string | undefined) {
  return useQuery({
    queryKey: ['social-feed', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('social_posts')
        .select(`
          id, body, attachment_kind, attachment_price, attachment_at, share_count, created_at,
          allow_comments, gif_url, matchup_id, matchup_snapshot,
          author:profiles!social_posts_user_id_fkey(id, username, display_name, avatar_url),
          player:nba_players(id, full_name, ticker_handle, team_abbreviation,
            player_prices(current_price, price_change_24h, price_change_pct_24h)),
          likes:social_post_likes(count),
          comments:social_post_comments(count)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const posts = (data ?? []) as unknown as FeedPost[];

      // Which of these the signed-in user has already liked. Kept as its own
      // query rather than embedding every liker on every post.
      let liked = new Set<string>();
      if (userId && posts.length > 0) {
        const { data: mine } = await supabase
          .from('social_post_likes')
          .select('post_id')
          .eq('user_id', userId)
          .in('post_id', posts.map((p) => p.id));
        liked = new Set((mine ?? []).map((r: any) => r.post_id));
      }
      return { posts, liked };
    },
    staleTime: 15_000,
  });
}

// =============================================================================
// SCREEN
// =============================================================================

export default function SocialScreen() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuthStore();
  const [segment, setSegment] = useState<Segment>('feed');
  const [commentsFor, setCommentsFor] = useState<FeedPost | null>(null);
  const { post: deepLinkedPost } = useLocalSearchParams<{ post?: string }>();

  const likeMutationRef = useRef<((v: { postId: string; liked: boolean }) => void) | null>(null);
  const likedRef = useRef<Set<string>>(new Set());
  const shareRef = useRef<((p: FeedPost) => void) | null>(null);
  const followRef = useRef<((id: string, following: boolean) => void) | null>(null);
  const followingRef = useRef<Set<string>>(new Set());

  const { data: followingIds } = useFollowing(profile?.id);
  const { data: friendIds } = useFriendIds(profile?.id);
  const followMutation = useFollowMutation(profile?.id);

  const { data, isLoading, isError, isRefetching, refetch } = useFeed(profile?.id);

  // Feed shows every post RLS lets through; Friends narrows to accepted
  // friends and Following to people you follow. Your own posts stay visible
  // in all three — you're always part of your own feed.
  const visiblePosts = useMemo(() => {
    const posts = data?.posts ?? [];
    if (segment === 'friends') {
      return posts.filter((p) => p.author && (p.author.id === profile?.id || friendIds?.has(p.author.id)));
    }
    if (segment === 'following') {
      // Strictly the people you follow — your own posts don't belong here.
      return posts.filter((p) => p.author && followingIds?.has(p.author.id));
    }
    return posts;
  }, [data?.posts, segment, friendIds, followingIds, profile?.id]);

  // ⋮ menu: own posts can be deleted, other people's can be reported.
  const deleteMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from('social_posts').delete().eq('id', postId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-feed'] }),
    onError: (err: any) => Alert.alert('Could not delete post', err?.message ?? 'Try again.'),
  });

  const reportMutation = useMutation({
    mutationFn: async (post: FeedPost) => {
      if (!profile?.id || !post.author) throw new Error('Not signed in');
      const { error } = await supabase.from('user_reports').insert({
        reporter_id: profile.id,
        reported_id: post.author.id,
        reason: 'inappropriate_content',
        context_type: 'general',
        context_id: post.id,
        details: (post.body ?? post.gif_url ?? '').slice(0, 500),
      });
      if (error) throw error;
    },
    onSuccess: () => Alert.alert('Reported', 'Thanks — our team will take a look.'),
    onError: (err: any) => Alert.alert('Could not report', err?.message ?? 'Try again.'),
  });

  const shareMutation = useMutation({
    mutationFn: async (post: FeedPost) => {
      const who = post.author?.display_name || post.author?.username || 'Someone';
      const summary = post.body ?? (post.gif_url ? 'shared a GIF' : 'shared a post');
      await Share.share({ message: `${who} on BETTHAT: ${summary}` });
      // Best-effort counter; RLS only lets the author update their own row, so
      // this silently no-ops on other people's posts.
      await supabase.from('social_posts')
        .update({ share_count: post.share_count + 1 }).eq('id', post.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-feed'] }),
  });

  function openPostMenu(post: FeedPost) {
    const mine = post.author?.id === profile?.id;
    Alert.alert(
      mine ? 'Your post' : (post.author?.display_name || post.author?.username || 'Post'),
      undefined,
      mine
        ? [
            { text: 'Delete post', style: 'destructive', onPress: () => deleteMutation.mutate(post.id) },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Report post', style: 'destructive', onPress: () => reportMutation.mutate(post) },
            { text: 'Cancel', style: 'cancel' },
          ],
    );
  }

  // Every handler below is stable across renders and takes the post as an
  // argument. Passing freshly-created closures instead would defeat
  // memo(PostCard) — each row would re-render on every parent render, which is
  // exactly what the VirtualizedList "slow to update" warning was reporting.
  const handleLike = useCallback((post: FeedPost) => {
    likeMutationRef.current?.({ postId: post.id, liked: likedRef.current.has(post.id) });
  }, []);
  const handlePlayer = useCallback((post: FeedPost) => {
    if (post.player) router.push(`/player/${post.player.id}` as any);
  }, [router]);
  const handleAuthor = useCallback((post: FeedPost) => {
    if (post.author) router.push(`/user/${post.author.id}` as any);
  }, [router]);
  const handleMatchup = useCallback((post: FeedPost) => {
    if (post.matchup_id) router.push(`/matchup/${post.matchup_id}` as any);
  }, [router]);
  const handleComment = useCallback((post: FeedPost) => setCommentsFor(post), []);
  const handleShare = useCallback((post: FeedPost) => shareRef.current?.(post), []);
  const handleToggleFollow = useCallback((post: FeedPost) => {
    if (post.author) followRef.current?.(post.author.id, followingRef.current.has(post.author.id));
  }, []);

  const likeMutation = useMutation({
    mutationFn: async ({ postId, liked }: { postId: string; liked: boolean }) => {
      if (!profile?.id) throw new Error('Not signed in');
      if (liked) {
        const { error } = await supabase.from('social_post_likes')
          .delete().eq('post_id', postId).eq('user_id', profile.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('social_post_likes')
          .insert({ post_id: postId, user_id: profile.id });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-feed'] }),
    onError: (err: any) => Alert.alert('Could not update like', err?.message ?? 'Try again.'),
  });

  // A like/comment notification deep-links here with ?post=<id>; open that
  // post's comments once the feed has loaded it.
  useEffect(() => {
    if (!deepLinkedPost || commentsFor) return;
    const target = data?.posts.find((p) => p.id === deepLinkedPost);
    if (target) setCommentsFor(target);
  }, [deepLinkedPost, data?.posts, commentsFor]);

  // Kept in refs so the stable callbacks above never need rebuilding.
  useEffect(() => { likeMutationRef.current = (v) => likeMutation.mutate(v); }, [likeMutation]);
  useEffect(() => { likedRef.current = data?.liked ?? new Set(); }, [data?.liked]);
  useEffect(() => { shareRef.current = (p) => shareMutation.mutate(p); }, [shareMutation]);
  useEffect(() => {
    followRef.current = (targetId, following) => followMutation.mutate({ targetId, following });
    followingRef.current = followingIds ?? new Set();
  }, [followMutation, followingIds]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      {/* ═══ Header card ══════════════════════════════════════════════════ */}
      <View style={s.card}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, lineHeight: 31.2, color: theme.ink }}>
              Social Feed
            </Text>
            <Pressable
              onPress={() => router.push('/social/compose' as any)}
              accessibilityLabel="Create a post"
              style={{
                height: 40, paddingLeft: 12, paddingRight: 16, borderRadius: 100,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
              }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M12 5v14M5 12h14" />
              </Svg>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.ink }}>Post</Text>
            </Pressable>
          </View>

          <View style={s.segTrack}>
            {SEGMENTS.map((sg) => {
              const active = segment === sg.key;
              return (
                <Pressable
                  key={sg.key}
                  onPress={() => setSegment(sg.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[s.segItem, active ? s.segItemOn : null]}
                >
                  <Text style={{
                    fontFamily: active ? FONT.sansMedium : FONT.sans,
                    fontSize: 14, lineHeight: 21.7,
                    color: active ? theme.ink : theme.muted,
                  }}>
                    {sg.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={{ height: 8 }} />

      {segment === 'leaderboard' ? (
        <LeaderboardSegment theme={theme} router={router} meId={profile?.id} />
      ) : (
        <FlatList
          data={visiblePosts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ gap: 8, paddingBottom: NAV_CLEARANCE }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={7}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} colors={[theme.accent]} />
          }
          renderItem={({ item }) => (
            <PostCard
              post={item}
              theme={theme}
              liked={data?.liked.has(item.id) ?? false}
              busy={likeMutation.isPending}
              onLike={handleLike}
              onPlayerPress={handlePlayer}
              onAuthorPress={handleAuthor}
              onMatchupPress={handleMatchup}
              onMenu={openPostMenu}
              onShare={handleShare}
              onComment={handleComment}
              isFollowing={!!(item.author && followingIds?.has(item.author.id))}
              canFollow={!!item.author && item.author.id !== profile?.id}
              onToggleFollow={handleToggleFollow}
            />
          )}
          ListEmptyComponent={
            isLoading ? (
              <View style={{ padding: 60, alignItems: 'center' }}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : isError ? (
              <EmptyState theme={theme} title="Couldn't load the feed." body="Check your connection and try again." onRetry={refetch} />
            ) : (
              <EmptyState
                theme={theme}
                title={segment === 'friends' ? 'No posts from friends yet.'
                     : segment === 'following' ? "You're not following anyone yet."
                     : 'Nothing here yet.'}
                body={segment === 'friends' ? 'Add friends from the Friends screen to see their posts here.'
                    : segment === 'following' ? 'Tap Follow on a post in the Feed tab to start building this.'
                    : "Be the first to post about tonight's slate."}
              />
            )
          }
        />
      )}
      <CommentsSheet
        theme={theme}
        visible={!!commentsFor}
        postId={commentsFor?.id ?? null}
        allowComments={commentsFor?.allow_comments ?? true}
        meId={profile?.id}
        onClose={() => setCommentsFor(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ['social-feed'] })}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// POST CARD
// =============================================================================

const PostCard = memo(function PostCard({
  post, theme, liked, busy, onLike, onPlayerPress, onAuthorPress, onMatchupPress, onMenu, onShare,
  onComment, isFollowing, canFollow, onToggleFollow,
}: {
  post: FeedPost; theme: Theme; liked: boolean; busy: boolean;
  onLike: (p: FeedPost) => void; onPlayerPress: (p: FeedPost) => void; onAuthorPress: (p: FeedPost) => void; onMatchupPress: (p: FeedPost) => void;
  onMenu: (p: FeedPost) => void; onShare: (p: FeedPost) => void; onComment: (p: FeedPost) => void;
  isFollowing: boolean; canFollow: boolean; onToggleFollow: (p: FeedPost) => void;
}) {
  const s = styles(theme);
  const author = post.author;
  const name = author?.display_name || author?.username || 'Someone';
  const likeCount = post.likes?.[0]?.count ?? 0;
  const commentCount = post.comments?.[0]?.count ?? 0;

  return (
    <View style={[s.card, { padding: 16, gap: 16 }]}>
      {/* Author */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => onAuthorPress(post)} accessibilityLabel={`View ${name}`} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar theme={theme} uri={author?.avatar_url ?? null} name={name} size={36} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
            {name}
          </Text>
        </Pressable>
        {canFollow ? (
          <Pressable
            onPress={() => onToggleFollow(post)}
            accessibilityLabel={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
            style={{
              height: 28, paddingHorizontal: 12, borderRadius: 100,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: isFollowing ? theme.surfaceSunken : theme.ink,
              borderWidth: isFollowing ? 1 : 0, borderColor: theme.hairline,
            }}
          >
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: isFollowing ? theme.muted : theme.surface }}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => onMenu(post)} hitSlop={8} accessibilityLabel="Post options" style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill={theme.ink}>
            <Circle cx={12} cy={5} r={1.7} /><Circle cx={12} cy={12} r={1.7} /><Circle cx={12} cy={19} r={1.7} />
          </Svg>
        </Pressable>
      </View>

      {/* Body + timestamp */}
      <View style={{ gap: 8 }}>
        {post.body ? <HighlightedBody text={post.body} theme={theme} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.meta}>{formatPostDate(post.created_at)}</Text>
          <View style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: theme.muted }} />
          <Text style={s.meta}>{formatPostTime(post.created_at)}</Text>
        </View>
      </View>

      {/* Attached GIF — independent of the player/matchup card, so a post can
          carry both a GIF and a shared matchup. */}
      {post.gif_url ? (
        <Image
          source={{ uri: post.gif_url }}
          style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: theme.surfaceSunken }}
          resizeMode="cover"
          accessibilityLabel="GIF"
        />
      ) : null}

      {/* Attached player position */}
      {post.player && post.attachment_kind ? (
        <AttachedPosition post={post} theme={theme} onPress={() => onPlayerPress(post)} />
      ) : null}

      {/* Shared matchup — scores re-read live from player_game_stats */}
      {post.matchup_snapshot ? (
        <SharedMatchupCard snapshot={post.matchup_snapshot} theme={theme} onPress={() => onMatchupPress(post)} />
      ) : null}

      {/* Actions */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
        <ActionButton
          theme={theme} count={likeCount} active={liked} disabled={busy} onPress={() => onLike(post)}
          label={liked ? 'Unlike' : 'Like'}
          icon={(color, filled) => (
            <Svg width={20} height={20} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
            </Svg>
          )}
        />
        <ActionButton
          theme={theme} count={commentCount}
          label={post.allow_comments ? 'Comments' : 'Comments are off'}
          onPress={() => onComment(post)}
          dimmed={!post.allow_comments}
          icon={(color) => (
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-5a8.4 8.4 0 0 1-.9-4 8.4 8.4 0 0 1 8.4-8.4h.5A8.4 8.4 0 0 1 21 11v.5z" />
            </Svg>
          )}
        />
        <ActionButton
          theme={theme} count={post.share_count} label="Share post" onPress={() => onShare(post)}
          icon={(color) => (
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Circle cx={18} cy={5} r={3} /><Circle cx={6} cy={12} r={3} /><Circle cx={18} cy={19} r={3} />
              <Path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
            </Svg>
          )}
        />
      </View>
    </View>
  );
});

/** The spec's Stock block: identity row + change pill over a price + CTA footer. */
function AttachedPosition({ post, theme, onPress }: { post: FeedPost; theme: Theme; onPress: () => void }) {
  const p = post.player!;
  const pp = p.player_prices;
  const pct = Number(pp?.price_change_pct_24h ?? 0);
  const abs = Math.abs(Number(pp?.price_change_24h ?? 0));
  const up = pct >= 0;
  const color = up ? theme.gain : theme.danger;
  const wash = up ? 'rgba(42, 127, 59, 0.10)' : 'rgba(240, 93, 93, 0.10)';
  const ticker = (p.ticker_handle ?? p.full_name ?? '').toUpperCase();
  const isBuy = post.attachment_kind === 'buy';

  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>
      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: theme.hairline }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 100, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, lineHeight: 24, color: theme.ink }}>
              {(ticker || '?').charAt(0)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>{ticker}</Text>
            <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 14, lineHeight: 21, color: theme.muted2 }}>
              {p.full_name} - {p.team_abbreviation}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 100, paddingVertical: 4, paddingLeft: 8, paddingRight: 12, backgroundColor: wash }}>
          <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={12} height={10} viewBox="0 0 12 10">
              <Path d={up ? 'M6 0 L12 10 L0 10 Z' : 'M0 0 L12 0 L6 10 Z'} fill={color} />
            </Svg>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color }}>{fmtPrice(abs)}</Text>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color }}>({Math.abs(pct).toFixed(2)}%)</Text>
          </View>
        </View>
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.muted }}>
            {isBuy ? 'Bought at' : 'Sold at'} {post.attachment_at ? formatPostTime(post.attachment_at) : ''}
          </Text>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
            {fmtPrice(post.attachment_price)}
          </Text>
        </View>
        <Pressable
          onPress={onPress}
          accessibilityLabel={`${isBuy ? 'Draft' : 'View'} ${ticker}`}
          style={{
            height: 48, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
          }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.ink }}>
            {isBuy ? 'Buy' : 'Sell'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ActionButton({
  theme, count, icon, label, active, disabled, dimmed, onPress,
}: {
  theme: Theme; count: number; label: string;
  icon: (color: string, filled: boolean) => ReactNode;
  active?: boolean; disabled?: boolean; dimmed?: boolean; onPress?: () => void;
}) {
  const color = active ? theme.danger : dimmed ? theme.faint : theme.muted;
  const body = (
    <>
      <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
        {icon(color, !!active)}
      </View>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color }}>{count}</Text>
    </>
  );
  const style = { flexDirection: 'row', alignItems: 'center', gap: 8 } as const;
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityLabel={label} style={[style, disabled ? { opacity: 0.5 } : null]}>
      {body}
    </Pressable>
  );
}

// =============================================================================
// TEXT HIGHLIGHTING
// The export renders inline tickers and dollar amounts in the brand accent.
// =============================================================================

const HIGHLIGHT = /(\$\d[\d,]*(?:\.\d+)?|\b[A-Z]{3,}\d*\b)/g;

function HighlightedBody({ text, theme }: { text: string; theme: Theme }) {
  // split() with a capturing group interleaves plain text and matches, so the
  // odd indices are exactly the tokens to tint — no re-testing needed (and no
  // lastIndex hazard from reusing a /g regex).
  const parts = useMemo(() => text.split(HIGHLIGHT), [text]);
  return (
    <Text style={{ fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.ink }}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={{ fontFamily: FONT.sansMedium, color: theme.accentInk }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

function formatPostDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatPostTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// =============================================================================
// SHARED BITS
// =============================================================================

function Avatar({ theme, uri, name, size }: { theme: Theme; uri: string | null; name: string; size: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 9999 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: 9999, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: Math.round(size * 0.42), color: theme.ink }}>
        {name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function EmptyState({ theme, title, body, onRetry }: { theme: Theme; title: string; body: string; onRetry?: () => void }) {
  return (
    <View style={{ padding: 60, alignItems: 'center', gap: 10 }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: theme.ink, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center' }}>{body}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={{ marginTop: 4, paddingHorizontal: 16, height: 36, borderRadius: 999, backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accentEdge, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: theme.ink }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// =============================================================================
// LEADERBOARD SEGMENT
// Feed / Friends / Following all render the same post list with different
// scoping; only the board is a different shape.
// =============================================================================

function LeaderboardSegment({ theme, router, meId }: { theme: Theme; router: ReturnType<typeof useRouter>; meId?: string }) {
  const s = styles(theme);
  const { data, isLoading } = useQuery({
    queryKey: ['social-leaderboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leaderboard_entries')
        .select('rank, score, wins, losses, win_rate, user:profiles(id, username, display_name, avatar_url)')
        .eq('period_type', 'weekly')
        .order('rank', { ascending: true })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: NAV_CLEARANCE }} showsVerticalScrollIndicator={false}>
      <View style={[s.card, { padding: 16, gap: 14 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.sectionTitle}>This week</Text>
          <Pressable onPress={() => router.push('/leaderboard' as any)} hitSlop={8}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.muted }}>Full board</Text>
          </Pressable>
        </View>
        {isLoading ? (
          <ActivityIndicator color={theme.accent} />
        ) : (data ?? []).length === 0 ? (
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>No entries for this week yet.</Text>
        ) : (
          (data ?? []).map((row: any) => {
            const isMe = row.user?.id === meId;
            return (
              <View
                key={`${row.rank}-${row.user?.id}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 8, paddingHorizontal: isMe ? 10 : 0, marginHorizontal: isMe ? -10 : 0,
                  borderRadius: 12, backgroundColor: isMe ? theme.accentWash : 'transparent',
                }}
              >
                <Text style={{ width: 24, fontFamily: FONT.sansBold, fontSize: 14, color: theme.muted }}>{row.rank}</Text>
                <Avatar theme={theme} uri={row.user?.avatar_url ?? null} name={row.user?.display_name || row.user?.username || '?'} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
                    {row.user?.display_name || row.user?.username || 'Unknown'}
                  </Text>
                  <Text style={{ fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: theme.muted2 }}>
                    {row.wins}W – {row.losses}L · {Number(row.win_rate ?? 0).toFixed(0)}%
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>{fmtPrice(row.score)}</Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

function styles(t: Theme) {
  return {
    card: {
      backgroundColor: t.surface,
      borderRadius: 20,
      shadowColor: '#151517',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: t.mode === 'light' ? 0.05 : 0,
      shadowRadius: 8,
      elevation: t.mode === 'light' ? 2 : 0,
    },
    sectionTitle: { fontFamily: FONT.sansBold, fontSize: 18, lineHeight: 27, color: t.ink },
    meta: { fontFamily: FONT.sans, fontSize: 14, lineHeight: 21, color: t.muted },
    segTrack: {
      flexDirection: 'row' as const, height: 40, borderRadius: 100,
      backgroundColor: t.surfaceSunken, overflow: 'hidden' as const,
    },
    segItem: {
      flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const,
      borderRadius: 100, paddingHorizontal: 16,
    },
    segItemOn: {
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.hairline,
    },
  };
}
