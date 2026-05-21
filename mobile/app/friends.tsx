// =============================================================================
// BETTHAT — Friends (Holy Grail V2)
// 3 tabs: Friends list / Pending requests / Search for players
// =============================================================================

import { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT } from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

type Tab = 'friends' | 'requests' | 'search';

export default function FriendsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuthStore();
  const [tab, setTab] = useState<Tab>('friends');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: friends, isLoading: friendsLoading } = useQuery({
    queryKey: ['friends', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      // Query both directions: friends I requested and friends who requested me.
      const [sentRes, receivedRes] = await Promise.all([
        supabase
          .from('friends')
          .select('*, friend:profiles!friends_recipient_id_fkey(id, username, display_name, rank_tier, total_wins, total_losses)')
          .eq('requester_id', profile.id)
          .eq('status', 'accepted')
          .order('created_at', { ascending: false }),
        supabase
          .from('friends')
          .select('*, friend:profiles!friends_requester_id_fkey(id, username, display_name, rank_tier, total_wins, total_losses)')
          .eq('recipient_id', profile.id)
          .eq('status', 'accepted')
          .order('created_at', { ascending: false }),
      ]);
      return [...(sentRes.data ?? []), ...(receivedRes.data ?? [])];
    },
    enabled: !!profile?.id,
  });

  const { data: requests } = useQuery({
    queryKey: ['friend_requests', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('friends')
        .select('*, requester:profiles!friends_requester_id_fkey(id, username, display_name, rank_tier)')
        .eq('recipient_id', profile.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['user_search', searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, rank_tier, total_wins, total_losses')
        .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
        .neq('id', profile?.id ?? '')
        .limit(20);
      return data ?? [];
    },
    enabled: searchQuery.length >= 2,
  });

  const sendRequest = useMutation({
    mutationFn: async (friendId: string) => {
      const { error } = await supabase
        .from('friends')
        .insert({ requester_id: profile!.id, recipient_id: friendId, status: 'pending' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['friends'] }),
    onError: () => Alert.alert('Error', 'Could not send friend request.'),
  });

  const respondRequest = useMutation({
    mutationFn: async ({ requestId, accept }: { requestId: string; accept: boolean }) => {
      const { error } = await supabase
        .from('friends')
        .update({ status: accept ? 'accepted' : 'declined' })
        .eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['friend_requests'] });
    },
    onError: () => Alert.alert('Error', 'Could not respond to request.'),
  });

  const reqCount = requests?.length ?? 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, marginLeft: 12 }}>Friends</Text>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: 18, backgroundColor: HG.surface, borderRadius: 12, padding: 4, marginTop: 8, marginBottom: 14, borderWidth: 1, borderColor: HG.hairline }}>
        {(['friends', 'requests', 'search'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center', backgroundColor: tab === t ? HG.sky : 'transparent' }}
          >
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, letterSpacing: 0.8, color: tab === t ? HG.jet : HG.muted, textTransform: 'capitalize' }}>
              {t}{t === 'requests' && reqCount > 0 ? ` (${reqCount})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 80 }}>

        {tab === 'search' && (
          <>
            <TextInput
              style={{ backgroundColor: HG.surface, borderWidth: 1, borderColor: HG.hairline, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FONT.sans, fontSize: 14, color: HG.ink, marginBottom: 14 }}
              placeholder="Search by username…"
              placeholderTextColor={HG.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator color={HG.sky} style={{ marginVertical: 16 }} />}
            {searchResults?.map((u: any) => (
              <UserRow
                key={u.id}
                user={u}
                action={
                  <Pressable
                    onPress={() => sendRequest.mutate(u.id)}
                    disabled={sendRequest.isPending}
                    style={{ backgroundColor: HG.sky, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}
                  >
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.jet, letterSpacing: 0.8 }}>Add</Text>
                  </Pressable>
                }
              />
            ))}
          </>
        )}

        {tab === 'friends' && (
          <>
            {friendsLoading ? (
              <ActivityIndicator color={HG.sky} style={{ marginTop: 40 }} />
            ) : (friends?.length ?? 0) === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: HG.ink, marginBottom: 6 }}>No Friends Yet</Text>
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, textAlign: 'center' }}>
                  Use the Search tab to find players to challenge.
                </Text>
              </View>
            ) : (
              friends?.map((f: any) => {
                const friend = f.friend;
                return (
                  <UserRow
                    key={f.id}
                    user={friend}
                    action={
                      <Pressable
                        onPress={() => router.push(`/user/${friend.id}` as any)}
                        style={{ borderWidth: 1, borderColor: HG.hairline, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}
                      >
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.ink2 }}>View</Text>
                      </Pressable>
                    }
                  />
                );
              })
            )}
          </>
        )}

        {tab === 'requests' && (
          <>
            {reqCount === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted }}>No pending requests.</Text>
              </View>
            ) : (
              requests?.map((req: any) => {
                const requester = req.requester;
                return (
                  <View key={req.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: HG.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, borderWidth: 1, borderColor: HG.hairline }}>
                    <MonogramTile
                      initials={(requester.display_name ?? requester.username ?? '??').slice(0, 2).toUpperCase()}
                      size={40}
                      showJersey={false}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>{requester.display_name ?? requester.username}</Text>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 2 }}>@{requester.username}</Text>
                    </View>
                    <Pressable
                      onPress={() => respondRequest.mutate({ requestId: req.id, accept: false })}
                      style={{ borderWidth: 1, borderColor: HG.down + '66', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 8 }}
                    >
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.down }}>Ignore</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => respondRequest.mutate({ requestId: req.id, accept: true })}
                      style={{ backgroundColor: HG.sky, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 }}
                    >
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.jet }}>Accept</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function UserRow({ user, action }: {
  user: { username: string; display_name?: string | null; rank_tier?: string | null; total_wins?: number; total_losses?: number };
  action: React.ReactNode;
}) {
  const initials = (user.display_name ?? user.username ?? '??').slice(0, 2).toUpperCase();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: HG.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, borderWidth: 1, borderColor: HG.hairline }}>
      <MonogramTile initials={initials} size={40} showJersey={false} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>{user.display_name ?? user.username}</Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 2 }}>
          @{user.username} · {user.total_wins ?? 0}W {user.total_losses ?? 0}L
        </Text>
      </View>
      {action}
    </View>
  );
}

