// =============================================================================
// BETTHAT — Live Game Board (Holy Grail V2, Screen 07)
//      and Game Result (Holy Grail V2, Screen 08)
// One file, two states: live in-progress vs. completed-final.
// =============================================================================

import { useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice, fmtFP, fmtRelative, playerInitials, playerLastName, opponentColor } from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

export default function MatchupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuthStore();
  const qc = useQueryClient();

  // Realtime subscription — invalidate on activity events or score updates
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`matchup-live-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'matchup_activity_events',
        filter: `matchup_id=eq.${id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['matchup-detail', id] });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'matchups',
        filter: `id=eq.${id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['matchup-detail', id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ['matchup-detail', id],
    queryFn: async () => {
      if (!id) throw new Error('No matchup id');
      const { data: matchup, error } = await supabase
        .from('matchups')
        .select(`
          id, status, settled_wager, pot_amount, payout_amount, rake_amount,
          user1_id, user2_id, user1_score, user2_score, user1_final_score, user2_final_score, score_margin,
          winner_user_id, started_at, completed_at, created_at,
          u1:profiles!user1_id(id, username, display_name, rank_tier),
          u2:profiles!user2_id(id, username, display_name, rank_tier),
          l1:lineups!lineup1_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price, fantasy_points_scored,
              nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation))),
          l2:lineups!lineup2_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price, fantasy_points_scored,
              nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation)))
        `)
        .eq('id', id)
        .single();
      if (error) throw error;

      const { data: events } = await supabase
        .from('matchup_activity_events')
        .select('*')
        .eq('matchup_id', id)
        .order('created_at', { ascending: false })
        .limit(20);

      // H2H prior count
      const { count: h2h } = await supabase
        .from('matchups')
        .select('id', { count: 'exact', head: true })
        .or(
          `and(user1_id.eq.${(matchup as any).user1_id},user2_id.eq.${(matchup as any).user2_id}),` +
          `and(user1_id.eq.${(matchup as any).user2_id},user2_id.eq.${(matchup as any).user1_id})`
        )
        .eq('status', 'completed')
        .lt('completed_at', (matchup as any).created_at);

      return { matchup: matchup as any, events: events ?? [], h2h: h2h ?? 0 };
    },
    enabled: !!id,
  });

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  const m = data.matchup;
  const meIs1 = m.user1_id === profile?.id;
  const meL = meIs1 ? m.l1 : m.l2;
  const oppL = meIs1 ? m.l2 : m.l1;
  const meScore = meIs1 ? (m.user1_final_score ?? m.user1_score) : (m.user2_final_score ?? m.user2_score);
  const oppScore = meIs1 ? (m.user2_final_score ?? m.user2_score) : (m.user1_final_score ?? m.user1_score);
  const opponent = meIs1 ? m.u2 : m.u1;
  const won = m.winner_user_id === profile?.id;
  const isCompleted = m.status === 'completed';

  if (isCompleted) {
    return <GameResult m={m} won={won} meScore={meScore} oppScore={oppScore} meL={meL} oppL={oppL} opponent={opponent} h2h={data.h2h} />;
  }

  return (
    <LiveGameBoard
      m={m}
      meScore={meScore}
      oppScore={oppScore}
      meL={meL}
      oppL={oppL}
      opponent={opponent}
      events={data.events}
      onClose={() => router.back()}
    />
  );
}

// =============================================================================
// LIVE GAME BOARD (Screen 07)
// =============================================================================

function LiveGameBoard({ m, meScore, oppScore, meL, oppL, opponent, events, onClose }: any) {
  const delta = Number(meScore ?? 0) - Number(oppScore ?? 0);
  const leading = delta >= 0;
  const myPicks = sortedPicks(meL);
  const oppPicks = sortedPicks(oppL);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m15 18-6-6 6-6" />
            </Svg>
          </Pressable>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
            Live · Position
          </Text>
          <View style={{ width: 20 }} />
        </View>

        {/* Status banner */}
        <View style={{ paddingHorizontal: 18, marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: HG.sky }} />
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.sky, letterSpacing: 1 }}>
              LIVE
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.4 }}>
              · {m.settled_wager ? fmtPrice(m.settled_wager) : '—'} matched · payout {fmtPrice(m.payout_amount)}
            </Text>
          </View>
        </View>

        {/* You vs Opponent — V2.1 Amendment 1: score banner uses the LED hero font */}
        <View style={{ paddingHorizontal: 18, marginTop: 24, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>You</Text>
              <Text style={{
                fontFamily: FONT.hero,
                fontSize: 72,
                color: leading ? HG.sky : HG.ink,
                marginTop: 4,
                letterSpacing: 1,
                lineHeight: 72,
                textShadowColor: leading ? HG.sky : 'transparent',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: leading ? 10 : 0,
              }}>
                {fmtFP(meScore)}
              </Text>
            </View>
            <Text style={{ fontFamily: FONT.serifItalic, fontSize: 16, color: HG.muted, paddingTop: 28 }}>vs</Text>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                {opponent?.username ?? '—'}
              </Text>
              <Text style={{
                fontFamily: FONT.hero,
                fontSize: 72,
                color: !leading ? HG.ink : HG.ink2,
                marginTop: 4,
                letterSpacing: 1,
                lineHeight: 72,
              }}>
                {fmtFP(oppScore)}
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: leading ? HG.sky : HG.muted, marginTop: 10, letterSpacing: 0.4 }}>
            {leading ? '↑ Leading' : '↓ Down'} {Math.abs(delta).toFixed(1)}
          </Text>
        </View>

        {/* Your picks */}
        <SectionLabel label="Your Picks" />
        <View style={{ paddingHorizontal: 18, gap: 8 }}>
          {myPicks.map((lp: any) => <PickRow key={lp.nba_players.id} lp={lp} />)}
        </View>

        {/* Opponent picks — V2.1 Amendment 2: accent ribbon in opponent's color */}
        <SectionLabel label={`${opponent?.username ?? 'Opponent'}'s Picks`} dim accent={opponentColor(opponent?.username)} />
        <View style={{ paddingHorizontal: 18, gap: 8, opacity: 0.85 }}>
          {oppPicks.map((lp: any) => <PickRow key={lp.nba_players.id} lp={lp} accent={opponentColor(opponent?.username)} dim />)}
        </View>

        {/* Activity */}
        <SectionLabel label="Activity" />
        <View style={{ paddingHorizontal: 18, gap: 0 }}>
          {events.length === 0 ? (
            <View style={{ padding: 18, backgroundColor: HG.surface, borderRadius: 12, borderColor: HG.hairline, borderWidth: 1 }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center' }}>
                Waiting for the first stat tick.
              </Text>
            </View>
          ) : (
            events.map((e: any) => <ActivityRow key={e.id} e={e} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PickRow({ lp, dim, accent }: { lp: any; dim?: boolean; accent?: string }) {
  const fp = Number(lp.fantasy_points_scored ?? 0);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: HG.surface, borderRadius: 12, borderColor: HG.hairline, borderWidth: 1, borderLeftWidth: accent ? 3 : 1, borderLeftColor: accent ?? HG.hairline }}>
      <MonogramTile initials={playerInitials(lp.nba_players)} jersey={lp.nba_players.jersey_number} size={42} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>
          {playerLastName(lp.nba_players)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4, marginTop: 2 }}>
          {lp.nba_players.ticker_handle ?? ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 18, color: HG.ink }}>{fp.toFixed(1)}</Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4, marginTop: 2 }}>FPTS</Text>
      </View>
    </View>
  );
}

