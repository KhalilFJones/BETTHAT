// =============================================================================
// BETTHAT — Matchup Detail (Holy Grail V2, Screens 07 + 08)
// Tabbed: SCORE · LINEUPS · CHAT
//   • SCORE  — hero scores, pot info, activity feed
//   • LINEUPS — your 3 picks vs opponent's 3 picks, full FP breakdown
//   • CHAT   — real-time in-game messaging between matched opponents
//
// Completed matchups show WIN/LOSS hero on the SCORE tab; CHAT becomes read-only.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, FlatList, Pressable,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtFP, fmtRelative,
  playerInitials, playerLastName, opponentColor,
} from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

type Tab = 'score' | 'lineups' | 'chat';

// =============================================================================
// ROOT
// =============================================================================

export default function MatchupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuthStore();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('score');
  const [chatUnread, setChatUnread] = useState(0);

  // ── Realtime: matchup row + activity events ───────────────────────────────
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`matchup-live-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchup_activity_events', filter: `matchup_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['matchup-detail', id] }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matchups', filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['matchup-detail', id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  // ── Realtime: chat messages ───────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`matchup-chat-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchup_messages', filter: `matchup_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['matchup-chat', id] });
          if (activeTab !== 'chat') setChatUnread(n => n + 1);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc, activeTab]);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['matchup-detail', id],
    queryFn: async () => {
      if (!id) throw new Error('No matchup id');
      const { data: matchup, error } = await supabase
        .from('matchups')
        .select(`
          id, status, settled_wager, pot_amount, payout_amount, rake_amount,
          user1_id, user2_id, user1_score, user2_score,
          user1_final_score, user2_final_score, score_margin,
          winner_user_id, started_at, completed_at, created_at,
          u1:profiles!user1_id(id, username, display_name, rank_tier, total_wins, total_losses),
          u2:profiles!user2_id(id, username, display_name, rank_tier, total_wins, total_losses),
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
        .limit(30);

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
    refetchInterval: (data) => {
      const status = (data as any)?.matchup?.status;
      return status === 'live' || status === 'matched' ? 30_000 : false;
    },
  });

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} size="large" />
      </SafeAreaView>
    );
  }

  const m = data.matchup;
  const meIs1 = m.user1_id === profile?.id;
  const me = meIs1 ? m.u1 : m.u2;
  const opp = meIs1 ? m.u2 : m.u1;
  const meL = meIs1 ? m.l1 : m.l2;
  const oppL = meIs1 ? m.l2 : m.l1;
  const meScore = meIs1 ? (m.user1_final_score ?? m.user1_score) : (m.user2_final_score ?? m.user2_score);
  const oppScore = meIs1 ? (m.user2_final_score ?? m.user2_score) : (m.user1_final_score ?? m.user1_score);
  const won = m.winner_user_id === profile?.id;
  const isCompleted = m.status === 'completed';
  const oppAccent = opponentColor(opp?.username);

  const handleTabPress = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'chat') setChatUnread(0);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* ── Header ── */}
      <MatchupHeader
        m={m}
        me={me}
        opp={opp}
        won={won}
        isCompleted={isCompleted}
        oppAccent={oppAccent}
        h2h={data.h2h}
        onBack={() => router.back()}
      />

      {/* ── Tab bar ── */}
      <TabBar
        active={activeTab}
        onPress={handleTabPress}
        chatUnread={chatUnread}
        isCompleted={isCompleted}
      />

      {/* ── Tab content ── */}
      {activeTab === 'score' && (
        <ScoreTab
          m={m}
          meScore={meScore}
          oppScore={oppScore}
          won={won}
          isCompleted={isCompleted}
          events={data.events}
          me={me}
          opp={opp}
          oppAccent={oppAccent}
        />
      )}
      {activeTab === 'lineups' && (
        <LineupsTab
          meL={meL}
          oppL={oppL}
          me={me}
          opp={opp}
          oppAccent={oppAccent}
          isCompleted={isCompleted}
        />
      )}
      {activeTab === 'chat' && (
        <ChatTab
          matchupId={id!}
          profile={profile}
          opp={opp}
          oppAccent={oppAccent}
          isCompleted={isCompleted}
        />
      )}
    </SafeAreaView>
  );
}

