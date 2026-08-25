// =============================================================================
// BETTHAT — Matchup Detail (Holy Grail V2, Screens 07 + 08)
// Tabbed: SCORE · LINEUPS · CHAT
//   • SCORE  — hero scores, pot info, activity feed
//   • LINEUPS — your 3 picks vs opponent's 3 picks, full FP breakdown
//   • CHAT   — real-time in-game messaging between matched opponents
//
// Completed matchups show WIN/LOSS hero on the SCORE tab; CHAT becomes read-only.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, FlatList, Pressable, Modal,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  FONT, fmtPrice, fmtFP, fmtRelative, fmtTime,
  opponentColor,
} from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { MatchupBoard } from '@/components/matchup/MatchupBoard';
import { PlayerHeadshot } from '@/components/media/PlayerHeadshot';
import { VoiceRecorderBar } from '@/components/media/VoiceRecorderBar';
import { VoiceNotePlayer } from '@/components/media/VoiceNotePlayer';
import { UserAvatar } from '@/components/media/UserAvatar';
import { useVoiceNote } from '@/hooks/useVoiceNote';

type Tab = 'score' | 'lineups' | 'chat';

// Matches the live pill on MatchupBoard, so the scoreline reads the same
// whether you are on the board or in the thread.
const LIVE_RED = '#D6453C';