function ActivityRow({ e }: { e: any }) {
  const positive = Number(e.fpts_delta ?? 0) > 0;
  const negative = Number(e.fpts_delta ?? 0) < 0;
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: HG.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.ink, lineHeight: 19 }}>
          {e.description}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, marginTop: 3, letterSpacing: 0.4 }}>
          Q{e.game_period ?? '—'} {e.game_clock ?? ''} · {fmtRelative(e.created_at)}
        </Text>
      </View>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: positive ? HG.sky : negative ? HG.muted : HG.ink2 }}>
        {positive ? '+' : ''}{Number(e.fpts_delta ?? 0).toFixed(1)}
      </Text>
    </View>
  );
}

function SectionLabel({ label, dim, accent }: { label: string; dim?: boolean; accent?: string }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 22, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {accent ? <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: accent }} /> : null}
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: dim ? HG.muted2 : HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}

function sortedPicks(lineup: any) {
  return ((lineup?.lineup_players ?? []) as any[]).sort((a, b) => a.slot_number - b.slot_number);
}

// =============================================================================
// GAME RESULT (Screen 08)
// =============================================================================

function GameResult({ m, won, meScore, oppScore, meL, oppL, opponent, h2h }: any) {
  const router = useRouter();
  const myPicks = sortedPicks(meL);
  const oppPicks = sortedPicks(oppL);
  const myBest = myPicks.reduce((best: any, p: any) =>
    !best || Number(p.fantasy_points_scored ?? 0) > Number(best.fantasy_points_scored ?? 0) ? p : best, null);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Close */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
          <View style={{ width: 22 }} />
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
            Game · Over
          </Text>
          <Pressable onPress={() => router.replace('/(tabs)/matchups' as any)} hitSlop={12}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M18 6 6 18M6 6l12 12" />
            </Svg>
          </Pressable>
        </View>

        {/* Hero — V2.1 Amendment 1: WIN/LOSS and final scores in LED hero font */}
        <View style={{ alignItems: 'center', paddingHorizontal: 18, paddingTop: 20 }}>
          <Text
            style={{
              fontFamily: FONT.hero,
              fontSize: 132,
              color: won ? HG.sky : HG.loss,
              letterSpacing: 8,
              textTransform: 'uppercase',
              lineHeight: 132,
              textShadowColor: won ? HG.sky : 'transparent',
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: won ? 20 : 0,
            }}
          >
            {won ? 'WIN' : 'LOSS'}
          </Text>

          <Text style={{ fontFamily: FONT.hero, fontSize: 36, marginTop: 14, letterSpacing: 2 }}>
            <Text style={{ color: won ? HG.ink : 'rgba(232,237,242,0.25)' }}>{fmtFP(meScore)}</Text>
            <Text style={{ color: HG.muted }}>  —  </Text>
            <Text style={{ color: !won ? HG.ink : 'rgba(232,237,242,0.25)' }}>{fmtFP(oppScore)}</Text>
          </Text>

          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted, marginTop: 12 }}>
            vs {opponent?.username ?? '—'} · {h2h} H2H prior
          </Text>
        </View>

        {/* Payout strip */}
        <View style={{ paddingHorizontal: 18, marginTop: 30 }}>
          <View style={{ backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, padding: 18, flexDirection: 'row', justifyContent: 'space-between' }}>
            {won ? (
              <>
                <PayoutCol label="Payout" value={`+${fmtPrice(m.payout_amount)}`} accent />
                <PayoutCol label="Entry" value={fmtPrice(m.settled_wager)} />
                <PayoutCol label="Wallet" value={fmtPrice(Number(m.payout_amount ?? 0) + Number(m.settled_wager ?? 0))} />
              </>
            ) : (
              <>
                <PayoutCol label="Entry" value={fmtPrice(m.settled_wager)} />
                <PayoutCol label="Result" value="LOSS" />
              </>
            )}
          </View>
        </View>

        {/* Lineup breakdowns */}
        <SectionLabel label="Your Lineup" />
        <View style={{ paddingHorizontal: 18, gap: 6 }}>
          {myPicks.map((lp: any) => (
            <PickResultRow key={lp.nba_players.id} lp={lp} highlight={myBest && myBest.nba_players.id === lp.nba_players.id} />
          ))}
        </View>

        <SectionLabel label={`${opponent?.username ?? 'Opponent'}`} dim />
        <View style={{ paddingHorizontal: 18, gap: 6, opacity: 0.65 }}>
          {oppPicks.map((lp: any) => <PickResultRow key={lp.nba_players.id} lp={lp} dim />)}
        </View>

        {/* Actions */}
        <View style={{ paddingHorizontal: 18, marginTop: 32, gap: 10 }}>
          <Pressable
            onPress={() => router.replace('/(tabs)/lineup' as any)}
            style={{ height: 48, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Place another order
            </Text>
          </Pressable>
          <Pressable style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
              Share result
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PayoutCol({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 18, color: accent ? HG.sky : HG.ink, marginTop: 4, letterSpacing: -0.3 }}>
        {value}
      </Text>
    </View>
  );
}

function PickResultRow({ lp, highlight, dim }: { lp: any; highlight?: boolean; dim?: boolean }) {
  const fp = Number(lp.fantasy_points_scored ?? 0);
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 14, backgroundColor: highlight ? HG.skySoft : HG.surface, borderRadius: 12, borderColor: highlight ? HG.skyEdge : HG.hairline, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <MonogramTile initials={playerInitials(lp.nba_players)} jersey={lp.nba_players.jersey_number} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
          {lp.nba_players.full_name}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4, marginTop: 2 }}>
          {lp.nba_players.ticker_handle} · {fmtPrice(lp.frozen_price)} entry
        </Text>
      </View>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 18, color: highlight ? HG.sky : HG.ink }}>{fp.toFixed(1)}</Text>
    </View>
  );
}