// =============================================================================
// MATCHUP HEADER
// =============================================================================

function MatchupHeader({ m, me, opp, won, isCompleted, oppAccent, h2h, onBack }: any) {
  const delta = Number(m.user1_score ?? 0) - Number(m.user2_score ?? 0);

  let statusLabel = '';
  let statusColor: string = HG.muted;
  if (m.status === 'pending') { statusLabel = 'IN QUEUE'; statusColor = HG.muted; }
  else if (m.status === 'matched') { statusLabel = 'MATCHED'; statusColor = HG.sky; }
  else if (m.status === 'live') { statusLabel = 'LIVE'; statusColor = HG.up; }
  else if (isCompleted) { statusLabel = won ? 'WIN' : 'LOSS'; statusColor = won ? HG.sky : HG.muted; }

  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 }}>
      {/* Top row: back + status + H2H */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Pressable onPress={onBack} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink2, letterSpacing: 0.6 }}>Back</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {m.status === 'live' ? (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: HG.up }} />
          ) : null}
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: statusColor, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            {statusLabel}
          </Text>
        </View>

        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.4 }}>
          {h2h > 0 ? `${h2h} H2H` : 'First matchup'}
        </Text>
      </View>

      {/* Fighter strip */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: HG.surface,
        borderRadius: 16, borderWidth: 1, borderColor: HG.hairline,
        padding: 14, gap: 10,
      }}>
        {/* Me */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ position: 'relative' }}>
            <MonogramTile
              initials={(me?.display_name ?? me?.username ?? '??').slice(0, 2).toUpperCase()}
              size={40} showJersey={false}
            />
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: HG.sky, borderWidth: 2, borderColor: HG.surface }} />
          </View>
          <View>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }} numberOfLines={1}>
              {me?.username ?? 'You'}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4 }}>
              {me?.total_wins ?? 0}W · {me?.total_losses ?? 0}L
            </Text>
          </View>
        </View>

        {/* VS + wager */}
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={{ fontFamily: FONT.serifItalic, fontSize: 13, color: HG.muted }}>vs</Text>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.sky, letterSpacing: 0.4 }}>
            {fmtPrice(m.settled_wager ?? m.pot_amount / 2)}
          </Text>
        </View>

        {/* Opponent */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }} numberOfLines={1}>
              {opp?.username ?? '—'}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4 }}>
              {opp?.total_wins ?? 0}W · {opp?.total_losses ?? 0}L
            </Text>
          </View>
          <View style={{ position: 'relative' }}>
            <MonogramTile
              initials={(opp?.display_name ?? opp?.username ?? '??').slice(0, 2).toUpperCase()}
              size={40} showJersey={false}
            />
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: oppAccent, borderWidth: 2, borderColor: HG.surface }} />
          </View>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// TAB BAR
// =============================================================================

function TabBar({ active, onPress, chatUnread, isCompleted }: {
  active: Tab; onPress: (t: Tab) => void; chatUnread: number; isCompleted: boolean;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'score', label: 'Score' },
    { key: 'lineups', label: 'Lineups' },
    { key: 'chat', label: 'Chat' },
  ];
  return (
    <View style={{
      flexDirection: 'row', marginHorizontal: 18, marginBottom: 4,
      backgroundColor: HG.surface, borderRadius: 12, borderWidth: 1, borderColor: HG.hairline,
      padding: 4, gap: 4,
    }}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onPress(t.key)}
            style={{
              flex: 1, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
              backgroundColor: isActive ? HG.sky : 'transparent',
              flexDirection: 'row', gap: 6,
            }}
          >
            <Text style={{
              fontFamily: FONT.monoBold, fontSize: 11,
              color: isActive ? HG.jet : HG.muted,
              letterSpacing: 1.2, textTransform: 'uppercase',
            }}>
              {t.label}
            </Text>
            {t.key === 'chat' && chatUnread > 0 && !isActive ? (
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: HG.up, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, color: '#fff' }}>{chatUnread}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// =============================================================================
// SCORE TAB
// =============================================================================