// Realtime topics must be unique per mount. `supabase.removeChannel()` is
// async and the effect cleanup can't await it, so a fast remount (navigating
// away and straight back, fast-refresh, or the settled-matchup redirect) can
// hand back the SAME still-subscribed channel — and calling .on() on a
// subscribed channel throws "cannot add postgres_changes callbacks after
// subscribe()". A per-mount suffix makes that collision impossible.
let channelSeq = 0;
const nextTopic = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${channelSeq++}`;

// =============================================================================
// ROOT
// =============================================================================

export default function MatchupScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuthStore();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('score');
  const [chatUnread, setChatUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  // Read inside the chat subscription's INSERT handler without making
  // `activeTab` an effect dependency — see note below.
  const activeTabRef = useRef<Tab>('score');
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // ── Realtime: matchup row + activity events ───────────────────────────────
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(nextTopic(`matchup-live-${id}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchup_activity_events', filter: `matchup_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['matchup-detail', id] }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matchups', filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['matchup-detail', id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  // ── Realtime: chat messages ───────────────────────────────────────────────
  // `activeTab` intentionally is NOT a dependency here: it used to be, which
  // tore down and rebuilt this channel on every tab switch — a real gap where
  // a message sent during the resubscribe window would never invalidate the
  // chat query or bump the unread badge. Read the live tab via the ref above
  // so the subscription is created once per matchup and stays connected.
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(nextTopic(`matchup-chat-${id}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchup_messages', filter: `matchup_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['matchup-chat', id] });
          if (activeTabRef.current !== 'chat') setChatUnread(n => n + 1);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

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
          u1:profiles!user1_id(id, username, display_name, rank_tier, avatar_url, total_wins, total_losses),
          u2:profiles!user2_id(id, username, display_name, rank_tier, avatar_url, total_wins, total_losses),
          l1:lineups!lineup1_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price, fantasy_points_scored,
              nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation, headshot_url))),
          l2:lineups!lineup2_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price, fantasy_points_scored,
              nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation, headshot_url)))
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

      // Live game context for the scoreboard strip (Q3 · 8:42 · LAL 88 - BOS 82).
      const pids: string[] = [];
      for (const side of [(matchup as any).l1, (matchup as any).l2]) {
        for (const lp of side?.lineup_players ?? []) if (lp.nba_players?.id) pids.push(lp.nba_players.id);
      }
      let liveGame: any = null;
      const boxScores = new Map<string, any>();
      if (pids.length > 0) {
        const { data: rows } = await supabase
          .from('player_game_stats')
          .select(`player_id, points, rebounds, assists, steals, turnovers, fantasy_points,
                   nba_games!inner(id, status, period, game_clock, home_team, away_team,
                                   home_team_abbreviation, away_team_abbreviation, home_score, away_score)`)
          .in('player_id', pids);
        for (const r of (rows ?? []) as any[]) {
          boxScores.set(r.player_id, r);
          if (!liveGame && r.nba_games?.status === 'live') liveGame = r.nba_games;
        }
      }

      const { count: h2h } = await supabase
        .from('matchups')
        .select('id', { count: 'exact', head: true })
        .or(
          `and(user1_id.eq.${(matchup as any).user1_id},user2_id.eq.${(matchup as any).user2_id}),` +
          `and(user1_id.eq.${(matchup as any).user2_id},user2_id.eq.${(matchup as any).user1_id})`
        )
        .eq('status', 'completed')
        .lt('completed_at', (matchup as any).created_at);

      return { matchup: matchup as any, events: events ?? [], h2h: h2h ?? 0, liveGame, boxScores };
    },
    enabled: !!id,
    // React Query v5: refetchInterval receives the Query object, not the
    // resolved data directly — the previous `(data) => data?.matchup?.status`
    // always read `undefined` (no `.matchup` on the Query itself), so this
    // safety-net poll for live/matched matchups never actually fired and the
    // screen relied solely on the realtime subscription below.
    refetchInterval: (query) => {
      const status = query.state.data?.matchup?.status;
      return status === 'live' || status === 'matched' ? 30_000 : false;
    },
  });

  // A matchup that settles while the user is watching hands off to the
  // art-directed result screen. `replace` so Back doesn't bounce them into
  // the now-finished live board.
  //
  // This MUST sit above the early return below: hooks have to run in the same
  // order on every render, and reading `data` here (rather than the post-guard
  // `isCompleted` local) is what keeps it unconditional.
  const settledStatus = data?.matchup?.status === 'completed';
  useEffect(() => {
    if (settledStatus && id) router.replace(`/matchup/result/${id}` as any);
  }, [settledStatus, id, router]);

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large" />
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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* ── Header ── */}
      <MatchupHeader
        theme={theme}
        m={m}
        me={me}
        opp={opp}
        won={won}
        isCompleted={isCompleted}
        oppAccent={oppAccent}
        h2h={data.h2h}
        onBack={() => router.back()}
      />

      <MatchupBoard
        theme={theme}
        me={me}
        opp={opp}
        meL={meL}
        oppL={oppL}
        meScore={meScore}
        oppScore={oppScore}
        events={data.events}
        liveGame={data.liveGame}
        boxScores={data.boxScores}
        isCompleted={isCompleted}
        onOpenChat={() => setChatOpen(true)}
        onPlayerPress={(pid: string) => router.push(`/player/${pid}` as any)}
      />

      <Modal visible={chatOpen} animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 12, paddingVertical: 8,
            borderBottomWidth: 1, borderColor: theme.hairline,
            backgroundColor: theme.surfaceSunken,
          }}>
            <Pressable
              onPress={() => setChatOpen(false)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close chat and return to the matchup"
              style={{
                width: 40, height: 40, borderRadius: 100,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: theme.surfaceSunken,
              }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m15 18-6-6 6-6" />
              </Svg>
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <UserAvatar
                uri={opp?.avatar_url ?? null}
                name={opp?.display_name || opp?.username}
                size={30}
                theme={theme}
                ring={oppAccent}
              />
              <View style={{ minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>
                  {opp?.display_name || opp?.username || 'Chat'}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2, letterSpacing: 0.4 }}>
                  {opp?.username ? `@${opp.username}` : ''}
                  {opp?.total_wins != null ? `  ·  ${opp.total_wins}W ${opp.total_losses ?? 0}L` : ''}
                </Text>
              </View>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <ChatTab
            theme={theme}
            matchupId={id!}
            profile={profile}
            opp={opp}
            oppAccent={oppAccent}
            isCompleted={isCompleted}
            meScore={meScore}
            oppScore={oppScore}
            liveGame={data.liveGame}
            bottomInset={insets.bottom}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================================
// MATCHUP HEADER
// =============================================================================

function MatchupHeader({ theme, m, me, opp, won, isCompleted, oppAccent, h2h, onBack }: {
  theme: Theme;
  m: { status: string; settled_wager: number | null; pot_amount: number };
  me: any;
  opp: any;
  won: boolean;
  isCompleted: boolean;
  /** Per-opponent accent, so the two sides of the strip stay distinguishable. */
  oppAccent: string;
  h2h: number;
  onBack: () => void;
}) {
  let statusLabel = '';
  let statusColor: string = theme.muted;
  if (m.status === 'pending') { statusLabel = 'IN QUEUE'; statusColor = theme.muted; }
  else if (m.status === 'matched') { statusLabel = 'MATCHED'; statusColor = theme.accent; }
  else if (m.status === 'live') { statusLabel = 'LIVE'; statusColor = theme.up; }
  else if (isCompleted) { statusLabel = won ? 'WIN' : 'LOSS'; statusColor = won ? theme.win : theme.loss; }

  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 }}>
      {/* Top row: back + status + H2H */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Pressable onPress={onBack} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.ink2, letterSpacing: 0.6 }}>Back</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {m.status === 'live' ? (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.up }} />
          ) : null}
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: statusColor, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            {statusLabel}
          </Text>
        </View>

        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.4 }}>
          {h2h > 0 ? `${h2h} H2H` : 'First matchup'}
        </Text>
      </View>

      {/* Fighter strip */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: theme.surface,
        borderRadius: 16, borderWidth: 1, borderColor: theme.hairline,
        padding: 14, gap: 10,
      }}>
        {/* Me */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ position: 'relative' }}>
            <UserAvatar
              uri={me?.avatar_url ?? null}
              name={me?.display_name || me?.username}
              size={40} theme={theme} ring={theme.accent}
            />
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.accent, borderWidth: 2, borderColor: theme.surface }} />
          </View>
          <View>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }} numberOfLines={1}>
              {me?.username ?? 'You'}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.4 }}>
              {me?.total_wins ?? 0}W · {me?.total_losses ?? 0}L
            </Text>
          </View>
        </View>

        {/* VS + wager */}
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={{ fontFamily: FONT.serifItalic, fontSize: 13, color: theme.muted }}>vs</Text>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.accent, letterSpacing: 0.4 }}>
            {fmtPrice(m.settled_wager ?? m.pot_amount / 2)}
          </Text>
        </View>

        {/* Opponent */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }} numberOfLines={1}>
              {opp?.username ?? '—'}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.4 }}>
              {opp?.total_wins ?? 0}W · {opp?.total_losses ?? 0}L
            </Text>
          </View>
          <View style={{ position: 'relative' }}>
            <UserAvatar
              uri={opp?.avatar_url ?? null}
              name={opp?.display_name || opp?.username}
              size={40} theme={theme} ring={oppAccent}
            />
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: oppAccent, borderWidth: 2, borderColor: theme.surface }} />
          </View>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// TAB BAR
