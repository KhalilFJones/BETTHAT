// =============================================================================
// BETTHAT — Sidebet Detail / Accept (Holy Grail V2, Screen 09 sub-screen)
// Confirms the take you're about to fade. Swipe-to-place locks in the bet at
// the original poster's wager amount.
// =============================================================================

import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { acceptSidebet } from '@/services/sidebet';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice, playerInitials, playerLastName } from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import { SwipeToConfirm } from '@/components/holygrail/SwipeToConfirm';

export default function SidebetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();

  // ALL HOOKS top-level — React's rules of hooks.
  const { data: sb, isLoading } = useQuery({
    queryKey: ['sidebet-detail', id],
    queryFn: async () => {
      if (!id) throw new Error('No sidebet id');
      const { data, error } = await supabase
        .from('sidebets')
        .select(`
          id, creator_id, opponent_id, stat_category, line_value, creator_side,
          creator_reasoning, wager_amount, status, expires_at, created_at,
          like_count, dislike_count, comment_count,
          creator:profiles!creator_id(id, username, display_name, rank_tier),
          nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation),
          nba_games(id, home_team_abbreviation, away_team_abbreviation, status, tip_off_time)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !sb) throw new Error('Not ready');
      if (Number(wallet?.balance ?? 0) < Number(sb.wager_amount)) throw new Error('Insufficient buying power');
      // Use the accept_sidebet RPC which handles wallet escrow atomically.
      await acceptSidebet(sb.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sidebet-detail', id] });
      qc.invalidateQueries({ queryKey: ['sidebets-feed'] });
      router.replace('/(tabs)/sidebets' as any);
    },
  });

  if (isLoading || !sb) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  const isOwnPost = sb.creator_id === profile?.id;
  const isOpen = sb.status === 'open';
  const overSelected = sb.creator_side === 'OVER';
  const youTake = overSelected ? 'UNDER' : 'OVER';
  const sideLabel = labelForStat(sb.stat_category);
  const wagerOk = Number(wallet?.balance ?? 0) >= Number(sb.wager_amount);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: HG.jet }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m15 18-6-6 6-6" />
            </Svg>
          </Pressable>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
            Sidebet · Accept
          </Text>
          <View style={{ width: 20 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
          {/* You take */}
          <View style={{ paddingHorizontal: 18, paddingTop: 22 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
              You take
            </Text>
            <Text style={{ fontFamily: FONT.serif, fontSize: 44, color: HG.ink, marginTop: 6, letterSpacing: -0.8, lineHeight: 50 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>the</Text> {youTake}
            </Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 15, color: HG.ink2, marginTop: 14, lineHeight: 22 }}>
              {playerLastName(sb.nba_players)} {youTake.toLowerCase()} {Number(sb.line_value).toFixed(1)} {sideLabel.toLowerCase()}
              {sb.nba_games ? ` · ${sb.nba_games.away_team_abbreviation} @ ${sb.nba_games.home_team_abbreviation}` : ''}
            </Text>
          </View>

          {/* Posted by */}
          <View style={{ paddingHorizontal: 18, marginTop: 26 }}>
            <View style={{ backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, padding: 16 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 10 }}>
                Posted by {sb.creator?.username ?? '—'}
              </Text>
              {sb.creator_reasoning ? (
                <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.ink, lineHeight: 21 }}>
                  "{sb.creator_reasoning}"
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderColor: HG.hairline }}>
                <MonogramTile initials={playerInitials(sb.nba_players)} jersey={sb.nba_players.jersey_number} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>
                    {sb.nba_players.full_name}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4, marginTop: 2 }}>
                    {sb.nba_players.ticker_handle}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.2 }}>
                    {sideLabel}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 17, color: HG.ink, marginTop: 2 }}>
                    {Number(sb.line_value).toFixed(1)}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Wager */}
          <View style={{ paddingHorizontal: 18, marginTop: 22, alignItems: 'center' }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
              Wager (locked)
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 56, color: wagerOk ? HG.ink : HG.down, marginTop: 8, letterSpacing: -1.2 }}>
              {fmtPrice(sb.wager_amount)}
            </Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: wagerOk ? HG.muted : HG.down, marginTop: 6, textAlign: 'center' }}>
              {wagerOk
                ? `Buying power ${fmtPrice(wallet?.balance)} · winner takes ${fmtPrice(Number(sb.wager_amount) * 1.9)}`
                : `Insufficient buying power · need ${fmtPrice(sb.wager_amount)}`}
            </Text>
            {acceptMutation.isError ? (
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.down, letterSpacing: 0.4, textAlign: 'center', marginTop: 10, paddingHorizontal: 12 }}>
                {(acceptMutation.error as Error)?.message ?? 'Failed to accept. Try again.'}
              </Text>
            ) : null}
          </View>
        </ScrollView>

        {/* CTA */}
        <View
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28,
            backgroundColor: HG.jet, borderTopWidth: 1, borderTopColor: HG.hairline,
          }}
        >
          {!isOpen ? (
            <View style={{ height: 56, borderRadius: 999, backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                {sb.status === 'accepted' ? 'Already accepted' : sb.status}
              </Text>
            </View>
          ) : isOwnPost ? (
            <View style={{ height: 56, borderRadius: 999, backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                You posted this
              </Text>
            </View>
          ) : (
            <>
              <SwipeToConfirm
                label={`Swipe to take ${youTake}`}
                enabled={wagerOk && !acceptMutation.isPending}
                onConfirm={() => acceptMutation.mutate()}
              />
              <Pressable onPress={() => acceptMutation.mutate()} disabled={!wagerOk || acceptMutation.isPending} style={{ alignItems: 'center', paddingVertical: 12, marginTop: 4 }}>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: wagerOk ? HG.sky : HG.muted2, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {acceptMutation.isPending ? 'Placing…' : 'Tap to accept'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
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