function ScoreTab({ m, meScore, oppScore, won, isCompleted, events, me, opp, oppAccent }: any) {
  const delta = Number(meScore ?? 0) - Number(oppScore ?? 0);
  const leading = delta >= 0;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>
      {/* Hero — WIN/LOSS for completed, live scores otherwise */}
      {isCompleted ? (
        <View style={{ paddingHorizontal: 18, alignItems: 'center', paddingBottom: 20 }}>
          <Text style={{
            fontFamily: FONT.hero, fontSize: 120,
            color: won ? HG.sky : HG.loss,
            lineHeight: 120, letterSpacing: 6,
            textShadowColor: won ? HG.sky : 'transparent',
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: won ? 18 : 0,
          }}>
            {won ? 'WIN' : 'LOSS'}
          </Text>
          <Text style={{ fontFamily: FONT.hero, fontSize: 32, letterSpacing: 2, marginTop: 8 }}>
            <Text style={{ color: HG.ink }}>{fmtFP(meScore)}</Text>
            <Text style={{ color: HG.muted }}> — </Text>
            <Text style={{ color: HG.muted }}>{fmtFP(oppScore)}</Text>
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 18, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            {/* My score */}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>You</Text>
              <Text style={{
                fontFamily: FONT.hero, fontSize: 80, lineHeight: 80,
                color: leading ? HG.sky : HG.ink,
                textShadowColor: leading ? HG.sky : 'transparent',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: leading ? 12 : 0,
              }}>
                {fmtFP(meScore)}
              </Text>
            </View>
            {/* Center */}
            <View style={{ alignItems: 'center', paddingTop: 24 }}>
              <Text style={{ fontFamily: FONT.serifItalic, fontSize: 14, color: HG.muted }}>vs</Text>
            </View>
            {/* Opp score */}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: oppAccent, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
                {opp?.username ?? 'Opp'}
              </Text>
              <Text style={{ fontFamily: FONT.hero, fontSize: 80, lineHeight: 80, color: HG.ink2 }}>
                {fmtFP(oppScore)}
              </Text>
            </View>
          </View>
          {/* Delta pill */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10 }}>
            <View style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
              backgroundColor: leading ? HG.skySoft : 'rgba(58,58,60,0.22)',
              borderWidth: 1, borderColor: leading ? HG.skyEdge : HG.hairline,
            }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: leading ? HG.sky : HG.muted, letterSpacing: 0.6 }}>
                {leading ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pts {leading ? 'ahead' : 'behind'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Payout strip */}
      <View style={{ marginHorizontal: 18, marginBottom: 16 }}>
        <View style={{ backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, flexDirection: 'row', padding: 14 }}>
          <PayoutCol label="Wager" value={fmtPrice(m.settled_wager ?? m.pot_amount / 2)} />
          <Divider />
          <PayoutCol label="Pot" value={fmtPrice(m.pot_amount)} />
          <Divider />
          <PayoutCol label="Payout" value={fmtPrice(m.payout_amount)} accent />
        </View>
      </View>

      {/* Activity / play-by-play */}
      <SectionLabel label="Play-by-Play" />
      <View style={{ paddingHorizontal: 18, gap: 0, marginBottom: 8 }}>
        {events.length === 0 ? (
          <View style={{ padding: 20, backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, alignItems: 'center', gap: 8 }}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <Circle cx="12" cy="12" r="10" />
              <Path d="M12 8v4M12 16h.01" />
            </Svg>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center' }}>
              {m.status === 'matched' ? 'Waiting for tipoff…' : 'No activity yet.'}
            </Text>
          </View>
        ) : (
          events.map((e: any) => <ActivityRow key={e.id} e={e} />)
        )}
      </View>
    </ScrollView>
  );
}