// =============================================================================

function TabBar({ theme, active, onPress, chatUnread, isCompleted }: {
  theme: Theme; active: Tab; onPress: (t: Tab) => void; chatUnread: number; isCompleted: boolean;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'score', label: 'Score' },
    { key: 'lineups', label: 'Lineups' },
    { key: 'chat', label: 'Chat' },
  ];
  return (
    <View style={{
      flexDirection: 'row', marginHorizontal: 18, marginBottom: 4,
      backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline,
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
              backgroundColor: isActive ? theme.accent : 'transparent',
              flexDirection: 'row', gap: 6,
            }}
          >
            <Text style={{
              fontFamily: FONT.monoBold, fontSize: 11,
              color: isActive ? theme.onAccent : theme.muted,
              letterSpacing: 1.2, textTransform: 'uppercase',
            }}>
              {t.label}
            </Text>
            {t.key === 'chat' && chatUnread > 0 && !isActive ? (
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.up, alignItems: 'center', justifyContent: 'center' }}>
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

function ScoreTab({ theme, m, meScore, oppScore, won, isCompleted, events, me, opp, oppAccent }: any) {
  const delta = Number(meScore ?? 0) - Number(oppScore ?? 0);
  const leading = delta >= 0;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>
      {/* Hero — WIN/LOSS for completed, live scores otherwise */}
      {isCompleted ? (
        <View style={{ paddingHorizontal: 18, alignItems: 'center', paddingBottom: 20 }}>
          <Text style={{
            fontFamily: FONT.hero, fontSize: 120,
            color: won ? theme.win : theme.loss,
            lineHeight: 120, letterSpacing: 6,
            textShadowColor: won ? theme.win : 'transparent',
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: won ? 18 : 0,
          }}>
            {won ? 'WIN' : 'LOSS'}
          </Text>
          <Text style={{ fontFamily: FONT.hero, fontSize: 32, letterSpacing: 2, marginTop: 8 }}>
            <Text style={{ color: theme.ink }}>{fmtFP(meScore)}</Text>
            <Text style={{ color: theme.muted }}> — </Text>
            <Text style={{ color: theme.muted }}>{fmtFP(oppScore)}</Text>
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 18, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            {/* My score */}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>You</Text>
              <Text style={{
                fontFamily: FONT.hero, fontSize: 80, lineHeight: 80,
                color: leading ? theme.accent : theme.ink,
                textShadowColor: leading ? theme.accent : 'transparent',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: leading ? 12 : 0,
              }}>
                {fmtFP(meScore)}
              </Text>
            </View>
            {/* Center */}
            <View style={{ alignItems: 'center', paddingTop: 24 }}>
              <Text style={{ fontFamily: FONT.serifItalic, fontSize: 14, color: theme.muted }}>vs</Text>
            </View>
            {/* Opp score */}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: oppAccent, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
                {opp?.username ?? 'Opp'}
              </Text>
              <Text style={{ fontFamily: FONT.hero, fontSize: 80, lineHeight: 80, color: theme.ink2 }}>
                {fmtFP(oppScore)}
              </Text>
            </View>
          </View>
          {/* Delta pill */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10 }}>
            <View style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
              backgroundColor: leading ? theme.accentSoft : theme.surfaceSunken,
              borderWidth: 1, borderColor: leading ? theme.accentEdge : theme.hairline,
            }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: leading ? theme.accent : theme.muted, letterSpacing: 0.6 }}>
                {leading ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pts {leading ? 'ahead' : 'behind'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Payout strip */}
      <View style={{ marginHorizontal: 18, marginBottom: 16 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, flexDirection: 'row', padding: 14 }}>
          <PayoutCol theme={theme} label="Wager" value={fmtPrice(m.settled_wager ?? m.pot_amount / 2)} />
          <Divider theme={theme} />
          <PayoutCol theme={theme} label="Pot" value={fmtPrice(m.pot_amount)} />
          <Divider theme={theme} />
          <PayoutCol theme={theme} label="Payout" value={fmtPrice(m.payout_amount)} accent />
        </View>
      </View>

      {/* Activity / play-by-play */}
      <SectionLabel theme={theme} label="Play-by-Play" />
      <View style={{ paddingHorizontal: 18, gap: 0, marginBottom: 8 }}>
        {events.length === 0 ? (
          <View style={{ padding: 20, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', gap: 8 }}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <Circle cx="12" cy="12" r="10" />
              <Path d="M12 8v4M12 16h.01" />
            </Svg>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center' }}>
              {m.status === 'matched' ? 'Waiting for tipoff…' : 'No activity yet.'}
            </Text>
          </View>
        ) : (
          events.map((e: any) => <ActivityRow key={e.id} theme={theme} e={e} />)
        )}
      </View>
    </ScrollView>
  );
}

// =============================================================================
// LINEUPS TAB — Your picks + Opponent's picks side by side
// =============================================================================

function LineupsTab({ theme, meL, oppL, me, opp, oppAccent, isCompleted }: any) {
  const myPicks = sortedPicks(meL);
  const oppPicks = sortedPicks(oppL);
  const myTotal = myPicks.reduce((s: number, p: any) => s + Number(p.fantasy_points_scored ?? 0), 0);
  const oppTotal = oppPicks.reduce((s: number, p: any) => s + Number(p.fantasy_points_scored ?? 0), 0);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>
      {/* Column headers */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 18, marginBottom: 10, gap: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }} />
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.accent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            You
          </Text>
          {isCompleted ? (
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.accent, marginLeft: 4 }}>
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
          <PickCard theme={theme} lp={myPicks[i]} accent={theme.accent} side="left" isCompleted={isCompleted} />
          <PickCard theme={theme} lp={oppPicks[i]} accent={oppAccent} side="right" isCompleted={isCompleted} />
        </View>
      ))}

      {/* Totals row */}
      {isCompleted ? (
        <View style={{ marginHorizontal: 14, marginTop: 6 }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline, flexDirection: 'row', padding: 14, alignItems: 'center' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Your total</Text>
              <Text style={{ fontFamily: FONT.hero, fontSize: 32, color: myTotal >= oppTotal ? theme.accent : theme.muted, lineHeight: 32 }}>{myTotal.toFixed(1)}</Text>
            </View>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, marginHorizontal: 8 }}>vs</Text>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Their total</Text>
              <Text style={{ fontFamily: FONT.hero, fontSize: 32, color: oppTotal >= myTotal ? oppAccent : theme.muted, lineHeight: 32 }}>{oppTotal.toFixed(1)}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function PickCard({ theme, lp, accent, side, isCompleted }: { theme: Theme; lp: any; accent: string; side: 'left' | 'right'; isCompleted: boolean }) {
  const router = useRouter();
  if (!lp) {
    return (
      <View style={{ flex: 1, height: 90, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted }}>—</Text>
      </View>
    );
  }
  const fp = Number(lp.fantasy_points_scored ?? 0);
  const p = lp.nba_players;

  return (
    <Pressable
      onPress={() => p?.id && router.push(`/player/${p.id}` as any)}
      accessibilityLabel={`View ${p?.full_name ?? 'player'}`}
      style={{
        flex: 1, backgroundColor: theme.surface, borderRadius: 14,
        borderWidth: 1, borderColor: theme.hairline,
        borderTopWidth: 3, borderTopColor: accent,
        padding: 12, gap: 8,
      }}>
      {/* Player headshot + name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PlayerHeadshot player={p} theme={theme} size={34} shape="rounded" showTeamCrest />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.ink }}>
            {p.full_name}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.3, marginTop: 1 }}>
            {p.position} · {p.team_abbreviation}
          </Text>
        </View>
      </View>

      {/* Price + FP */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted }}>
          {fmtPrice(lp.frozen_price)}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: FONT.hero, fontSize: 28, color: accent, lineHeight: 28 }}>
            {fp.toFixed(1)}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            FPTS
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// =============================================================================
// CHAT TAB
// =============================================================================

