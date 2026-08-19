import { useMemo } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Rect } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { FONT, fmtPrice } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';

// =============================================================================
// Figma "shared matchup" block inside a feed post — header (opponent avatar,
// format, vs. line, status pill) over a body of Payout, three slot pairings
// and a Total, split by a hairline.
//
// The post only stores WHO faced WHOM (see MatchupSnapshot). Fantasy points
// are read live from player_game_stats, which any authenticated user can
// select, so a shared live matchup keeps updating for every viewer instead of
// freezing at the moment it was posted.
// =============================================================================

export interface MatchupSnapshotSlot {
  slot: number;
  mine: { player_id: string; name: string };
  theirs: { player_id: string; name: string } | null;
}

export interface MatchupSnapshot {
  matchup_id: string;
  game_date: string;
  format: string;
  payout: number;
  opponent: { id: string | null; username: string | null; avatar_url: string | null } | null;
  slots: MatchupSnapshotSlot[];
}

const WIN_TICK = '#53D175';
const LOSS_TICK = '#E39898';
const LIVE_WASH = '#FAEDED';

type Phase = 'upcoming' | 'live' | 'final';

export function SharedMatchupCard({
  snapshot, theme, onPress,
}: {
  snapshot: MatchupSnapshot; theme: Theme; onPress?: () => void;
}) {
  const playerIds = useMemo(() => {
    const ids: string[] = [];
    for (const s of snapshot.slots ?? []) {
      if (s.mine?.player_id) ids.push(s.mine.player_id);
      if (s.theirs?.player_id) ids.push(s.theirs.player_id);
    }
    return Array.from(new Set(ids));
  }, [snapshot]);

  // Live scores + phase, both derived from world-readable tables.
  const { data, isLoading } = useQuery({
    queryKey: ['shared-matchup-scores', snapshot.matchup_id, snapshot.game_date, playerIds.length],
    queryFn: async () => {
      const fp = new Map<string, number>();
      let anyStats = false;
      let allFinal = true;

      if (playerIds.length > 0) {
        const { data: rows } = await supabase
          .from('player_game_stats')
          .select('player_id, fantasy_points, is_final, nba_games!inner(game_date)')
          .in('player_id', playerIds)
          .eq('nba_games.game_date', snapshot.game_date);
        for (const r of (rows ?? []) as any[]) {
          fp.set(r.player_id, Number(r.fantasy_points ?? 0));
          anyStats = true;
          if (!r.is_final) allFinal = false;
        }
      }

      const phase: Phase = !anyStats ? 'upcoming' : allFinal ? 'final' : 'live';
      return { fp, phase };
    },
    // Keep a shared live matchup ticking in the feed.
    refetchInterval: 30_000,
  });

  const fp = data?.fp ?? new Map<string, number>();
  const phase: Phase = data?.phase ?? 'upcoming';
  const scored = phase !== 'upcoming';

  const myTotal = (snapshot.slots ?? []).reduce((sum, s) => sum + (fp.get(s.mine?.player_id) ?? 0), 0);
  const theirTotal = (snapshot.slots ?? []).reduce((sum, s) => sum + (s.theirs ? fp.get(s.theirs.player_id) ?? 0 : 0), 0);

  const badge = STATUS[phase];
  const opponentName = snapshot.opponent?.username ?? 'Waiting for opponent';

  const body = (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden', backgroundColor: theme.surface }}>
      {/* Header */}
      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: theme.hairline }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {snapshot.opponent?.avatar_url ? (
            <Image source={{ uri: snapshot.opponent.avatar_url }} style={{ width: 40, height: 40, borderRadius: 9999 }} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 9999, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>
                {(snapshot.opponent?.username ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
              {snapshot.format}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 14, lineHeight: 21, color: theme.muted2 }}>
              {snapshot.opponent?.username ? `vs. ${opponentName}` : opponentName}
            </Text>
          </View>
        </View>
        <View style={{ paddingVertical: 4, paddingHorizontal: 12, borderRadius: 100, backgroundColor: badge.wash(theme) }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, lineHeight: 21, color: badge.color(theme) }}>
            {badge.label}
          </Text>
        </View>
      </View>

      {/* Body */}
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.muted }}>Payout</Text>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
            {fmtPrice(snapshot.payout)}
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          (snapshot.slots ?? []).map((s) => {
            const mineFp = fp.get(s.mine?.player_id) ?? 0;
            const theirFp = s.theirs ? fp.get(s.theirs.player_id) ?? 0 : 0;
            const iWon = scored && mineFp >= theirFp;
            return (
              <View key={s.slot} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  {scored ? <SlotTick won={iWon} /> : <View style={{ width: 12 }} />}
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 16, lineHeight: 24, color: theme.ink }}>
                    {s.mine?.name}
                  </Text>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
                    {mineFp.toFixed(1)} FP
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  {scored ? <SlotTick won={!iWon} small /> : <View style={{ width: 12 }} />}
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: theme.muted2 }}>
                    {s.theirs?.name ?? '—'}
                  </Text>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, lineHeight: 18, color: theme.muted2 }}>
                    {s.theirs ? `${theirFp.toFixed(1)} FP` : '—'}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        <View style={{ height: 1, backgroundColor: theme.hairline2, marginTop: 2 }} />

        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Text style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 16, lineHeight: 24, color: theme.ink }}>Total</Text>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
              {myTotal.toFixed(1)} FP
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: theme.muted2 }}>
              {snapshot.opponent?.username ?? 'Opponent'}
            </Text>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, lineHeight: 18, color: theme.muted2 }}>
              {theirTotal.toFixed(1)} FP
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityLabel="Open matchup">
      {body}
    </Pressable>
  );
}

/** Per-slot outcome marker: green check for the winner, red cross for the loser. */
function SlotTick({ won, small }: { won: boolean; small?: boolean }) {
  const size = small ? 10 : 12;
  return (
    <View style={{ width: 12, alignItems: 'center' }}>
      {won ? (
        <Svg width={size} height={size} viewBox="0 0 12 12">
          <Rect x={0} y={0} width={12} height={12} rx={2} fill={WIN_TICK} />
          <Path d="m3 6.2 2 2 4-4.2" fill="none" stroke="#FFFFFF" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : (
        <Svg width={size} height={size} viewBox="0 0 12 12">
          <Rect x={0} y={0} width={12} height={12} rx={2} fill={LOSS_TICK} />
          <Path d="M4 4l4 4M8 4l-4 4" fill="none" stroke="#FFFFFF" strokeWidth={1.7} strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

const STATUS: Record<Phase, { label: string; color: (t: Theme) => string; wash: (t: Theme) => string }> = {
  live: { label: 'LIVE MATCH', color: (t) => t.danger, wash: () => LIVE_WASH },
  final: { label: 'FINAL', color: (t) => t.ink, wash: (t) => t.surfaceSunken },
  upcoming: { label: 'UPCOMING', color: (t) => t.muted, wash: (t) => t.surfaceSunken },
};
