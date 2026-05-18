// =============================================================================
// BETTHAT — Sidebets Feed (Holy Grail V2, Screen 09)
// Peer-to-peer prop posts. Username, take text, player+stat lines, like/dislike,
// swipe-to-accept. Likes/dislikes write to sidebet_reactions and recompute counts.
// =============================================================================

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
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

export default function SidebetsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();

  const { data: sidebets, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['sidebets-feed', profile?.id],
    queryFn: async () => {
      const [feedQ, myReactionsQ] = await Promise.all([
        supabase
          .from('sidebets')
          .select(`
            id, creator_id, opponent_id, stat_category, line_value, creator_side,
            creator_reasoning, wager_amount, like_count, dislike_count, comment_count,
            status, expires_at, created_at,
            creator:profiles!creator_id(id, username, display_name, rank_tier),
            nba_players(id, full_name, first_name, last_name, ticker_handle, jersey_number, team_abbreviation, position),
            nba_games(id, home_team_abbreviation, away_team_abbreviation, status, tip_off_time)
          `)
          .eq('is_open', true)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(30),
        profile?.id
          ? supabase.from('sidebet_reactions').select('sidebet_id, reaction').eq('user_id', profile.id)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (feedQ.error) throw feedQ.error;
      const myReactions = new Map<string, 'like' | 'dislike'>();
      for (const r of (myReactionsQ.data ?? [])) {
        myReactions.set((r as any).sidebet_id, (r as any).reaction);
      }
      return { feed: feedQ.data ?? [], myReactions };
    },
    refetchInterval: 30_000,
  });

  // Like / dislike mutation. Writes to sidebet_reactions, then recounts.
  const reactMutation = useMutation({
    mutationFn: async ({ sidebetId, reaction }: { sidebetId: string; reaction: 'like' | 'dislike' | 'clear' }) => {
      if (!profile?.id) return;
      // Always wipe the user's existing reaction first (toggle / switch behaviour)
      await supabase.from('sidebet_reactions').delete().eq('sidebet_id', sidebetId).eq('user_id', profile.id);
      if (reaction !== 'clear') {
        await supabase.from('sidebet_reactions').insert({
          sidebet_id: sidebetId,
          user_id: profile.id,
          reaction,
        });
      }
      // Recount denormalised counters
      const [{ count: likes }, { count: dislikes }] = await Promise.all([
        supabase.from('sidebet_reactions').select('id', { count: 'exact', head: true }).eq('sidebet_id', sidebetId).eq('reaction', 'like'),
        supabase.from('sidebet_reactions').select('id', { count: 'exact', head: true }).eq('sidebet_id', sidebetId).eq('reaction', 'dislike'),
      ]);
      await supabase.from('sidebets').update({ like_count: likes ?? 0, dislike_count: dislikes ?? 0 }).eq('id', sidebetId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sidebets-feed'] }),
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={HG.sky} />}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <SectionHead word="Open" emphasis="sidebets" label={String(sidebets?.feed?.length ?? 0)} />

        {isLoading ? (
          <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
        ) : (sidebets?.feed ?? []).length === 0 ? (
          <View style={{ paddingHorizontal: 18 }}>
            <View style={{ padding: 28, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center', lineHeight: 19 }}>
                No open sidebets right now. Post the first one.
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 18, gap: 16 }}>
            {(sidebets?.feed ?? []).map((sb: any) => (
              <SidebetCard
                key={sb.id}
                sidebet={sb}
                myReaction={sidebets?.myReactions.get(sb.id)}
                isOwnPost={sb.creator_id === profile?.id}
                onAccept={() => router.push(`/sidebet/${sb.id}` as any)}
                onPlayerTap={() => sb.nba_players && router.push(`/player/${sb.nba_players.id}` as any)}
                onLike={() =>
                  reactMutation.mutate({
                    sidebetId: sb.id,
                    reaction: sidebets?.myReactions.get(sb.id) === 'like' ? 'clear' : 'like',
                  })
                }
                onDislike={() =>
                  reactMutation.mutate({
                    sidebetId: sb.id,
                    reaction: sidebets?.myReactions.get(sb.id) === 'dislike' ? 'clear' : 'dislike',
                  })
                }
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
    </SafeAreaView>
  );
}

// =============================================================================
function SidebetCard({
  sidebet, myReaction, isOwnPost, onAccept, onPlayerTap, onLike, onDislike,
}: {
  sidebet: any;
  myReaction?: 'like' | 'dislike';
  isOwnPost: boolean;
  onAccept: () => void;
  onPlayerTap: () => void;
  onLike: () => void;
  onDislike: () => void;
}) {
  const p = sidebet.nba_players;
  const game = sidebet.nba_games;
  const c = sidebet.creator;
  const overSelected = sidebet.creator_side === 'OVER';
  const statLabel = labelForStat(sidebet.stat_category);

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

      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: HG.hairline }}>
        <Pressable onPress={onPlayerTap} style={{ flex: 1, padding: 14, borderRightWidth: 1, borderColor: HG.hairline, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {p ? <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={42} /> : null}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
                {p?.full_name ?? '—'}
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4, marginTop: 2 }}>
                {p?.ticker_handle ?? ''}
              </Text>
              {game ? (
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4, marginTop: 4 }}>
                  {game.away_team_abbreviation} @ {game.home_team_abbreviation}
                </Text>
              ) : null}
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
    case 'pts_reb_ast': return 'PTS + REB + AST';
    case 'pts_reb': return 'PTS + REB';
    case 'pts_ast': return 'PTS + AST';
    case 'reb_ast': return 'REB + AST';
    default: return category.toUpperCase();
  }
}