function ChatTab({
  theme, matchupId, profile, opp, oppAccent, isCompleted,
  meScore, oppScore, liveGame, bottomInset = 0,
}: {
  theme: Theme; matchupId: string; profile: any; opp: any; oppAccent: string; isCompleted: boolean;
  /** Live fantasy totals, repeated on the score rail above the thread. */
  meScore: number | string | null; oppScore: number | string | null;
  liveGame: any;
  /** Home-indicator inset — applied to the composer so it clears the edge. */
  bottomInset?: number;
}) {
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);
  const voice = useVoiceNote();

  const { data: messages = [] } = useQuery({
    queryKey: ['matchup-chat', matchupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchup_messages' as any)
        .select('id, user_id, content, audio_url, audio_duration_ms, created_at, sender:profiles!user_id(username, display_name, avatar_url)')
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
    mutationFn: async (payload: { content?: string; audio?: { url: string; durationMs: number } }) => {
      const { error } = await supabase
        .from('matchup_messages' as any)
        .insert({
          matchup_id: matchupId,
          user_id: profile.id,
          // Null rather than '' — the table's check constraint treats an empty
          // string as absent text, and an audio-only message has none.
          content: payload.content ?? null,
          audio_url: payload.audio?.url ?? null,
          audio_duration_ms: payload.audio?.durationMs ?? null,
        });
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
    sendMutation.mutate({ content: trimmed });
  };

  // Send only happens from the review stage, after the sender has heard it.
  const handleSendVoice = async () => {
    const note = await voice.upload();
    if (note) sendMutation.mutate({ audio: note });
  };

  // Consecutive messages from one person inside this window collapse into a
  // single run: one avatar, one timestamp. Without it every line carries its
  // own furniture and the thread reads as a list of receipts.
  const RUN_WINDOW_MS = 3 * 60 * 1000;

  const runFlags = useMemo(() => {
    return messages.map((m: any, i: number) => {
      const prev = messages[i - 1] as any;
      const next = messages[i + 1] as any;
      const t = new Date(m.created_at).getTime();
      const sameAsPrev =
        prev &&
        prev.user_id === m.user_id &&
        t - new Date(prev.created_at).getTime() < RUN_WINDOW_MS;
      const sameAsNext =
        next &&
        next.user_id === m.user_id &&
        new Date(next.created_at).getTime() - t < RUN_WINDOW_MS;
      const newDay =
        !prev ||
        new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
      return { first: !sameAsPrev || newDay, last: !sameAsNext, newDay };
    });
  }, [messages]);

  const lead = Number(meScore ?? 0) - Number(oppScore ?? 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* ═══ Live score rail ═══════════════════════════════════════════════
          The whole reason this thread exists is the game. Repeating the
          scoreline here means you never leave the argument to check it. */}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 18, paddingVertical: 12,
          backgroundColor: theme.surfaceSunken,
          borderBottomWidth: 1, borderColor: theme.hairline,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 7, height: 7, borderRadius: 100,
              backgroundColor: isCompleted ? theme.muted2 : LIVE_RED,
            }}
          />
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, letterSpacing: 1.1, color: isCompleted ? theme.muted2 : LIVE_RED }}>
            {isCompleted ? 'FINAL' : 'LIVE'}
          </Text>
        </View>

        {liveGame && !isCompleted ? (
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.4 }}>
            Q{liveGame.period ?? 1} · {liveGame.game_clock ?? '--:--'}
          </Text>
        ) : null}

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: theme.accent }}>
            {Number(meScore ?? 0).toFixed(1)}
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2 }}>–</Text>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: oppAccent }}>
            {Number(oppScore ?? 0).toFixed(1)}
          </Text>
        </View>
      </View>

      {lead !== 0 ? (
        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2, textAlign: 'center' }}>
            {lead > 0 ? 'You lead' : `${opp?.username ?? 'They'} lead`} by {Math.abs(lead).toFixed(1)}
          </Text>
        </View>
      ) : null}

      {/* ═══ Thread ════════════════════════════════════════════════════════ */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18,
          flexGrow: 1,
        }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 }}>
            <View
              style={{
                width: 56, height: 56, borderRadius: 100,
                backgroundColor: theme.surfaceSunken,
                borderWidth: 1, borderColor: theme.hairline,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={theme.muted2} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </Svg>
            </View>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>
              {isCompleted ? 'Chat has ended' : 'No messages yet'}
            </Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', lineHeight: 19 }}>
              {isCompleted
                ? 'This match is settled. The thread stays here for the record.'
                : `Say something to @${opp?.username ?? 'your opponent'} while the game runs.`}
            </Text>
          </View>
        }
        renderItem={({ item, index }: { item: any; index: number }) => {
          const isMe = item.user_id === profile?.id;
          const accent = isMe ? theme.accent : oppAccent;
          const flags = runFlags[index] ?? { first: true, last: true, newDay: false };
          const name = item.sender?.display_name || item.sender?.username || (isMe ? 'You' : opp?.username) || '—';

          return (
            <View>
              {flags.newDay ? <DayDivider theme={theme} iso={item.created_at} /> : null}

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-end',
                  gap: 8,
                  marginTop: flags.first ? 12 : 3,
                }}
              >
                {/* Gutter: the avatar only appears on the last message of a
                    run, so a burst reads as one utterance. */}
                {!isMe ? (
                  <View style={{ width: 30 }}>
                    {flags.last ? (
                      <UserAvatar
                        uri={item.sender?.avatar_url ?? opp?.avatar_url ?? null}
                        name={name}
                        size={30}
                        theme={theme}
                        ring={oppAccent}
                      />
                    ) : null}
                  </View>
                ) : null}

                <View style={{ maxWidth: '74%', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                  {flags.first && !isMe ? (
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: oppAccent, letterSpacing: 0.5, marginBottom: 4, marginLeft: 2 }}>
                      {name}
                    </Text>
                  ) : null}

                  {item.audio_url ? (
                    <VoiceNotePlayer
                      url={item.audio_url}
                      durationMs={item.audio_duration_ms}
                      theme={theme}
                      tint={accent}
                      onTint={isMe ? theme.onAccent : theme.bg}
                      compact
                    />
                  ) : (
                    <View
                      style={{
                        paddingHorizontal: 14, paddingVertical: 9,
                        backgroundColor: isMe ? theme.accent : theme.surfaceRaised,
                        borderWidth: isMe ? 0 : 1,
                        borderColor: theme.hairline,
                        // Square off the inner corner mid-run so a burst looks
                        // like one block, and round it again at the tail.
                        borderRadius: 18,
                        borderBottomRightRadius: isMe ? (flags.last ? 5 : 18) : 18,
                        borderTopRightRadius: isMe && !flags.first ? 6 : 18,
                        borderBottomLeftRadius: !isMe ? (flags.last ? 5 : 18) : 18,
                        borderTopLeftRadius: !isMe && !flags.first ? 6 : 18,
                      }}
                    >
                      <Text style={{ fontFamily: FONT.sans, fontSize: 15, lineHeight: 21, color: isMe ? theme.onAccent : theme.ink }}>
                        {item.content}
                      </Text>
                    </View>
                  )}

                  {flags.last ? (
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted2, marginTop: 4, letterSpacing: 0.3 }}>
                      {fmtTime(item.created_at)}
                    </Text>
                  ) : null}
                </View>

                {isMe ? (
                  <View style={{ width: 30 }}>
                    {flags.last ? (
                      <UserAvatar
                        uri={profile?.avatar_url ?? null}
                        name={profile?.display_name || profile?.username || 'Me'}
                        size={30}
                        theme={theme}
                        ring={theme.accent}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        }}
      />

      {/* ═══ Composer ══════════════════════════════════════════════════════ */}
      {!isCompleted ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + bottomInset,
          borderTopWidth: 1, borderColor: theme.hairline,
          backgroundColor: theme.surfaceSunken,
        }}>
          <VoiceRecorderBar
            theme={theme}
            stage={voice.stage}
            durationMs={voice.durationMs}
            levels={voice.levels}
            recordedUri={voice.recordedUri}
            uploading={voice.uploading || sendMutation.isPending}
            onStart={voice.start}
            onStop={voice.stop}
            onSend={handleSendVoice}
            onDiscard={voice.discard}
          />

          {voice.stage !== 'idle' ? null : (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Say something…"
            placeholderTextColor={theme.muted2}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            style={{
              flex: 1, height: 44, backgroundColor: theme.surfaceRaised, borderRadius: 22,
              paddingHorizontal: 16, paddingVertical: 0,
              fontFamily: FONT.sans, fontSize: 15, color: theme.ink,
              borderWidth: 1, borderColor: theme.hairline,
            }}
          />
          )}

          {voice.stage !== 'idle' ? null : (
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            accessibilityLabel="Send message"
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: text.trim() ? theme.accent : theme.surfaceRaised,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: text.trim() ? theme.accent : theme.hairline,
            }}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color={theme.onAccent} />
            ) : (
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={text.trim() ? theme.onAccent : theme.muted2} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z" />
              </Svg>
            )}
          </Pressable>
          )}
        </View>
      ) : (
        <View style={{
          paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + bottomInset,
          borderTopWidth: 1, borderColor: theme.hairline,
          backgroundColor: theme.surfaceSunken, alignItems: 'center',
        }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.8 }}>
            GAME OVER · CHAT IS READ-ONLY
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function DayDivider({ theme, iso }: { theme: Theme; iso: string }) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  const label =
    d.toDateString() === today.toDateString()
      ? 'Today'
      : d.toDateString() === yest.toDateString()
        ? 'Yesterday'
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, marginBottom: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted2, letterSpacing: 1.2 }}>
        {label.toUpperCase()}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
    </View>
  );
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

