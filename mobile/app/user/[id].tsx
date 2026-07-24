// =============================================================================
// BETTHAT — Public User Profile (Holy Grail V2, Screen 10b)
// Shows any user's record, rank, earnings, recent achievements.
// Challenge CTA → real friend-challenge flow (create_friend_challenge RPC),
// using the viewer's current `building` lineup at a fixed stake both sides
// escrow. Send friend request inline.
// =============================================================================

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, playerLastName, SALARY_CAP, MIN_WAGER, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import { createFriendChallenge, cancelFriendChallenge } from '@/services/matchup';

const CHALLENGE_QUICK_WAGERS = [5, 10, 25, 50, 100] as const;

const RANK_TINT: Record<string, string> = {
  Bronze: '#CD7F32', Silver: '#9E9E9E', Gold: '#F5A524',
  Platinum: '#5B9BD5', Diamond: '#A855F7',
};

export default function UserProfileScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuthStore();

  const { data: user, isLoading } = useQuery({
    queryKey: ['user_profile', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('User not found');
      return data;
    },
    enabled: !!id,
  });

  const { data: achievements } = useQuery({
    queryKey: ['user_achievements_public', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_achievements')
        .select('*, achievement:achievements(name, rarity)')
        .eq('user_id', id!)
        .order('earned_at', { ascending: false })
        .limit(9);
      return data ?? [];
    },
    enabled: !!id,
  });

  // Check if already friends
  const { data: friendStatus } = useQuery({
    queryKey: ['friend-status', profile?.id, id],
    queryFn: async () => {
      if (!profile?.id || !id) return null;
      const { data } = await supabase
        .from('friends')
        .select('id, status')
        .or(
          `and(requester_id.eq.${profile.id},recipient_id.eq.${id}),` +
          `and(requester_id.eq.${id},recipient_id.eq.${profile.id})`
        )
        .maybeSingle();
      return data as { id: string; status: string } | null;
    },
    enabled: !!profile?.id && !!id,
  });

  const sendRequest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('friends').insert({
        requester_id: profile!.id,
        recipient_id: id!,
        status: 'pending',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friend-status'] }),
    onError: (err: Error) => Alert.alert('Could not send request', err.message),
  });

  // My own current draft, if any — the lineup a challenge would be sent with.
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

  // A challenge I already sent to this specific person, if still pending.
  const { data: myPendingChallenge } = useQuery({
    queryKey: ['my-pending-challenge', profile?.id, id],
    queryFn: async () => {
      if (!profile?.id || !id) return null;
      const { data } = await supabase
        .from('friend_challenges')
        .select('id, entry_tier, status')
        .eq('challenger_id', profile.id)
        .eq('recipient_id', id)
        .eq('status', 'pending')
        .maybeSingle();
      return data as { id: string; entry_tier: number; status: string } | null;
    },
    enabled: !!profile?.id && !!id,
    // No realtime subscription on friend_challenges — poll while this screen
    // is open so an accept/decline that lands while you're looking at it
    // clears the "Challenge sent" pill instead of sitting stale.
    refetchInterval: 15_000,
  });

  const [challengeModalOpen, setChallengeModalOpen] = useState(false);
  const [wager, setWager] = useState('');

  const sendChallenge = useMutation({
    mutationFn: async () => {
      const amount = Number(wager);
      if (!myLineup?.id) throw new Error('Build a 3-player lineup in the Draft Market first.');
      return createFriendChallenge(id!, myLineup.id, amount);
    },
    onSuccess: () => {
      setChallengeModalOpen(false);
      setWager('');
      qc.invalidateQueries({ queryKey: ['my-pending-challenge'] });
      qc.invalidateQueries({ queryKey: ['my-building-lineup'] });
      // Sending locks this lineup server-side (status -> 'submitted') — clear
      // the Draft Market's cached "in progress" lineup so its sticky bar
      // doesn't keep showing a lineup that's no longer editable.
      qc.invalidateQueries({ queryKey: ['player-market'] });
      Alert.alert('Challenge sent!', `Waiting for ${user?.display_name ?? user?.username ?? 'them'} to respond.`);
    },
    onError: (err: Error) => Alert.alert('Could not send challenge', err.message),
  });

  const cancelSentChallenge = useMutation({
    mutationFn: async () => {
      if (!myPendingChallenge?.id) return;
      await cancelFriendChallenge(myPendingChallenge.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-pending-challenge'] });
      qc.invalidateQueries({ queryKey: ['my-building-lineup'] });
      // Cancelling frees the lineup back to 'building' server-side — same
      // reasoning as above, in reverse.
      qc.invalidateQueries({ queryKey: ['player-market'] });
    },
    onError: (err: Error) => Alert.alert('Could not cancel challenge', err.message),
  });

  if (isLoading || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  const rankTint = RANK_TINT[user.rank_tier ?? 'Bronze'] ?? theme.muted;
  const totalGames = (user.total_wins ?? 0) + (user.total_losses ?? 0);
  const winRate = totalGames > 0 ? Math.round(((user.total_wins ?? 0) / totalGames) * 100) : 0;
  const isOwnProfile = user.id === profile?.id;
  const isFriend = friendStatus?.status === 'accepted';
  const isPending = friendStatus?.status === 'pending';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Hero */}
        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, alignItems: 'center', gap: 10 }}>
          <MonogramTile
            initials={(user.display_name ?? user.username ?? '??').slice(0, 2).toUpperCase()}
            size={88}
            showJersey={false}
          />
          <Text style={{ fontFamily: FONT.serif, fontSize: 32, color: theme.ink, letterSpacing: -0.5, textAlign: 'center' }}>
            {user.display_name ?? user.username}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted, letterSpacing: 0.6 }}>
            @{user.username}
          </Text>
          <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: rankTint + '66' }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: rankTint, letterSpacing: 0.8 }}>
              {user.rank_tier ?? 'Bronze'}
            </Text>
          </View>
        </View>

        {/* Stats strip */}
        <View style={{ marginHorizontal: 18, padding: 18, backgroundColor: theme.surface, borderRadius: 16, borderColor: theme.hairline, borderWidth: 1, flexDirection: 'row', marginBottom: 16 }}>
          <StatCol theme={theme} label="Wins" value={String(user.total_wins ?? 0)} accent />
          <StatCol theme={theme} label="Losses" value={String(user.total_losses ?? 0)} />
          <StatCol theme={theme} label="Win %" value={`${winRate}%`} />
          <StatCol theme={theme} label="Earnings" value={fmtPrice(user.total_earnings)} accent />
        </View>

        {/* CTAs (not own profile) */}
        {!isOwnProfile && (
          <View style={{ marginHorizontal: 18, marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {isFriend ? (
                myPendingChallenge ? (
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Cancel challenge?',
                        `Your $${myPendingChallenge.entry_tier} challenge is still waiting on a response.`,
                        [
                          { text: 'Keep waiting', style: 'cancel' },
                          { text: 'Cancel challenge', style: 'destructive', onPress: () => cancelSentChallenge.mutate() },
                        ],
                      )
                    }
                    disabled={cancelSentChallenge.isPending}
                    style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                      {cancelSentChallenge.isPending ? 'Cancelling…' : `Challenge sent · $${myPendingChallenge.entry_tier}`}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => setChallengeModalOpen(true)}
                    style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: theme.onAccent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                      Challenge
                    </Text>
                  </Pressable>
                )
              ) : (
                <Pressable
                  onPress={() => !isPending && sendRequest.mutate()}
                  disabled={isPending || sendRequest.isPending}
                  style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: 'transparent', borderWidth: 1, borderColor: isPending ? theme.hairline : theme.accentEdge, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: isPending ? theme.muted : theme.accent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    {isPending ? 'Requested' : 'Add Friend'}
                  </Text>
                </Pressable>
              )}
            </View>
            {/* Challenges are friends-only (mirrors create_friend_challenge's
               server-side check) — nudge non-friends toward the real prerequisite
               instead of showing a button that would just fail server-side. */}
            {!isFriend && (
              <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted, marginTop: 8, textAlign: 'center' }}>
                Become friends to send a challenge.
              </Text>
            )}
          </View>
        )}

        {/* Achievements */}
        {(achievements?.length ?? 0) > 0 && (
          <View style={{ paddingHorizontal: 18 }}>
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: theme.ink, marginBottom: 12 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: theme.muted }}>Recent</Text> achievements
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(achievements ?? []).map((ua: any) => {
                const ach = Array.isArray(ua.achievement) ? ua.achievement[0] : ua.achievement;
                const rarityTint = ach?.rarity === 'legendary' ? '#F5A524' : ach?.rarity === 'epic' ? '#A855F7' : ach?.rarity === 'rare' ? theme.accent : theme.muted;
                return (
                  <View
                    key={ua.id}
                    style={{ width: '30.5%', padding: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: rarityTint + '44', alignItems: 'center', gap: 4 }}
                  >
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: rarityTint, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                      {ach?.rarity ?? 'common'}
                    </Text>
                    <Text numberOfLines={2} style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: theme.ink, textAlign: 'center' }}>
                      {ach?.name ?? '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      <ChallengeModal
        theme={theme}
        visible={challengeModalOpen}
        onClose={() => setChallengeModalOpen(false)}
        opponentName={user.display_name ?? user.username}
        myLineup={myLineup}
        wager={wager}
        setWager={setWager}
        onSend={() => sendChallenge.mutate()}
        sending={sendChallenge.isPending}
        onBuildLineup={() => { setChallengeModalOpen(false); router.push('/(tabs)/lineup' as any); }}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// SEND-CHALLENGE MODAL
// =============================================================================
function ChallengeModal({
  theme, visible, onClose, opponentName, myLineup, wager, setWager, onSend, sending, onBuildLineup,
}: {
  theme: Theme;
  visible: boolean; onClose: () => void; opponentName: string;
  myLineup: { id: string; total_cap_used: number; lineup_players: Array<{ slot_number: number; nba_players: { full_name: string } }> } | null | undefined;
  wager: string; setWager: (v: string) => void; onSend: () => void; sending: boolean; onBuildLineup: () => void;
}) {
  const picked = (myLineup?.lineup_players ?? []).slice().sort((a, b) => a.slot_number - b.slot_number);
  const hasFullLineup = picked.length === LINEUP_SIZE;
  const wagerNum = Number(wager);
  const validWager = wager.length > 0 && Number.isFinite(wagerNum) && wagerNum >= MIN_WAGER;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32 }}>
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <View style={{ width: 40, height: 5, borderRadius: 999, backgroundColor: theme.hairline2 }} />
          </View>
          <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: theme.ink, marginBottom: 4 }}>
            Challenge <Text style={{ fontFamily: FONT.serifItalic, color: theme.accent }}>{opponentName}</Text>
          </Text>

          {!hasFullLineup ? (
            <View style={{ marginTop: 16, gap: 14 }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.muted, lineHeight: 21 }}>
                You need a complete 3-player lineup to send a challenge. Build one in the Draft Market, then come back here.
              </Text>
              <Pressable
                onPress={onBuildLineup}
                style={{ height: 48, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  Open Draft Market
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: 12, gap: 16 }}>
              {/* Lineup summary */}
              <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 14 }}>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
                  Your lineup
                </Text>
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.ink, lineHeight: 20 }}>
                  {picked.map((p) => playerLastName(p.nba_players)).join(' · ')}
                </Text>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, marginTop: 6 }}>
                  {fmtPrice(myLineup!.total_cap_used)} / {fmtPrice(SALARY_CAP)} cap
                </Text>
              </View>

              {/* Wager */}
              <View>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
                  Stake (both sides match this exactly)
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline, paddingHorizontal: 14, height: 48 }}>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 18, color: theme.muted, marginRight: 4 }}>$</Text>
                  <TextInput
                    value={wager}
                    onChangeText={setWager}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    maxLength={6}
                    style={{ flex: 1, fontFamily: FONT.monoBold, fontSize: 18, color: theme.ink, padding: 0 }}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  {CHALLENGE_QUICK_WAGERS.map((v) => {
                    const active = wagerNum === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setWager(String(v))}
                        style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.accentSoft : 'transparent', borderWidth: 1, borderColor: active ? theme.accentEdge : theme.hairline }}
                      >
                        <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: active ? theme.accent : theme.muted }}>${v}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Pressable
                onPress={onSend}
                disabled={!validWager || sending}
                style={{ height: 50, borderRadius: 999, backgroundColor: validWager ? theme.accent : theme.surface, borderWidth: validWager ? 0 : 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center', opacity: sending ? 0.6 : 1 }}
              >
                {sending ? (
                  <ActivityIndicator color={theme.onAccent} />
                ) : (
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: validWager ? theme.onAccent : theme.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    Send Challenge
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StatCol({ theme, label, value, accent }: { theme: Theme; label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 15, color: accent ? theme.accent : theme.ink, letterSpacing: -0.2 }}>{value}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}
