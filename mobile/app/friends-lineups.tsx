import { useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, playerInitials, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

// Status priority for sort — surfaces friends who are actively drafting right
// now at the top, since that's the moment worth watching live.
const STATUS_RANK: Record<string, number> = { building: 0, live: 1, submitted: 2 };

export default function FriendsLineupsScreen() {
  const theme = useTheme();
  const { profile, wallet } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['friends-lineups', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];

      // Only mutual (accepted) friends — the `lineups_select_friends` RLS
      // policy requires friends.status = 'accepted', so pending outgoing
      // requests were previously included here (as "people you follow") but
      // could never actually return a row: RLS silently dropped every
      // lineup belonging to a not-yet-accepted recipient. Rather than a
      // client-side branch promising data the backend can't serve, this now
      // only requests what's actually visible.
      const { data: friendRows } = await supabase
        .from('friends')
        .select('requester_id, recipient_id, status')
        .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
        .eq('status', 'accepted');

      const friendIds = (friendRows ?? []).map((row: any) =>
        row.requester_id === profile.id ? row.recipient_id : row.requester_id,
      );

      // Deduplicate
      const uniqueIds = [...new Set(friendIds)];
      if (uniqueIds.length === 0) return [];

      const today = new Date().toISOString().slice(0, 10);
      const { data: lineups } = await supabase
        .from('lineups')
        .select(`
          id, total_cap_used, status, game_date, created_at,
          user_id,
          profiles!user_id(id, username, display_name, rank_tier),
          lineup_players(
            slot_number, frozen_price,
            nba_players(id, full_name, first_name, last_name, position, jersey_number, team_abbreviation, season_avg_fpts, last5_avg_fpts)
          )
        `)
        .in('user_id', uniqueIds)
        .in('status', ['submitted', 'live', 'building'])
        .eq('game_date', today)
        .order('created_at', { ascending: false })
        .limit(20);

      // Drafting-live lineups float to the top — that's the moment worth
      // watching; a fully locked-in lineup isn't going anywhere.
      return [...(lineups ?? [])].sort(
        (a: any, b: any) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
      );
    },
    enabled: !!profile?.id,
    // Realtime (below) delivers pick-by-pick updates as friends draft; this
    // is just the safety-net poll for missed events (dropped socket, app
    // backgrounded mid-draft, etc.) — same defense-in-depth pattern as the
    // matchup detail screen's realtime+poll combo.
    refetchInterval: 60_000,
  });

  // Watch a friend draft live: no client-side filter on user_id here — RLS
  // (lineups_select_friends / lineup_players_select_friends) already scopes
  // these tables to your own rows + accepted friends' rows, and Realtime
  // enforces the same policies per-subscriber, so an unfiltered subscription
  // only ever delivers events for rows this screen's query could already see.
  // Picks a friend adds/removes, and status flips (building → submitted),
  // land here the instant they happen instead of waiting for the 60s poll.
  useEffect(() => {
    if (!profile?.id) return;
    const invalidate = () => qc.invalidateQueries({ queryKey: ['friends-lineups', profile.id] });
    const ch = supabase
      .channel(`friends-lineups-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lineups' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lineup_players' }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id, qc]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader walletBalance={wallet?.balance} showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} />}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16 }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted }}>← Back</Text>
          </Pressable>
          <Text style={{ fontFamily: FONT.serif, fontSize: 32, color: theme.ink, letterSpacing: -0.5 }}>Friends' Lineups</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, marginTop: 6 }}>
            Tonight's lineups from your friends — watch a draft happen live as they pick.
          </Text>
        </View>

        {isLoading ? (
          <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : (data ?? []).length === 0 ? (
          <View style={{ paddingHorizontal: 18 }}>
            <View style={{ padding: 32, backgroundColor: theme.surface, borderRadius: 16, borderColor: theme.hairline, borderWidth: 1, alignItems: 'center', gap: 12 }}>
              <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: theme.ink }}>No lineups yet</Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', lineHeight: 20 }}>
                None of your friends have built a lineup for tonight yet.{"\n"}Add more friends to see their picks.
              </Text>
              <Pressable
                onPress={() => router.push('/social/connections' as any)}
                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: theme.accent }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.onAccent, letterSpacing: 1.2 }}>FIND FRIENDS</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 18, gap: 16 }}>
            {(data ?? []).map((lineup: any) => {
              const user = lineup.profiles;
              const players = (lineup.lineup_players ?? []).sort((a: any, b: any) => a.slot_number - b.slot_number);
              return (
                <View
                  key={lineup.id}
                  style={{
                    backgroundColor: theme.surface,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.hairline,
                    overflow: 'hidden',
                  }}
                >
                  <Pressable
                    onPress={() => user?.id && router.push(`/user/${user.id}` as any)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.hairline,
                    }}
                  >
                    <MonogramTile
                      initials={(user?.display_name ?? user?.username ?? '??').slice(0, 2).toUpperCase()}
                      size={40}
                      showJersey={false}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>
                        {user?.display_name ?? user?.username ?? '—'}
                      </Text>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, marginTop: 2 }}>
                        @{user?.username} · {user?.rank_tier ?? 'Bronze'}
                      </Text>
                    </View>
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: lineup.status === 'live' ? theme.gainSoft : theme.accentSoft,
                      borderWidth: 1,
                      borderColor: lineup.status === 'live' ? theme.up + '44' : theme.accentEdge,
                    }}>
                      {lineup.status === 'building' ? (
                        <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: theme.accent }} />
                      ) : null}
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 1, color: lineup.status === 'live' ? theme.up : theme.accent }}>
                        {lineup.status === 'live' ? 'LIVE' : lineup.status === 'submitted' ? 'LOCKED IN' : 'DRAFTING LIVE'}
                      </Text>
                    </View>
                  </Pressable>

                  {lineup.status === 'building' ? (
                    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: players.length ? 0 : 12 }}>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.6 }}>
                        {players.length} OF {LINEUP_SIZE} PICKED
                      </Text>
                    </View>
                  ) : null}

                  {players.length === 0 && lineup.status !== 'building' ? (
                    <View style={{ padding: 16 }}>
                      <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>No players added yet.</Text>
                    </View>
                  ) : (
                    <View>
                      {players.map((lp: any) => {
                        const p = lp.nba_players;
                        return (
                          <Pressable
                            key={lp.slot_number}
                            onPress={() => p?.id && router.push(`/player/${p.id}` as any)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 12,
                              paddingHorizontal: 16,
                              paddingVertical: 12,
                              borderTopWidth: 1,
                              borderTopColor: theme.hairline,
                            }}
                          >
                            <MonogramTile initials={playerInitials(p)} jersey={p?.jersey_number} size={40} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>
                                {p?.full_name ?? '—'}
                              </Text>
                              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, marginTop: 2 }}>
                                {p?.team_abbreviation} · {p?.position}
                                {p?.last5_avg_fpts != null ? ` · ${Number(p.last5_avg_fpts).toFixed(1)} avg FP` : ''}
                              </Text>
                            </View>
                            <Text style={{ fontFamily: FONT.monoBold, fontSize: 14, color: theme.accent }}>
                              {fmtPrice(lp.frozen_price)}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {lineup.status === 'building' &&
                        Array.from({ length: Math.max(0, LINEUP_SIZE - players.length) }).map((_, i) => (
                          <View
                            key={`ghost-${i}`}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 12,
                              paddingHorizontal: 16,
                              paddingVertical: 12,
                              borderTopWidth: 1,
                              borderTopColor: theme.hairline,
                            }}
                          >
                            <View
                              style={{
                                width: 40, height: 40, borderRadius: 9,
                                borderWidth: 1, borderStyle: 'dashed', borderColor: theme.hairline2,
                              }}
                            />
                            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted2, fontStyle: 'italic' }}>
                              Waiting for pick {players.length + i + 1}…
                            </Text>
                          </View>
                        ))}
                    </View>
                  )}

                  <View style={{
                    padding: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.hairline,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.8 }}>CAP USED</Text>
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: theme.ink }}>
                      {fmtPrice(lineup.total_cap_used)} <Text style={{ color: theme.muted, fontFamily: FONT.monoMedium }}>/ $500.00</Text>
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
