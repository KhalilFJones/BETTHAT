// =============================================================================
// BETTHAT — Sidebets Feed (Holy Grail V2, Screen 09)
// SCRUM-205: Hot / New / Friends tabs. Bloomberg prop strip. Realtime prepend.
// SCRUM-206: Report + block on every card.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtRelative,
  playerInitials,
} from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { SectionHead } from '@/components/holygrail/SectionHead';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

type FeedTab = 'hot' | 'new' | 'my-takes' | 'friends';

const SIDEBET_SELECT = `
  id, creator_id, opponent_id, stat_category, line_value, creator_side,
  creator_reasoning, wager_amount, like_count, dislike_count, comment_count,
  status, winner_id, expires_at, created_at,
  creator:profiles!creator_id(id, username, display_name, rank_tier),
  nba_players(id, full_name, first_name, last_name, ticker_handle, jersey_number, team_abbreviation, position),
  nba_games(id, home_team_abbreviation, away_team_abbreviation, status, tip_off_time)
`;

export default function SidebetsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();

  const [activeTab, setActiveTab] = useState<FeedTab>('new');
  const [reportTarget, setReportTarget] = useState<{ sidebetId: string; userId: string } | null>(null);

  // ── Friends IDs (needed for Friends tab) ──
  const { data: friendIds } = useQuery({
    queryKey: ['friend-ids', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [] as string[];
      const { data } = await supabase
        .from('friends')
        .select('requester_id, recipient_id')
        .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
        .eq('status', 'accepted');
      return (data ?? []).map((r: any) =>
        r.requester_id === profile.id ? r.recipient_id : r.requester_id,
      ) as string[];
    },
    enabled: !!profile?.id,
  });

  const { data: myTakes, isLoading: myTakesLoading, isRefetching: myTakesRefetching, refetch: myTakesRefetch } = useQuery({
    queryKey: ['my-takes', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('sidebets')
        .select(SIDEBET_SELECT)
        .or(`creator_id.eq.${profile.id},opponent_id.eq.${profile.id}`)
        .order('created_at', { ascending: false })
        .limit(50);
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  // ── Main feed query, tab-aware ──
  const { data: sidebets, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['sidebets-feed', activeTab, profile?.id, friendIds],
    queryFn: async () => {
      let q = supabase
        .from('sidebets')
        .select(SIDEBET_SELECT)
        .eq('is_open', true)
        .eq('status', 'open');

      if (activeTab === 'my-takes') {
        return { feed: [], myReactions: new Map<string, 'like' | 'dislike'>() };
      }

      if (activeTab === 'hot') {
        q = q.order('like_count', { ascending: false }).order('created_at', { ascending: false });
      } else if (activeTab === 'new') {
        q = q.order('created_at', { ascending: false });
      } else {
        // Friends tab — show sidebets from friends (or empty if no friends)
        const ids = friendIds ?? [];
        if (ids.length === 0) return { feed: [], myReactions: new Map<string, 'like' | 'dislike'>() };
        q = q.in('creator_id', ids).order('created_at', { ascending: false });
      }
      q = q.limit(40);

      const [feedResult, myReactionsResult] = await Promise.all([
        q,
        profile?.id
          ? supabase.from('sidebet_reactions').select('sidebet_id, reaction').eq('user_id', profile.id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (feedResult.error) throw feedResult.error;
      const myReactions = new Map<string, 'like' | 'dislike'>();
      for (const r of (myReactionsResult.data ?? [])) {
        myReactions.set((r as any).sidebet_id, (r as any).reaction);
      }
      return { feed: feedResult.data ?? [], myReactions };
    },
    refetchInterval: 60_000,
  });

  // ── Realtime: prepend new sidebets (new/hot tabs only) ──
  useEffect(() => {
    if (activeTab === 'friends' || activeTab === 'my-takes') return;
    const channel = supabase
      .channel('sidebets-new')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sidebets' },
        () => { qc.invalidateQueries({ queryKey: ['sidebets-feed', activeTab] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTab]);

  // ── Like / dislike mutation ──
  const reactMutation = useMutation({
    mutationFn: async ({ sidebetId, reaction }: { sidebetId: string; reaction: 'like' | 'dislike' | 'clear' }) => {
      if (!profile?.id) return;
      await supabase.from('sidebet_reactions').delete().eq('sidebet_id', sidebetId).eq('user_id', profile.id);
      if (reaction !== 'clear') {
        await supabase.from('sidebet_reactions').insert({ sidebet_id: sidebetId, user_id: profile.id, reaction });
      }
      const [{ count: likes }, { count: dislikes }] = await Promise.all([
        supabase.from('sidebet_reactions').select('id', { count: 'exact', head: true }).eq('sidebet_id', sidebetId).eq('reaction', 'like'),
        supabase.from('sidebet_reactions').select('id', { count: 'exact', head: true }).eq('sidebet_id', sidebetId).eq('reaction', 'dislike'),
      ]);
      await supabase.from('sidebets').update({ like_count: likes ?? 0, dislike_count: dislikes ?? 0 }).eq('id', sidebetId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sidebets-feed'] }),
  });

  // ── Report mutation ──
  const reportMutation = useMutation({
    mutationFn: async ({ sidebetId, reason }: { sidebetId: string; reason: string }) => {
      if (!profile?.id) return;
      await supabase.from('user_reports' as never).insert({
        reporter_id: profile.id,
        reported_sidebet_id: sidebetId,
        reason,
      } as never);
    },
    onSuccess: () => {
      setReportTarget(null);
      Alert.alert('Reported', 'Thank you. Our moderation team will review this post.');
    },
    onError: (err: Error) => Alert.alert('Could not report', err.message),
  });

  // ── Block mutation ──
  const blockMutation = useMutation({
    mutationFn: async (blockedUserId: string) => {
      if (!profile?.id) return;
      await supabase.from('user_blocks' as never).upsert({
        blocker_id: profile.id,
        blocked_id: blockedUserId,
      } as never);
    },
    onSuccess: () => {
      setReportTarget(null);
      qc.invalidateQueries({ queryKey: ['sidebets-feed'] });
      Alert.alert('Blocked', 'You will no longer see posts from this user.');
    },
    onError: (err: Error) => Alert.alert('Could not block', err.message),
  });

  function openReport(sidebetId: string, userId: string) {
    setReportTarget({ sidebetId, userId });
  }

  const activeFeed = activeTab === 'my-takes' ? (myTakes ?? []) : (sidebets?.feed ?? []);
  const activeLoading = activeTab === 'my-takes' ? myTakesLoading : isLoading;
  const activeRefreshing = activeTab === 'my-takes' ? myTakesRefetching : isRefetching;
  const activeCount = activeFeed.length;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />

      {/* Tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4, gap: 8 }}>
        {(['new', 'hot', 'my-takes', 'friends'] as FeedTab[]).map((tab) => {
          const active = activeTab === tab;
          const label = tab === 'new' ? 'New' : tab === 'hot' ? 'Hot 🔥' : tab === 'my-takes' ? 'My Takes' : 'Friends';
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={{
                height: 34, paddingHorizontal: 16, borderRadius: 999,
                backgroundColor: active ? HG.sky : HG.surface,
                borderWidth: 1, borderColor: active ? HG.sky : HG.hairline,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: active ? FONT.monoBold : FONT.monoMedium, fontSize: 11, color: active ? HG.jet : HG.muted, letterSpacing: 0.6 }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={activeRefreshing}
            onRefresh={() => {
              refetch();
              myTakesRefetch();
            }}
            tintColor={HG.sky}
          />
        }
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <SectionHead
          word={activeTab === 'my-takes' ? 'Your' : 'Open'}
          emphasis={activeTab === 'my-takes' ? 'takes' : 'sidebets'}
          label={`${activeCount} ${activeTab}`}
        />

        {activeLoading ? (
          <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
        ) : activeFeed.length === 0 ? (
          <EmptyState tab={activeTab} onPost={() => router.push('/sidebet/create' as any)} />
        ) : (
          <View style={{ paddingHorizontal: 18, gap: 16 }}>
            {activeTab === 'my-takes'
              ? activeFeed.map((sb: any) => (
                  <MyTakeCard
                    key={sb.id}
                    sidebet={sb}
                    userId={profile?.id ?? ''}
                    onPlayerTap={() => sb.nba_players && router.push(`/player/${sb.nba_players.id}` as any)}
                  />
                ))
              : activeFeed.map((sb: any) => (
                  <SidebetCard
                    key={sb.id}
                    sidebet={sb}
                    myReaction={sidebets?.myReactions.get(sb.id)}
                    isOwnPost={sb.creator_id === profile?.id}
                    onAccept={() => router.push(`/sidebet/${sb.id}` as any)}
                    onPlayerTap={() => sb.nba_players && router.push(`/player/${sb.nba_players.id}` as any)}
                    onLike={() => reactMutation.mutate({
                      sidebetId: sb.id,
                      reaction: sidebets?.myReactions.get(sb.id) === 'like' ? 'clear' : 'like',
                    })}
                    onDislike={() => reactMutation.mutate({
                      sidebetId: sb.id,
                      reaction: sidebets?.myReactions.get(sb.id) === 'dislike' ? 'clear' : 'dislike',
                    })}
                    onReport={() => openReport(sb.id, sb.creator_id)}
                  />
                ))}
          </View>
        )}

        <Pressable
          onPress={() => router.push('/sidebet/create' as any)}
          style={{
            marginTop: 22, marginHorizontal: 18,
            height: 48, borderRadius: 999,
            backgroundColor: HG.surface, borderColor: HG.skyEdge, borderWidth: 1,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
          }}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={HG.sky} strokeWidth={2} strokeLinecap="round">
            <Path d="M12 5v14M5 12h14" />
          </Svg>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.sky, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Post a take
          </Text>
        </Pressable>
      </ScrollView>

      {/* Report / Block modal */}
      <Modal
        visible={!!reportTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setReportTarget(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => setReportTarget(null)}
        >
          <Pressable
            onPress={() => {}}
            style={{ backgroundColor: HG.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 }}
          >
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 17, color: HG.ink, textAlign: 'center', marginBottom: 4 }}>
              Report this post
            </Text>
            {(['Harassment or bullying', 'Hate speech', 'Threats or violence', 'Spam or fake post'] as const).map((reason) => (
              <Pressable
                key={reason}
                onPress={() => reportTarget && reportMutation.mutate({ sidebetId: reportTarget.sidebetId, reason })}
                style={({ pressed }) => ({
                  padding: 16, borderRadius: 12,
                  backgroundColor: pressed ? HG.surface : HG.inputBg,
                  borderWidth: 1, borderColor: HG.hairline,
                })}
              >
                <Text style={{ fontFamily: FONT.sans, fontSize: 15, color: HG.ink }}>{reason}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => reportTarget && blockMutation.mutate(reportTarget.userId)}
              style={({ pressed }) => ({
                padding: 16, borderRadius: 12, marginTop: 4,
                backgroundColor: pressed ? HG.downSoft : HG.inputBg,
                borderWidth: 1, borderColor: HG.down + '44',
              })}
            >
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: HG.down }}>Block this user</Text>
            </Pressable>
            <Pressable
              onPress={() => setReportTarget(null)}
              style={{ padding: 14, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: FONT.sans, fontSize: 15, color: HG.muted }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({ tab, onPost }: { tab: FeedTab; onPost: () => void }) {
  const messages: Record<FeedTab, string> = {
    new: 'No open sidebets right now. Post the first one.',
    hot: 'Nothing trending yet. Post a take and light the feed up.',
    'my-takes': "You haven't posted any takes yet. Start by posting a take.",
    friends: 'None of your friends have open sidebets. Challenge them.',
  };
  return (
    <View style={{ paddingHorizontal: 18 }}>
      <View style={{ padding: 28, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, alignItems: 'center', gap: 14 }}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center', lineHeight: 19 }}>
          {messages[tab]}
        </Text>
        <Pressable
          onPress={onPost}
          style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: HG.sky }}
        >
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.jet, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Post a Take
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// =============================================================================
// MY TAKE CARD
// =============================================================================

function MyTakeCard({
  sidebet, userId, onPlayerTap,
}: {
  sidebet: any;
  userId: string;
  onPlayerTap: () => void;
}) {
  const p = sidebet.nba_players;
  const game = sidebet.nba_games;
  const c = sidebet.creator;
  const overSelected = sidebet.creator_side === 'OVER';
  const statLabel = labelForStat(sidebet.stat_category);
  const status = sidebet.status === 'completed'
    ? sidebet.winner_id === userId ? 'WON' : 'LOST'
    : sidebet.status === 'open' ? 'OPEN' : 'PENDING';
  const statusColor = status === 'WON' ? HG.up : status === 'LOST' ? HG.down : status === 'OPEN' ? HG.sky : '#F5A623';
  const statusBg = status === 'WON' ? HG.upSoft : status === 'LOST' ? HG.downSoft : status === 'OPEN' ? HG.skySoft : '#F5A62322';
  const statusBorder = status === 'WON' ? HG.up + '44' : status === 'LOST' ? HG.down + '44' : status === 'OPEN' ? HG.skyEdge : '#F5A62355';

  return (
    <View style={{ backgroundColor: HG.surface, borderRadius: 16, borderWidth: 1, borderColor: HG.hairline, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.sky, letterSpacing: 0.4 }}>
            {c?.username ?? '—'}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>
            · {fmtRelative(sidebet.created_at)}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: HG.skyEdge }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 0.4 }}>
            {fmtPrice(sidebet.wager_amount)}
          </Text>
        </View>
      </View>

      {sidebet.creator_reasoning ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 14.5, color: HG.ink, lineHeight: 21 }}>
            {sidebet.creator_reasoning}
          </Text>
        </View>
      ) : null}

      <View style={{ marginHorizontal: 16, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: HG.inputBg, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink2, letterSpacing: 0.4 }}>
          {p?.full_name ?? '—'}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
        <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 0.6 }}>
          {statLabel}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink }}>
          {Number(sidebet.line_value).toFixed(1)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: HG.skySoft }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.sky, letterSpacing: 0.8 }}>
            {overSelected ? '↑ OVER' : '↓ UNDER'}
          </Text>
        </View>
        {game && (
          <>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>
              {game.away_team_abbreviation} @ {game.home_team_abbreviation}
            </Text>
          </>
        )}
      </View>

      <Pressable onPress={onPlayerTap} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: 1, borderTopColor: HG.hairline }}>
        {p ? <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={42} /> : null}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
            {p?.full_name ?? '—'}
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted, marginTop: 2 }}>
            {p?.team_abbreviation} · {p?.position}
          </Text>
        </View>
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderColor: HG.hairline }}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Counter label="LIKES" value={sidebet.like_count ?? 0} />
          <Counter label="DISLIKES" value={sidebet.dislike_count ?? 0} />
          <Counter label="REPLIES" value={sidebet.comment_count ?? 0} />
        </View>
        <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: statusBg, borderWidth: 1, borderColor: statusBorder }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: statusColor, letterSpacing: 1, textTransform: 'uppercase' }}>
            {status}
          </Text>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// SIDEBET CARD
