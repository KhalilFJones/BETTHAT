import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { RANK_COLORS } from '@/lib/utils';

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
      const { data } = await supabase
        .from('friends')
        .select('*, friend:profiles!friends_recipient_id_fkey(id, username, display_name, rank_tier, total_wins, total_losses)')
        .eq('requester_id', profile.id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });
      return data ?? [];
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

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-brand text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-text-primary font-bold text-xl">Friends</Text>
      </View>

      <View className="flex-row mx-5 bg-surface rounded-xl p-1 mt-3 mb-4">
        {(['friends', 'requests', 'search'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            className="flex-1 py-2 rounded-lg items-center"
            style={{ backgroundColor: tab === t ? '#F5A524' : 'transparent' }}
            onPress={() => setTab(t)}
          >
            <Text
              className="text-sm font-bold capitalize"
              style={{ color: tab === t ? '#0A0A0C' : '#71717A' }}
            >
              {t}{t === 'requests' && (requests?.length ?? 0) > 0 ? ` (${requests?.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>

        {tab === 'search' && (
          <>
            <TextInput
              className="bg-surface border border-surface-border rounded-xl px-4 py-3 text-text-primary mb-4 font-sans"
              placeholder="Search by username..."
              placeholderTextColor="#71717A"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator color="#F5A524" />}
            {searchResults?.map((user: any) => (
              <UserRow
                key={user.id}
                user={user}
                rankColor={RANK_COLORS[user.rank_tier]}
                action={
                  <TouchableOpacity
                    onPress={() => sendRequest.mutate(user.id)}
                    disabled={sendRequest.isPending}
                    className="bg-brand px-3 py-1.5 rounded-lg"
                  >
                    <Text className="text-bg text-xs font-bold">Add</Text>
                  </TouchableOpacity>
                }
              />
            ))}
          </>
        )}

        {tab === 'friends' && (
          <>
            {friendsLoading ? (
              <ActivityIndicator color="#F5A524" className="mt-10" />
            ) : (friends?.length ?? 0) === 0 ? (
              <View className="items-center py-16">
                <Text className="text-text-primary font-bold text-base mb-1">No Friends Yet</Text>
                <Text className="text-text-muted text-sm text-center font-sans">
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
                    rankColor={RANK_COLORS[friend.rank_tier]}
                    action={
                      <TouchableOpacity
                        onPress={() => router.push(`/user/${friend.id}`)}
                        className="border border-surface-border px-3 py-1.5 rounded-lg"
                      >
                        <Text className="text-text-primary text-xs">View</Text>
                      </TouchableOpacity>
                    }
                  />
                );
              })
            )}
          </>
        )}

        {tab === 'requests' && (
          <>
            {(requests?.length ?? 0) === 0 ? (
              <View className="items-center py-16">
                <Text className="text-text-muted font-sans">No pending requests.</Text>
              </View>
            ) : (
              requests?.map((req: any) => {
                const requester = req.requester;
                return (
                  <View
                    key={req.id}
                    className="flex-row items-center bg-surface border border-surface-border rounded-xl px-4 py-3 mb-3"
                  >
                    <View className="w-10 h-10 rounded-full bg-surface-raised items-center justify-center mr-3">
                      <Text className="text-text-primary text-base">{requester.display_name?.[0] ?? '?'}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-text-primary font-bold">{requester.display_name ?? requester.username}</Text>
                      <Text className="text-text-muted text-xs font-sans">@{requester.username}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => respondRequest.mutate({ requestId: req.id, accept: false })}
                      className="border border-loss px-3 py-1.5 rounded-lg mr-2"
                    >
                      <Text className="text-loss text-xs font-bold">Ignore</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => respondRequest.mutate({ requestId: req.id, accept: true })}
                      className="bg-brand px-3 py-1.5 rounded-lg"
                    >
                      <Text className="text-bg text-xs font-bold">Accept</Text>
                    </TouchableOpacity>
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

function UserRow({ user, rankColor, action }: {
  user: { username: string; display_name?: string; rank_tier?: string; total_wins?: number; total_losses?: number };
  rankColor?: string;
  action: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center bg-surface border border-surface-border rounded-xl px-4 py-3 mb-3">
      <View
        className="w-10 h-10 rounded-full bg-surface-raised border items-center justify-center mr-3"
        style={{ borderColor: rankColor ?? '#2A2A2E' }}
      >
        <Text className="text-text-primary text-base">
          {user.display_name?.[0]?.toUpperCase() ?? user.username?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
      <View className="flex-1">
        <Text className="text-text-primary font-bold">{user.display_name ?? user.username}</Text>
        <Text className="text-text-muted text-xs font-sans">
          @{user.username} · <Text className="font-mono">{user.total_wins ?? 0}W {user.total_losses ?? 0}L</Text>
        </Text>
      </View>
      {action}
    </View>
  );
}
