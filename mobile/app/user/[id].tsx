// =============================================================================
// BETTHAT — Public User Profile (Holy Grail V2, Screen 10b)
// Shows any user's record, rank, earnings, recent achievements.
// Challenge CTA → matchup create. Send friend request inline.
// =============================================================================

import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice } from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

const RANK_TINT: Record<string, string> = {
  Bronze: '#CD7F32', Silver: '#9E9E9E', Gold: '#F5A524',
  Platinum: '#5B9BD5', Diamond: '#A855F7',
};

export default function UserProfileScreen() {
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

  if (isLoading || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  const rankTint = RANK_TINT[user.rank_tier ?? 'Bronze'] ?? HG.muted;
  const totalGames = (user.total_wins ?? 0) + (user.total_losses ?? 0);
  const winRate = totalGames > 0 ? Math.round(((user.total_wins ?? 0) / totalGames) * 100) : 0;
  const isOwnProfile = user.id === profile?.id;
  const isFriend = friendStatus?.status === 'accepted';
  const isPending = friendStatus?.status === 'pending';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
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
          <Text style={{ fontFamily: FONT.serif, fontSize: 32, color: HG.ink, letterSpacing: -0.5, textAlign: 'center' }}>
            {user.display_name ?? user.username}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.muted, letterSpacing: 0.6 }}>
            @{user.username}
          </Text>
          <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: rankTint + '66' }}>
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: rankTint, letterSpacing: 0.8 }}>
              {user.rank_tier ?? 'Bronze'}
            </Text>
          </View>
        </View>

        {/* Stats strip */}
        <View style={{ marginHorizontal: 18, padding: 18, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, flexDirection: 'row', marginBottom: 16 }}>
          <StatCol label="Wins" value={String(user.total_wins ?? 0)} accent />
          <StatCol label="Losses" value={String(user.total_losses ?? 0)} />
          <StatCol label="Win %" value={`${winRate}%`} />
          <StatCol label="Earnings" value={fmtPrice(user.total_earnings)} accent />
        </View>

        {/* CTAs (not own profile) */}
        {!isOwnProfile && (
          <View style={{ marginHorizontal: 18, flexDirection: 'row', gap: 10, marginBottom: 24 }}>
            <Pressable
              onPress={() => router.push('/matchup/create' as any)}
              style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.jet, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Challenge
              </Text>
            </Pressable>
            {!isFriend && (
              <Pressable
                onPress={() => !isPending && sendRequest.mutate()}
                disabled={isPending || sendRequest.isPending}
                style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: 'transparent', borderWidth: 1, borderColor: isFriend || isPending ? HG.hairline : HG.skyEdge, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: isPending ? HG.muted : HG.sky, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  {isPending ? 'Requested' : 'Add Friend'}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Achievements */}
        {(achievements?.length ?? 0) > 0 && (
          <View style={{ paddingHorizontal: 18 }}>
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, marginBottom: 12 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Recent</Text> achievements
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(achievements ?? []).map((ua: any) => {
                const ach = Array.isArray(ua.achievement) ? ua.achievement[0] : ua.achievement;
                const rarityTint = ach?.rarity === 'legendary' ? '#F5A524' : ach?.rarity === 'epic' ? '#A855F7' : ach?.rarity === 'rare' ? HG.sky : HG.muted;
                return (
                  <View
                    key={ua.id}
                    style={{ width: '30.5%', padding: 12, backgroundColor: HG.surface, borderRadius: 12, borderWidth: 1, borderColor: rarityTint + '44', alignItems: 'center', gap: 4 }}
                  >
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: rarityTint, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                      {ach?.rarity ?? 'common'}
                    </Text>
                    <Text numberOfLines={2} style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: HG.ink, textAlign: 'center' }}>
                      {ach?.name ?? '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCol({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 15, color: accent ? HG.sky : HG.ink, letterSpacing: -0.2 }}>{value}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