// =============================================================================

function SidebetCard({
  sidebet, myReaction, isOwnPost, onAccept, onPlayerTap, onLike, onDislike, onReport,
}: {
  sidebet: any;
  myReaction?: 'like' | 'dislike';
  isOwnPost: boolean;
  onAccept: () => void;
  onPlayerTap: () => void;
  onLike: () => void;
  onDislike: () => void;
  onReport: () => void;
}) {
  const p = sidebet.nba_players;
  const game = sidebet.nba_games;
  const c = sidebet.creator;
  const overSelected = sidebet.creator_side === 'OVER';
  const statLabel = labelForStat(sidebet.stat_category);

  return (
    <View style={{ backgroundColor: HG.surface, borderRadius: 16, borderWidth: 1, borderColor: HG.hairline, overflow: 'hidden' }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.sky, letterSpacing: 0.4 }}>
            {c?.username ?? '—'}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>
            · {fmtRelative(sidebet.created_at)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: HG.skyEdge }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 0.4 }}>
              {fmtPrice(sidebet.wager_amount)}
            </Text>
          </View>
          {!isOwnPost && (
            <Pressable onPress={onReport} hitSlop={10}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.muted2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <Path d="M12 9v4M12 17h.01" />
              </Svg>
            </Pressable>
          )}
        </View>
      </View>

      {/* Commentary */}
      {sidebet.creator_reasoning ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 14.5, color: HG.ink, lineHeight: 21 }}>
            {sidebet.creator_reasoning}
          </Text>
        </View>
      ) : null}

      {/* Bloomberg prop strip */}
      <View style={{ marginHorizontal: 16, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: HG.inputBg, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink2, letterSpacing: 0.4 }}>
          {p?.full_name ?? '—'}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
        <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 0.6 }}>
          {statLabel}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink }}>
          {Number(sidebet.line_value).toFixed(1)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: HG.skySoft }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.sky, letterSpacing: 0.8 }}>
            {overSelected ? '↑ OVER' : '↓ UNDER'}
          </Text>
        </View>
        {game && (
          <>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2 }}>·</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>
              {game.away_team_abbreviation} @ {game.home_team_abbreviation}
            </Text>
          </>
        )}
      </View>

      {/* Player tile + stat panel */}
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: HG.hairline }}>
        <Pressable onPress={onPlayerTap} style={{ flex: 1, padding: 14, borderRightWidth: 1, borderColor: HG.hairline, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {p ? <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={42} /> : null}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
                {p?.full_name ?? '—'}
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4, marginTop: 2 }}>
                {p?.team_abbreviation ?? ''} · {p?.position ?? ''}
              </Text>
            </View>
          </View>
        </Pressable>

        <View style={{ flex: 1, padding: 14, gap: 8 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            {statLabel}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 22, color: HG.ink, letterSpacing: -0.3 }}>
            {Number(sidebet.line_value).toFixed(1)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <ArrowChip label="OVER" lit={overSelected} />
            <ArrowChip label="UNDER" lit={!overSelected} />
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingTop: 12, borderTopWidth: 1, borderColor: HG.hairline }}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <ReactionButton kind="like" count={sidebet.like_count ?? 0} active={myReaction === 'like'} onPress={onLike} />
          <ReactionButton kind="dislike" count={sidebet.dislike_count ?? 0} active={myReaction === 'dislike'} onPress={onDislike} />
          <Counter label="REPLIES" value={sidebet.comment_count ?? 0} />
        </View>
        <Pressable
          onPress={onAccept}
          disabled={isOwnPost}
          style={{
            height: 32, paddingHorizontal: 14, borderRadius: 999,
            backgroundColor: isOwnPost ? HG.surface : HG.sky,
            borderWidth: isOwnPost ? 1 : 0,
            borderColor: HG.hairline,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: isOwnPost ? HG.muted : HG.jet, letterSpacing: 1, textTransform: 'uppercase' }}>
            {isOwnPost ? 'Your take' : `Take ${overSelected ? 'UNDER' : 'OVER'}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ReactionButton({
  kind, count, active, onPress,
}: { kind: 'like' | 'dislike'; count: number; active: boolean; onPress: () => void }) {
  const tint = active ? HG.sky : HG.muted;
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {kind === 'like' ? (
          <Path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 2 2.34l-1.42 9A2 2 0 0 1 18.43 23H7V10l4-9 1.46.5a2 2 0 0 1 1.34 2.45z" />
        ) : (
          <Path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-2-2.34l1.42-9A2 2 0 0 1 5.57 1H17v13l-4 9-1.46-.5a2 2 0 0 1-1.34-2.45z" />
        )}
      </Svg>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: active ? HG.sky : HG.ink2 }}>
        {count}
      </Text>
    </Pressable>
  );
}

function ArrowChip({ label, lit }: { label: 'OVER' | 'UNDER'; lit: boolean }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: lit ? HG.skySoft : 'transparent', borderWidth: 1, borderColor: lit ? HG.skyEdge : HG.hairline2, flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 0.6, color: lit ? HG.sky : HG.muted2 }}>
        {label === 'OVER' ? '↑' : '↓'} {label}
      </Text>
    </View>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink2 }}>{value}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function labelForStat(category: string): string {
  switch (category) {
    case 'points': return 'PTS';
    case 'rebounds': return 'REB';
    case 'assists': return 'AST';
    case 'steals': return 'STL';
    case 'blocks': return 'BLK';
    case 'turnovers': return 'TO';
    case 'three_pointers': return '3PM';
    case 'pts_reb_ast': return 'PTS+REB+AST';
    case 'pts_reb': return 'PTS+REB';
    case 'pts_ast': return 'PTS+AST';
    case 'reb_ast': return 'REB+AST';
    default: return category.toUpperCase();
  }
}