// =============================================================================
// BETTHAT — Match Result (Figma "Portfolio – Return", WIN + LOSS variants)
// Shown when a matchup settles. Dark hero over a light sheet:
//   • Hero — "Match Over", WINNER/LOSER, the two totals, vs-line, Payout vs
//     Entry, and the rank progression bar.
//   • Actions card — Share Result (opens the composer with this matchup
//     already attached) and a wallet row.
//   • Lineups card — segmented Your Lineup / @opponent, each pick as a
//     stat card with its FP in an accent-ringed pill.
//   • Play Again — back to the Draft Market.
//
// The two variants are the same screen: WIN tints the hero figures with the
// brand accent, LOSS greys them out.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { rankProgress, matchPoints } from '@/lib/rank';

// Hero is always dark regardless of app theme — it's an art-directed moment.
const HERO_BG = '#151517';
const HERO_MUTED = '#C4C4C5';
const HERO_DIM = '#67676A';
const HERO_HAIRLINE = '#D9D9DA';
const ACCENT = '#F0F600';
const ACCENT_TRACK = '#9EA200';
const LOSS_INK = '#8A8A8E';
const STAT_KEYS = ['PTS', 'REB', 'AST', 'STL', 'TO'] as const;

export default function MatchResultScreen() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile, wallet } = useAuthStore();
  const [side, setSide] = useState<'mine' | 'theirs'>('mine');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['match-result', id, profile?.id],
    queryFn: async () => {
      if (!id || !profile?.id) return null;

      const { data: m, error } = await supabase
        .from('matchups')
        .select(`
          id, status, game_date, user1_id, user2_id, lineup1_id, lineup2_id,
          payout_amount, settled_wager, entry_tier, winner_user_id,
          user1_final_score, user2_final_score, user1_score, user2_score,
          u1:profiles!matchups_user1_id_fkey(id, username, display_name, rank_tier, total_wins, total_earnings),
          u2:profiles!matchups_user2_id_fkey(id, username, display_name, rank_tier, total_wins, total_earnings),
          l1:lineups!matchups_lineup1_id_fkey(id, lineup_players(slot_number, nba_players(id, full_name, team_abbreviation))),
          l2:lineups!matchups_lineup2_id_fkey(id, lineup_players(slot_number, nba_players(id, full_name, team_abbreviation)))
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!m) return null;

      const mm: any = m;
      const iAmUser1 = mm.user1_id === profile.id;
      const mine = iAmUser1 ? mm.l1 : mm.l2;
      const theirs = iAmUser1 ? mm.l2 : mm.l1;
      const meProfile = iAmUser1 ? mm.u1 : mm.u2;
      const oppProfile = iAmUser1 ? mm.u2 : mm.u1;

      const playerIds: string[] = [];
      for (const side of [mine, theirs]) {
        for (const lp of side?.lineup_players ?? []) {
          if (lp.nba_players?.id) playerIds.push(lp.nba_players.id);
        }
      }

      // Box scores + who each player faced, for the "vs. <team>" caption.
      const stats = new Map<string, any>();
      const opponentTeam = new Map<string, string>();
      if (playerIds.length > 0) {
        const { data: rows } = await supabase
          .from('player_game_stats')
          .select(`
            player_id, points, rebounds, assists, steals, turnovers, fantasy_points,
            nba_games!inner(game_date, home_team, away_team, home_team_abbreviation, away_team_abbreviation)
          `)
          .in('player_id', playerIds)
          .eq('nba_games.game_date', mm.game_date);
        for (const r of (rows ?? []) as any[]) stats.set(r.player_id, r);
      }

      const build = (lineupSide: any) =>
        (lineupSide?.lineup_players ?? [])
          .slice()
          .sort((a: any, b: any) => a.slot_number - b.slot_number)
          .map((lp: any) => {
            const p = lp.nba_players;
            const st = stats.get(p?.id);
            const g = st?.nba_games;
            let vs = '';
            if (g && p) {
              vs = p.team_abbreviation === g.home_team_abbreviation ? g.away_team : g.home_team;
            }
            return {
              id: p?.id,
              name: p?.full_name ?? 'Unknown',
              vs,
              fp: Number(st?.fantasy_points ?? 0),
              PTS: st?.points ?? 0,
              REB: st?.rebounds ?? 0,
              AST: st?.assists ?? 0,
              STL: st?.steals ?? 0,
              TO: st?.turnovers ?? 0,
            };
          });

      const myRoster = build(mine);
      const theirRoster = build(theirs);
      const myScore = Number(
        (iAmUser1 ? mm.user1_final_score ?? mm.user1_score : mm.user2_final_score ?? mm.user2_score) ?? 0,
      );
      const theirScore = Number(
        (iAmUser1 ? mm.user2_final_score ?? mm.user2_score : mm.user1_final_score ?? mm.user1_score) ?? 0,
      );

      const won = mm.winner_user_id === profile.id;
      const entry = Number(mm.settled_wager ?? mm.entry_tier ?? 0);
      const payout = won ? Number(mm.payout_amount ?? 0) : 0;

      return {
        matchupId: mm.id,
        won,
        settled: mm.status === 'completed',
        myScore,
        theirScore,
        entry,
        payout,
        opponent: oppProfile?.display_name || oppProfile?.username || 'Opponent',
        opponentHandle: oppProfile?.username ? `@${oppProfile.username}` : 'Opponent',
        format: `${myRoster.length}v${myRoster.length} Head to Head`,
        myRoster,
        theirRoster,
        rank: rankProgress(
          meProfile?.rank_tier,
          Number(meProfile?.total_wins ?? 0),
          Number(meProfile?.total_earnings ?? 0),
          matchPoints(won, payout, entry),
        ),
      };
    },
    enabled: !!id && !!profile?.id,
  });

  // Deep-linking an unsettled matchup here would render a result for a game
  // still in progress — send it to the live board instead.
  useEffect(() => {
    if (data && !data.settled && id) router.replace(`/matchup/${id}` as any);
  }, [data, id, router]);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HERO_BG, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={ACCENT} />
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HERO_BG, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
        <StatusBar style="light" />
        <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: '#FFFFFF', textAlign: 'center' }}>
          Couldn't load this result.
        </Text>
        <Pressable onPress={() => router.replace('/(tabs)/matchups' as any)} style={{ height: 48, paddingHorizontal: 28, borderRadius: 100, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: HERO_BG }}>Back to matchups</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const { won } = data;
  const roster = side === 'mine' ? data.myRoster : data.theirRoster;

  return (
    <View style={{ flex: 1, backgroundColor: HERO_BG }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 0 }} showsVerticalScrollIndicator={false}>
        {/* ═══ Hero ═══════════════════════════════════════════════════════ */}
        <SafeAreaView edges={['top']}>
          <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 28 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: HERO_MUTED }}>
                  Match Over
                </Text>
                <Text style={{ fontFamily: FONT.sansBold, fontSize: 36, lineHeight: 46.8, color: won ? ACCENT : LOSS_INK }}>
                  {won ? 'WINNER' : 'LOSER'}
                </Text>
              </View>
              <Pressable
                onPress={() => router.replace('/(tabs)/matchups' as any)}
                accessibilityLabel="Close result"
                hitSlop={8}
                style={{ width: 40, height: 40, borderRadius: 100, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}
              >
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={HERO_BG} strokeWidth={2.6} strokeLinecap="round">
                  <Path d="M18 6 6 18M6 6l12 12" />
                </Svg>
              </Pressable>
            </View>

            {/* Score line — the winning figure carries the accent */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, lineHeight: 36, color: won ? ACCENT : '#FFFFFF' }}>
                {data.myScore.toFixed(1)}
              </Text>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, lineHeight: 36, color: '#FFFFFF' }}>-</Text>
              <Text style={{ fontFamily: won ? FONT.sansMedium : FONT.sansBold, fontSize: 24, lineHeight: 36, color: won ? '#FFFFFF' : ACCENT }}>
                {data.theirScore.toFixed(1)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: HERO_HAIRLINE }}>
                vs {data.opponent}
              </Text>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: HERO_HAIRLINE }}>
                {data.format}
              </Text>
            </View>

            {/* Payout / Entry */}
            <View style={{ marginTop: 26 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: HERO_MUTED }}>Payout</Text>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: HERO_DIM }}>Entry</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, lineHeight: 36, color: ACCENT }}>
                  +{data.payout.toFixed(2)}
                </Text>
                <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, lineHeight: 36, color: HERO_DIM }}>
                  -{data.entry.toFixed(0)}
                </Text>
              </View>
            </View>

            {/* Rank progression */}
            <View style={{ marginTop: 26 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: '#FFFFFF' }}>
                  {data.rank.label}
                </Text>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: '#FFFFFF' }}>
                  {data.rank.nextLabel}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 10, backgroundColor: '#EAEAEA', overflow: 'hidden', marginTop: 6 }}>
                <View style={{ width: `${data.rank.progress * 100}%`, height: 6, borderRadius: 10, backgroundColor: ACCENT_TRACK }} />
              </View>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: '#FFFFFF', textAlign: 'right', marginTop: 6 }}>
                +{data.rank.delta}
              </Text>
            </View>
          </View>
        </SafeAreaView>

        {/* ═══ Light sheet ════════════════════════════════════════════════ */}
        <View style={{ backgroundColor: theme.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8, paddingBottom: 8 }}>
          {/* Actions */}
          <View style={[s.card, { padding: 16, gap: 16 }]}>
            <Pressable
              onPress={() => router.push(`/social/compose?matchup=${data.matchupId}` as any)}
              accessibilityLabel="Share this result to the feed"
              style={{
                height: 48, borderRadius: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
              }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 16V4M8 8l4-4 4 4" />
                <Path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
              </Svg>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.ink }}>Share Result</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/wallet' as any)}
              accessibilityLabel="Open wallet"
              style={{
                paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.surfaceSunken,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>Wallet</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, lineHeight: 27, color: theme.ink }}>
                  {fmtPrice(wallet?.balance ?? null)}
                </Text>
                <View style={{ width: 28, height: 28, borderRadius: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline }}>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="m9 6 6 6-6 6" />
                  </Svg>
                </View>
              </View>
            </Pressable>
          </View>

          {/* Lineups */}
          <View style={[s.card, { paddingTop: 16, paddingBottom: 16, gap: 8 }]}>
            <View style={{ paddingHorizontal: 16 }}>
              <View style={s.segTrack}>
                <SegButton theme={theme} label="Your Lineup" active={side === 'mine'} onPress={() => setSide('mine')} />
                <SegButton theme={theme} label={data.opponentHandle} active={side === 'theirs'} onPress={() => setSide('theirs')} />
              </View>
            </View>

            <View style={{ paddingHorizontal: 10, gap: 11 }}>
              {roster.length === 0 ? (
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, padding: 20, textAlign: 'center' }}>
                  No lineup to show for this side.
                </Text>
              ) : (
                roster.map((p: any) => <PlayerStatCard key={p.id ?? p.name} player={p} theme={theme} />)
              )}
            </View>
          </View>

          {/* Play Again */}
          <SafeAreaView edges={['bottom']}>
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <Pressable
                onPress={() => router.replace('/(tabs)/lineup' as any)}
                accessibilityLabel="Play again"
                style={{ height: 48, borderRadius: 100, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.surface }}>
                  Play Again
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </ScrollView>
    </View>
  );
}

function SegButton({ theme, label, active, onPress }: { theme: Theme; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 100, paddingHorizontal: 16,
        backgroundColor: active ? theme.surface : 'transparent',
        borderWidth: active ? 1 : 0, borderColor: theme.hairline,
      }}
    >
      <Text numberOfLines={1} style={{
        fontFamily: active ? FONT.sansMedium : FONT.sans, fontSize: 14, lineHeight: 21.7,
        color: active ? theme.ink : theme.muted,
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One pick: name + opponent caption + accent-ringed FP pill over a stat strip. */
function PlayerStatCard({ player, theme }: { player: any; theme: Theme }) {
  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surfaceSunken, overflow: 'hidden' }}>
      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansBold, fontSize: 16, lineHeight: 24, color: theme.ink }}>
            {player.name}
          </Text>
          {player.vs ? (
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: '#AAAAAC' }}>
              vs. {player.vs}
            </Text>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 100, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.accent }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, lineHeight: 21, color: theme.ink }}>
            {Number(player.fp).toFixed(1)}
          </Text>
        </View>
      </View>

      <View style={{ padding: 12, backgroundColor: theme.surface, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {STAT_KEYS.map((k) => (
            <Text key={k} style={{ flex: 1, textAlign: 'center', fontFamily: FONT.sans, fontSize: 10, lineHeight: 15, color: theme.ink }}>
              {k}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {STAT_KEYS.map((k) => (
            <Text key={k} style={{ flex: 1, textAlign: 'center', fontFamily: FONT.sansBold, fontSize: 10, lineHeight: 15, color: theme.ink }}>
              {player[k] ?? 0}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

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
    segTrack: {
      flexDirection: 'row' as const, height: 40, borderRadius: 100,
      backgroundColor: t.surfaceSunken, overflow: 'hidden' as const,
    },
  };
}