// =============================================================================
// LINEUPS TAB — Your picks + Opponent's picks side by side
// =============================================================================

function LineupsTab({ meL, oppL, me, opp, oppAccent, isCompleted }: any) {
  const myPicks = sortedPicks(meL);
  const oppPicks = sortedPicks(oppL);
  const myTotal = myPicks.reduce((s: number, p: any) => s + Number(p.fantasy_points_scored ?? 0), 0);
  const oppTotal = oppPicks.reduce((s: number, p: any) => s + Number(p.fantasy_points_scored ?? 0), 0);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>
      {/* Column headers */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 18, marginBottom: 10, gap: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HG.sky }} />
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            You
          </Text>
          {isCompleted ? (
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, marginLeft: 4 }}>
              {myTotal.toFixed(1)}
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          {isCompleted ? (
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: oppAccent, marginRight: 4 }}>
              {oppTotal.toFixed(1)}
            </Text>
          ) : null}
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: oppAccent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            {opp?.username ?? 'Opp'}
          </Text>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: oppAccent }} />
        </View>
      </View>

      {/* Side-by-side rows */}
      {Array.from({ length: Math.max(myPicks.length, oppPicks.length) }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 8 }}>
          <PickCard lp={myPicks[i]} accent={HG.sky} side="left" isCompleted={isCompleted} />
          <PickCard lp={oppPicks[i]} accent={oppAccent} side="right" isCompleted={isCompleted} />
        </View>
      ))}

      {/* Totals row */}
      {isCompleted ? (
        <View style={{ marginHorizontal: 14, marginTop: 6 }}>
          <View style={{ backgroundColor: HG.surface, borderRadius: 12, borderWidth: 1, borderColor: HG.hairline, flexDirection: 'row', padding: 14, alignItems: 'center' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Your total</Text>
              <Text style={{ fontFamily: FONT.hero, fontSize: 32, color: myTotal >= oppTotal ? HG.sky : HG.muted, lineHeight: 32 }}>{myTotal.toFixed(1)}</Text>
            </View>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, marginHorizontal: 8 }}>vs</Text>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Their total</Text>
              <Text style={{ fontFamily: FONT.hero, fontSize: 32, color: oppTotal >= myTotal ? oppAccent : HG.muted, lineHeight: 32 }}>{oppTotal.toFixed(1)}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function PickCard({ lp, accent, side, isCompleted }: { lp: any; accent: string; side: 'left' | 'right'; isCompleted: boolean }) {
  if (!lp) {
    return (
      <View style={{ flex: 1, height: 90, backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted }}>—</Text>
      </View>
    );
  }
  const fp = Number(lp.fantasy_points_scored ?? 0);
  const p = lp.nba_players;

  return (
    <View style={{
      flex: 1, backgroundColor: HG.surface, borderRadius: 14,
      borderWidth: 1, borderColor: HG.hairline,
      borderTopWidth: 3, borderTopColor: accent,
      padding: 12, gap: 8,
    }}>
      {/* Player monogram + name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={34} showJersey={false} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: HG.ink }}>
            {p.full_name}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.3, marginTop: 1 }}>
            {p.position} · {p.team_abbreviation}
          </Text>
        </View>
      </View>

      {/* Price + FP */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>
          {fmtPrice(lp.frozen_price)}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: FONT.hero, fontSize: 28, color: accent, lineHeight: 28 }}>
            {fp.toFixed(1)}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            FPTS
          </Text>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// CHAT TAB
// =============================================================================

function ChatTab({ matchupId, profile, opp, oppAccent, isCompleted }: {
  matchupId: string; profile: any; opp: any; oppAccent: string; isCompleted: boolean;
}) {
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ['matchup-chat', matchupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchup_messages' as any)
        .select('id, user_id, content, created_at, sender:profiles!user_id(username, display_name)')
        .eq('matchup_id', matchupId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!matchupId,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase
        .from('matchup_messages' as any)
        .insert({ matchup_id: matchupId, user_id: profile.id, content });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
  });

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ padding: 18, gap: 10, paddingBottom: 16 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48, gap: 10 }}>
            <Svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </Svg>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center', lineHeight: 20 }}>
              {isCompleted ? 'Chat has ended.' : `Start a conversation with ${opp?.username ?? 'your opponent'}!`}
            </Text>
          </View>
        }
        renderItem={({ item }: { item: any }) => {
          const isMe = item.user_id === profile?.id;
          const accent = isMe ? HG.sky : oppAccent;
          const name = item.sender?.username ?? (isMe ? 'You' : opp?.username ?? '—');
          return (
            <View style={{ flexDirection: 'row', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 8 }}>
              {!isMe ? (
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: oppAccent + '33', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: oppAccent }}>
                    {name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              ) : null}
              <View style={{ maxWidth: '72%' }}>
                {!isMe ? (
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: oppAccent, letterSpacing: 0.4, marginBottom: 3 }}>
                    {name}
                  </Text>
                ) : null}
                <View style={{
                  paddingHorizontal: 14, paddingVertical: 10,
                  backgroundColor: isMe ? HG.sky : HG.surface,
                  borderRadius: 16,
                  borderBottomRightRadius: isMe ? 4 : 16,
                  borderBottomLeftRadius: isMe ? 16 : 4,
                  borderWidth: isMe ? 0 : 1,
                  borderColor: HG.hairline,
                }}>
                  <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: isMe ? HG.jet : HG.ink, lineHeight: 20 }}>
                    {item.content}
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, marginTop: 3, textAlign: isMe ? 'right' : 'left', letterSpacing: 0.3 }}>
                  {fmtRelative(item.created_at)}
                </Text>
              </View>
              {isMe ? (
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: HG.skySoft, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.sky }}>
                    {(profile?.username ?? 'Me').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      {/* Input */}
      {!isCompleted ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 18, paddingVertical: 12,
          borderTopWidth: 1, borderColor: HG.hairline,
          backgroundColor: HG.jet,
        }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Say something…"
            placeholderTextColor={HG.muted}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            style={{
              flex: 1, height: 44, backgroundColor: HG.surface, borderRadius: 22,
              paddingHorizontal: 16, paddingVertical: 0,
              fontFamily: FONT.sans, fontSize: 14, color: HG.ink,
              borderWidth: 1, borderColor: HG.hairline,
            }}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: text.trim() ? HG.sky : HG.surface,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: text.trim() ? HG.sky : HG.hairline,
            }}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color={HG.jet} />
            ) : (
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={text.trim() ? HG.jet : HG.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z" />
              </Svg>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderColor: HG.hairline, alignItems: 'center' }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.8 }}>
            Game over · Chat is read-only
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: HG.hairline }} />
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: HG.hairline }} />
    </View>
  );
}

function PayoutCol({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: accent ? HG.sky : HG.ink, letterSpacing: -0.2 }}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={{ width: 1, height: 36, backgroundColor: HG.hairline, alignSelf: 'center', marginHorizontal: 4 }} />;
}

function ActivityRow({ e }: { e: any }) {
  const delta = Number(e.fpts_delta ?? 0);
  const positive = delta > 0;
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: HG.hairline, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ width: 3, borderRadius: 2, alignSelf: 'stretch', backgroundColor: positive ? HG.sky : HG.hairline2, marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.ink, lineHeight: 19 }}>
          {e.description}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 3, letterSpacing: 0.4 }}>
          {e.game_period ? `Q${e.game_period}` : ''} {e.game_clock ?? ''} · {fmtRelative(e.created_at)}
        </Text>
      </View>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: positive ? HG.sky : delta < 0 ? HG.muted : HG.ink2, marginTop: 2 }}>
        {positive ? '+' : ''}{delta.toFixed(1)}
      </Text>
    </View>
  );
}

function sortedPicks(lineup: any): any[] {
  return ((lineup?.lineup_players ?? []) as any[]).sort((a, b) => a.slot_number - b.slot_number);
}