function SectionLabel({ theme, label }: { theme: Theme; label: string }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
    </View>
  );
}

function PayoutCol({ theme, label, value, accent }: { theme: Theme; label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: accent ? theme.accent : theme.ink, letterSpacing: -0.2 }}>
        {value}
      </Text>
    </View>
  );
}

function Divider({ theme }: { theme: Theme }) {
  return <View style={{ width: 1, height: 36, backgroundColor: theme.hairline, alignSelf: 'center', marginHorizontal: 4 }} />;
}

function ActivityRow({ theme, e }: { theme: Theme; e: any }) {
  const delta = Number(e.fpts_delta ?? 0);
  const positive = delta > 0;
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.hairline, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ width: 3, borderRadius: 2, alignSelf: 'stretch', backgroundColor: positive ? theme.accent : theme.hairline2, marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.ink, lineHeight: 19 }}>
          {e.description}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, marginTop: 3, letterSpacing: 0.4 }}>
          {e.game_period ? `Q${e.game_period}` : ''} {e.game_clock ?? ''} · {fmtRelative(e.created_at)}
        </Text>
      </View>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: positive ? theme.accent : delta < 0 ? theme.muted : theme.ink2, marginTop: 2 }}>
        {positive ? '+' : ''}{delta.toFixed(1)}
      </Text>
    </View>
  );
}

function sortedPicks(lineup: any): any[] {
  return ((lineup?.lineup_players ?? []) as any[]).sort((a, b) => a.slot_number - b.slot_number);
}
