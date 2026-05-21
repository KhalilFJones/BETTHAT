// =============================================================================
// BETTHAT — Matchups list (Holy Grail V2, gateway to Live Game Board / Game Result)
// Lists pending / live / completed matchups for the current user.
// Tap → Live Game Board (Screen 07) for live, Game Result (Screen 08) for completed.
// =============================================================================

import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice, fmtRelative, opponentColor } from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { SectionHead } from '@/components/holygrail/SectionHead';

export default function MatchupsScreen() {
  const router = useRouter();
  const { profile, wallet } = useAuthStore();

  const { data: matchups, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['matchups-list', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return { matchups: [] as any[], unmatched: [] as any[] };
      const [matchupsResult, queueResult] = await Promise.all([
        supabase
          .from('matchups')
          .select(`
            id, status, settled_wager, pot_amount, payout_amount,
            user1_id, user2_id, user1_score, user2_score, score_margin,
            winner_user_id, game_date, started_at, completed_at, created_at,
            u1:profiles!user1_id(id, username, display_name),
            u2:profiles!user2_id(id, username, display_name)
          `)
          .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('matchmaking_queue')
          .select('id, lineup_id, max_wager, game_date, queued_at')
          .eq('user_id', profile.id)
          .gte('expires_at', new Date().toISOString()),
      ]);
      if (matchupsResult.error) throw matchupsResult.error;
      const matchupLineupIds = new Set((matchupsResult.data ?? []).map((m: any) => m.lineup1_id).filter(Boolean));
      // Only show queue entries that don't already have a matchup row
      const unmatched = (queueResult.data ?? []).filter((q: any) => !matchupLineupIds.has(q.lineup_id));
      return { matchups: matchupsResult.data ?? [], unmatched };
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  const allMatchups = matchups?.matchups ?? [];
  const unmatched = matchups?.unmatched ?? [];
  const live = allMatchups.filter((m: any) => ['live', 'matched'].includes(m.status));
  const completed = allMatchups.filter((m: any) => m.status === 'completed');
  const pending = allMatchups.filter((m: any) => m.status === 'pending');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />

      <FlatList
        data={[
          ...(unmatched.length ? [{ kind: 'header' as const, label: 'Searching', count: unmatched.length }] : []),
          ...unmatched.map((q: any) => ({ kind: 'queue' as const, q })),
          ...(pending.length ? [{ kind: 'header' as const, label: 'In queue', count: pending.length }] : []),
          ...pending.map((m: any) => ({ kind: 'row' as const, m })),
          ...(live.length ? [{ kind: 'header' as const, label: 'Live', count: live.length }] : []),
          ...live.map((m: any) => ({ kind: 'row' as const, m })),
          ...(completed.length ? [{ kind: 'header' as const, label: 'Completed', count: completed.length }] : []),
          ...completed.map((m: any) => ({ kind: 'row' as const, m })),
        ]}
        keyExtractor={(item, i) => {
          if (item.kind === 'header') return `h-${(item as any).label}-${i}`;
          if (item.kind === 'queue') return `q-${(item as any).q.id}`;
          return `m-${(item as any).m.id}`;
        }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={HG.sky} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
          ) : (
            <View style={{ padding: 28, marginHorizontal: 18, marginTop: 32, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1 }}>
              <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, marginBottom: 8 }}>
                No <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>matchups</Text> yet
              </Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.muted, lineHeight: 21 }}>
                Build a 3-player lineup in the Market and place an order to get matched with an opponent.
              </Text>
              <Pressable
                onPress={() => router.push('/(tabs)/lineup' as any)}
                style={{ marginTop: 18, height: 44, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                  Open Market
                </Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            const h = item as { kind: 'header'; label: string; count: number };
            return <SectionHead word={h.label} label={String(h.count)} />;
          }
          if (item.kind === 'queue') {
            const q = (item as any).q;
            return (
              <View style={{ marginHorizontal: 18, marginVertical: 4, padding: 16, backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HG.sky }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>Searching for opponent…</Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, marginTop: 2 }}>
                    Wager: ${Number(q.max_wager).toFixed(2)} · {q.game_date}
                  </Text>
                </View>
                <ActivityIndicator size="small" color={HG.sky} />
              </View>
            );
          }
          const r = item as { kind: 'row'; m: any };
          return (
            <MatchupRow
              matchup={r.m}
              meId={profile?.id ?? ''}
              onPress={() => router.push(`/matchup/${r.m.id}` as any)}
            />
          );
        }}
      />
    </SafeAreaView>
  );
}

function MatchupRow({ matchup, meId, onPress }: { matchup: any; meId: string; onPress: () => void }) {
  const meIs1 = matchup.user1_id === meId;
  const opponent = meIs1 ? matchup.u2 : matchup.u1;
  const myScore = meIs1 ? matchup.user1_score : matchup.user2_score;
  const oppScore = meIs1 ? matchup.user2_score : matchup.user1_score;
  const oppAccent = opponentColor(opponent?.username);

  const status = matchup.status;
  const won = matchup.winner_user_id === meId;

  let chip: { label: string; color: string; bg: string } | null = null;
  if (status === 'pending') chip = { label: 'IN QUEUE', color: HG.sky, bg: HG.skySoft };
  else if (status === 'matched') chip = { label: 'MATCHED', color: HG.sky, bg: HG.skySoft };
  else if (status === 'live') chip = { label: 'LIVE', color: HG.sky, bg: HG.skySoft };
  else if (status === 'completed') chip = won ? { label: 'WIN', color: HG.sky, bg: HG.skySoft } : { label: 'LOSS', color: HG.muted, bg: 'rgba(58,58,60,0.18)' };

  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: 18, marginBottom: 10, padding: 16, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.4 }}>
          {fmtRelative(matchup.created_at)} · {fmtPrice(matchup.settled_wager ?? matchup.pot_amount)}
        </Text>
        {chip ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: chip.bg }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 1.2, color: chip.color }}>
              {chip.label}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase' }}>You</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 24, color: HG.ink, marginTop: 2, letterSpacing: -0.4 }}>
            {Number(myScore ?? 0).toFixed(1)}
          </Text>
        </View>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, marginHorizontal: 8 }}>vs</Text>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {/* V2.1 Amendment 2: opponent accent dot */}
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: oppAccent }} />
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4 }}>
              {opponent?.username ?? '—'}
            </Text>
          </View>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 24, color: HG.ink2, marginTop: 2, letterSpacing: -0.4 }}>
            {Number(oppScore ?? 0).toFixed(1)}
          </Text>
        </View>
      </View>

      {status === 'completed' && matchup.payout_amount && won ? (
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.sky, marginTop: 8, letterSpacing: 0.4 }}>
          + {fmtPrice(matchup.payout_amount)} payout
        </Text>
      ) : null}
    </Pressable>
  );
}
