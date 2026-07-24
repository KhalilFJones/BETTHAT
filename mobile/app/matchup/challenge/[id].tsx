// =============================================================================
// BETTHAT — Friend Challenge Detail
// Landing screen for a `friend_challenge` notification tap (or a direct link
// to a challenge id). Shows the challenger's lineup + stake and:
//   • if you're the RECIPIENT and it's still pending — Accept (with your own
//     building lineup) or Decline.
//   • if you're the CHALLENGER and it's still pending — Cancel.
//   • otherwise — a resolved state (accepted → view matchup, declined/
//     expired/cancelled → informational).
// =============================================================================

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, playerLastName, SALARY_CAP, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import { acceptFriendChallenge, declineFriendChallenge, cancelFriendChallenge } from '@/services/matchup';

export default function FriendChallengeScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuthStore();
  const [acting, setActing] = useState(false);

  const { data: challenge, isLoading } = useQuery({
    queryKey: ['friend-challenge', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('friend_challenges')
        .select(`
          id, status, entry_tier, message, expires_at, matchup_id,
          challenger_id, recipient_id,
          challenger:profiles!challenger_id(id, username, display_name),
          recipient:profiles!recipient_id(id, username, display_name),
          lineup:lineups!challenger_lineup_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price, nba_players(id, full_name, position, team_abbreviation)))
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  // My own building lineup — what I'd accept with.
  const { data: myLineup } = useQuery({
    queryKey: ['my-building-lineup', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('lineups')
        .select('id, total_cap_used, lineup_players(slot_number, nba_players(full_name))')
        .eq('user_id', profile.id)
        .eq('status', 'building')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
    enabled: !!profile?.id,
  });

  // All three mutations flip a lineup's status server-side (accept locks
  // mine into the new matchup; decline/cancel free the challenger's back to
  // `building`) — invalidate every query that reads lineup status so the
  // Draft Market's sticky bar and the profile screen's challenge indicator
  // don't sit on stale pre-mutation state until their own staleTime lapses.
  const invalidateLineupState = () => {
    qc.invalidateQueries({ queryKey: ['my-pending-challenge'] });
    qc.invalidateQueries({ queryKey: ['my-building-lineup'] });
    qc.invalidateQueries({ queryKey: ['player-market'] });
  };

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!myLineup?.id) throw new Error('Build a 3-player lineup first.');
      return acceptFriendChallenge(id!, myLineup.id);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['friend-challenge', id] });
      qc.invalidateQueries({ queryKey: ['matchups-list'] });
      invalidateLineupState();
      router.replace(`/matchup/${result.matchup_id}` as any);
    },
    onError: (err: Error) => Alert.alert('Could not accept', err.message),
    onSettled: () => setActing(false),
  });

  const declineMutation = useMutation({
    mutationFn: () => declineFriendChallenge(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friend-challenge', id] });
      invalidateLineupState();
    },
    onError: (err: Error) => Alert.alert('Could not decline', err.message),
    onSettled: () => setActing(false),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelFriendChallenge(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friend-challenge', id] });
      invalidateLineupState();
    },
    onError: (err: Error) => Alert.alert('Could not cancel', err.message),
    onSettled: () => setActing(false),
  });

  if (isLoading || !challenge) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  const isRecipient = challenge.recipient_id === profile?.id;
  const isChallenger = challenge.challenger_id === profile?.id;
  const other = isRecipient ? challenge.challenger : challenge.recipient;
  const picked = ((challenge.lineup?.lineup_players ?? []) as any[]).slice().sort((a, b) => a.slot_number - b.slot_number);
  const isPending = challenge.status === 'pending' && new Date(challenge.expires_at).getTime() > Date.now();
  const hasFullLineup = ((myLineup?.lineup_players ?? []) as any[]).length === LINEUP_SIZE;

  const statusLabel: Record<string, string> = {
    pending: 'Awaiting response', accepted: 'Accepted', declined: 'Declined',
    expired: 'Expired', cancelled: 'Cancelled',
  };
  const statusColor: Record<string, string> = {
    pending: theme.muted, accepted: theme.accent, declined: theme.danger, expired: theme.muted, cancelled: theme.muted,
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 60 }}>
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
          <MonogramTile
            initials={(other?.display_name ?? other?.username ?? '??').slice(0, 2).toUpperCase()}
            size={72} showJersey={false}
          />
          <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: theme.ink, textAlign: 'center' }}>
            {isRecipient
              ? <>Challenge from <Text style={{ fontFamily: FONT.serifItalic, color: theme.accent }}>{other?.display_name ?? other?.username}</Text></>
              : <>Your challenge to <Text style={{ fontFamily: FONT.serifItalic, color: theme.accent }}>{other?.display_name ?? other?.username}</Text></>}
          </Text>
          <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: (statusColor[challenge.status] ?? theme.muted) + '66' }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: statusColor[challenge.status] ?? theme.muted, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              {isPending ? statusLabel.pending : statusLabel[challenge.status] ?? challenge.status}
            </Text>
          </View>
        </View>

        {challenge.message ? (
          <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 14, marginBottom: 16 }}>
            <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.ink2, fontStyle: 'italic' }}>"{challenge.message}"</Text>
          </View>
        ) : null}

        {/* Challenger's lineup */}
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
          {isRecipient ? `${other?.display_name ?? other?.username}'s lineup` : 'Your lineup'}
        </Text>
        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden', marginBottom: 16 }}>
          {picked.map((lp: any, i: number) => (
            <Pressable
              key={i}
              onPress={() => lp.nba_players?.id && router.push(`/player/${lp.nba_players.id}` as any)}
              accessibilityLabel={`View ${lp.nba_players.full_name}`}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderColor: theme.hairline }}
            >
              <View>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>{lp.nba_players.full_name}</Text>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, marginTop: 2 }}>
                  {lp.nba_players.team_abbreviation} · {lp.nba_players.position}
                </Text>
              </View>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: theme.ink }}>{fmtPrice(lp.frozen_price)}</Text>
            </Pressable>
          ))}
        </View>

        {/* Stake */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 14, marginBottom: 24 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>Stake (each side)</Text>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: theme.accent }}>{fmtPrice(challenge.entry_tier)}</Text>
        </View>

        {isPending && isRecipient && (
          <View style={{ gap: 12 }}>
            {!hasFullLineup ? (
              <>
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', lineHeight: 19 }}>
                  Build a 3-player lineup in the Draft Market to accept this challenge.
                </Text>
                <Pressable
                  onPress={() => router.push('/(tabs)/lineup' as any)}
                  style={{ height: 52, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    Open Draft Market
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => { setActing(true); acceptMutation.mutate(); }}
                disabled={acting}
                style={{ height: 52, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', opacity: acting ? 0.6 : 1 }}
              >
                {acceptMutation.isPending ? <ActivityIndicator color={theme.onAccent} /> : (
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    Accept — Stake {fmtPrice(challenge.entry_tier)}
                  </Text>
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => { setActing(true); declineMutation.mutate(); }}
              disabled={acting}
              style={{ height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', opacity: acting ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
                {declineMutation.isPending ? 'Declining…' : 'Decline'}
              </Text>
            </Pressable>
          </View>
        )}

        {isPending && isChallenger && !isRecipient && (
          <Pressable
            onPress={() => { setActing(true); cancelMutation.mutate(); }}
            disabled={acting}
            style={{ height: 48, borderRadius: 999, borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center', opacity: acting ? 0.6 : 1 }}
          >
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel challenge'}
            </Text>
          </Pressable>
        )}

        {challenge.status === 'accepted' && challenge.matchup_id && (
          <Pressable
            onPress={() => router.push(`/matchup/${challenge.matchup_id}` as any)}
            style={{ height: 52, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              View Matchup →
            </Text>
          </Pressable>
        )}

        {['declined', 'expired', 'cancelled'].includes(challenge.status) && (
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center' }}>
            {challenge.status === 'declined' && 'This challenge was declined. Any escrowed stake was refunded.'}
            {challenge.status === 'expired' && 'This challenge expired without a response.'}
            {challenge.status === 'cancelled' && 'This challenge was cancelled.'}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
