// =============================================================================
// BETTHAT — Profile (Holy Grail V2, Screen 10)
// Header monogram, stats strip, friends row, prior matchups, wallet snapshot.
// =============================================================================

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice, fmtRelative, playerInitials } from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { SectionHead } from '@/components/holygrail/SectionHead';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, wallet, signOut } = useAuthStore();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');

  const editMutation = useMutation({
    mutationFn: async (displayName: string) => {
      if (!profile?.id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName.trim() })
        .eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile-detail', profile?.id] });
      setEditOpen(false);
    },
    onError: (err: any) => Alert.alert('Could not save', err?.message ?? 'Try again.'),
  });

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['profile-detail', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const [friendsQ, matchupsQ, txQ] = await Promise.all([
        supabase
          .from('friends')
          .select('id, status, requester_id, recipient_id, requester:profiles!requester_id(id, username, display_name, rank_tier), recipient:profiles!recipient_id(id, username, display_name, rank_tier)')
          .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
          .eq('status', 'accepted'),
        supabase
          .from('matchups')
          .select(`
            id, status, settled_wager, payout_amount,
            user1_id, user2_id, user1_score, user2_score, score_margin,
            winner_user_id, completed_at, created_at,
            u1:profiles!user1_id(id, username, display_name),
            u2:profiles!user2_id(id, username, display_name)
          `)
          .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(8),
        supabase
          .from('transactions')
          .select('id, type, amount, balance_after, description, created_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      return {
        friends: friendsQ.data ?? [],
        matchups: matchupsQ.data ?? [],
        transactions: txQ.data ?? [],
      };
    },
    enabled: !!profile?.id,
  });

  const wins = profile?.total_wins ?? 0;
  const losses = profile?.total_losses ?? 0;
  const recordLabel = `${wins}W–${losses}L`;

  // Compute biggest win from matchup history
  const completedMatchups = (data?.matchups ?? []).filter((m: any) => m.winner_user_id === profile?.id);
  const biggestWin = completedMatchups.reduce((max: number, m: any) => Math.max(max, Number(m.payout_amount ?? 0)), 0);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={HG.sky} />}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 22, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <MonogramTile
            initials={(profile?.display_name ?? profile?.username ?? '??').slice(0, 2).toUpperCase()}
            size={80}
            showJersey={false}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.serif, fontSize: 28, color: HG.ink, letterSpacing: -0.4, lineHeight: 32 }}>
              {profile?.display_name ?? profile?.username ?? '—'}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, marginTop: 4, letterSpacing: 0.6 }}>
              @{profile?.username} · {profile?.rank_tier ?? 'Bronze'}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, marginTop: 6, letterSpacing: 0.4 }}>
              Member since {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <Pressable
              onPress={() => { setEditName(profile?.display_name ?? profile?.username ?? ''); setEditOpen(true); }}
              hitSlop={10}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
              </Svg>
            </Pressable>
            <Pressable onPress={() => router.push('/settings' as any)} hitSlop={10}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </Svg>
            </Pressable>
          </View>
        </View>

        {/* Stats strip */}
        <View style={{ marginHorizontal: 18, padding: 18, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, flexDirection: 'row' }}>
          <StatCol label="Earnings" value={fmtPrice(profile?.total_earnings)} accent={Number(profile?.total_earnings ?? 0) > 0} />
          <StatCol label="Record" value={recordLabel} />
          <StatCol label="Best win" value={biggestWin > 0 ? fmtPrice(biggestWin) : '—'} accent={biggestWin > 0} />
        </View>

        {/* Friends */}
        <SectionHead word="Friends" label={String(data?.friends?.length ?? 0)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
          <Pressable
            onPress={() => router.push('/friends' as any)}
            style={{
              width: 64, height: 64, borderRadius: 16,
              backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.skyEdge, borderStyle: 'dashed',
              alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.sky} strokeWidth={1.8} strokeLinecap="round">
              <Path d="M12 5v14M5 12h14" />
            </Svg>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.sky, letterSpacing: 0.6 }}>ADD</Text>
          </Pressable>
          {(data?.friends ?? []).map((f: any) => {
            const friend = f.requester_id === profile?.id ? f.recipient : f.requester;
            return (
              <Pressable
                key={f.id}
                onPress={() => router.push(`/user/${friend.id}` as any)}
                style={{ alignItems: 'center', width: 70 }}
              >
                <MonogramTile
                  initials={(friend.display_name ?? friend.username ?? '??').slice(0, 2).toUpperCase()}
                  size={64}
                  showJersey={false}
                />
                <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 11, color: HG.muted, marginTop: 6, maxWidth: 64 }}>
                  {friend.display_name ?? friend.username}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Prior matchups */}
        <SectionHead word="Prior" emphasis="matchups" label={String(data?.matchups?.length ?? 0)} />
        <View style={{ paddingHorizontal: 18, gap: 8 }}>
          {(data?.matchups ?? []).map((m: any) => {
            const meIs1 = m.user1_id === profile?.id;
            const opp = meIs1 ? m.u2 : m.u1;
            const myScore = meIs1 ? m.user1_score : m.user2_score;
            const oppScore = meIs1 ? m.user2_score : m.user1_score;
            const won = m.winner_user_id === profile?.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => router.push(`/matchup/${m.id}` as any)}
                style={{ padding: 14, backgroundColor: HG.surface, borderRadius: 12, borderColor: HG.hairline, borderWidth: 1, flexDirection: 'row', alignItems: 'center' }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.4 }}>
                    vs {opp?.username ?? '—'} · {fmtRelative(m.completed_at)}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: HG.ink2, marginTop: 4 }}>
                    {Number(myScore ?? 0).toFixed(1)}  —  {Number(oppScore ?? 0).toFixed(1)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: won ? HG.sky : HG.muted, letterSpacing: 1 }}>
                    {won ? 'WIN' : 'LOSS'}
                  </Text>
                  {won && m.payout_amount ? (
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.sky, marginTop: 2 }}>
                      + {fmtPrice(m.payout_amount)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {!isLoading && (data?.matchups ?? []).length === 0 ? (
            <View style={{ padding: 24, backgroundColor: HG.surface, borderRadius: 12, borderColor: HG.hairline, borderWidth: 1 }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center' }}>
                No completed matchups yet.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Wallet snapshot */}
        <SectionHead word="Wallet" emphasis="snapshot" label="last 5" />
        <View style={{ paddingHorizontal: 18, gap: 6 }}>
          {(data?.transactions ?? []).map((t: any) => {
            const inflow = Number(t.amount) > 0;
            return (
              <View key={t.id} style={{ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: HG.hairline }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.ink }}>
                    {t.description ?? t.type}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, marginTop: 2, letterSpacing: 0.4 }}>
                    {fmtRelative(t.created_at)}
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: inflow ? HG.sky : HG.ink }}>
                  {inflow ? '+' : ''}{fmtPrice(t.amount)}
                </Text>
              </View>
            );
          })}
          <Pressable onPress={() => router.push('/wallet' as any)} style={{ paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              View all transactions
            </Text>
          </Pressable>
        </View>

        {/* Sign out */}
        <Pressable
          onPress={signOut}
          style={{ marginTop: 22, marginHorizontal: 18, padding: 14, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: HG.hairline }}
        >
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted2, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Sign out
          </Text>
        </Pressable>
      </ScrollView>

      {/* Edit display name modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: HG.surface, borderRadius: 20, borderWidth: 1, borderColor: HG.hairline, padding: 24, gap: 18 }}>
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, letterSpacing: -0.4 }}>
              Edit <Text style={{ fontFamily: FONT.serifItalic, color: HG.sky }}>display name</Text>
            </Text>
            <TextInput
              style={{ backgroundColor: HG.jet, borderWidth: 1, borderColor: HG.hairline, borderRadius: 12, paddingHorizontal: 14, height: 48, fontFamily: FONT.sans, fontSize: 15, color: HG.ink }}
              value={editName}
              onChangeText={setEditName}
              placeholder="Your display name"
              placeholderTextColor={HG.muted}
              autoFocus
              maxLength={32}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setEditOpen(false)}
                style={{ flex: 1, height: 46, borderRadius: 999, borderWidth: 1, borderColor: HG.hairline, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.2 }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { if (editName.trim()) editMutation.mutate(editName); }}
                disabled={editMutation.isPending || !editName.trim()}
                style={{ flex: 1, height: 46, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center', opacity: editName.trim() ? 1 : 0.4 }}
              >
                {editMutation.isPending ? (
                  <ActivityIndicator color={HG.jet} size="small" />
                ) : (
                  <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.jet, letterSpacing: 1.2 }}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatCol({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 22, color: accent ? HG.sky : HG.ink, marginTop: 6, letterSpacing: -0.3 }}>
        {value}
      </Text>
    </View>
  );
}
