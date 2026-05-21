import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice, playerInitials } from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

export default function FriendsLineupsScreen() {
  const { profile, wallet } = useAuthStore();
  const router = useRouter();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['friends-lineups', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];

      // Fetch both mutual friends (accepted) AND users you're following (pending outgoing)
      const { data: friendRows } = await supabase
        .from('friends')
        .select('requester_id, recipient_id, status')
        .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
        .in('status', ['accepted', 'pending']);

      const friendIds = (friendRows ?? []).reduce<string[]>((acc, row: any) => {
        if (row.status === 'accepted') {
          // Mutual friend — include regardless of direction
          const otherId = row.requester_id === profile.id ? row.recipient_id : row.requester_id;
          acc.push(otherId);
        } else if (row.status === 'pending' && row.requester_id === profile.id) {
          // You sent the request (you follow them) — include
          acc.push(row.recipient_id);
        }
        return acc;
      }, []);

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

      return lineups ?? [];
    },
    enabled: !!profile?.id,
    refetchInterval: 60_000,
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={HG.sky} />}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16 }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.muted }}>← Back</Text>
          </Pressable>
          <Text style={{ fontFamily: FONT.serif, fontSize: 32, color: HG.ink, letterSpacing: -0.5 }}>Friends' Lineups</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, marginTop: 6 }}>
            Tonight's lineups from your friends and people you follow.
          </Text>
        </View>

        {isLoading ? (
          <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
        ) : (data ?? []).length === 0 ? (
          <View style={{ paddingHorizontal: 18 }}>
            <View style={{ padding: 32, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, alignItems: 'center', gap: 12 }}>
              <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink }}>No lineups yet</Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center', lineHeight: 20 }}>
                None of your friends or people you follow have built a lineup for tonight yet.{"\n"}Add more friends or follow players to see their picks.
              </Text>
              <Pressable
                onPress={() => router.push('/friends' as any)}
                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: HG.sky }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.jet, letterSpacing: 1.2 }}>FIND FRIENDS</Text>
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
                    backgroundColor: HG.surface,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: HG.hairline,
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
                      borderBottomColor: HG.hairline,
                    }}
                  >
                    <MonogramTile
                      initials={(user?.display_name ?? user?.username ?? '??').slice(0, 2).toUpperCase()}
                      size={40}
                      showJersey={false}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: HG.ink }}>
                        {user?.display_name ?? user?.username ?? '—'}
                      </Text>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 2 }}>
                        @{user?.username} · {user?.rank_tier ?? 'Bronze'}
                      </Text>
                    </View>
                    <View style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: lineup.status === 'live' ? HG.upSoft : HG.skySoft,
                      borderWidth: 1,
                      borderColor: lineup.status === 'live' ? HG.up + '44' : HG.skyEdge,
                    }}>
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, letterSpacing: 1, color: lineup.status === 'live' ? HG.up : HG.sky }}>
                        {lineup.status === 'live' ? 'LIVE' : lineup.status === 'submitted' ? 'LOCKED IN' : 'BUILDING'}
                      </Text>
                    </View>
                  </Pressable>

                  {players.length === 0 ? (
                    <View style={{ padding: 16 }}>
                      <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted }}>No players added yet.</Text>
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
                              borderTopColor: HG.hairline,
                            }}
                          >
                            <MonogramTile initials={playerInitials(p)} jersey={p?.jersey_number} size={40} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>
                                {p?.full_name ?? '—'}
                              </Text>
                              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 2 }}>
                                {p?.team_abbreviation} · {p?.position}
                                {p?.last5_avg_fpts != null ? ` · ${Number(p.last5_avg_fpts).toFixed(1)} avg FP` : ''}
                              </Text>
                            </View>
                            <Text style={{ fontFamily: FONT.monoBold, fontSize: 14, color: HG.sky }}>
                              {fmtPrice(lp.frozen_price)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  <View style={{
                    padding: 12,
                    borderTopWidth: 1,
                    borderTopColor: HG.hairline,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.8 }}>CAP USED</Text>
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.ink }}>
                      {fmtPrice(lineup.total_cap_used)} <Text style={{ color: HG.muted, fontFamily: FONT.monoMedium }}>/ $500.00</Text>
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
