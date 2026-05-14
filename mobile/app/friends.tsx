import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import type { FriendRequest } from '@/lib/database.types';

type Tab = 'friends' | 'requests' | 'search';

export default function FriendsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuthStore();
  const [tab, setTab] = useState<Tab>('friends');
  const [searchQuery, setSearchQuery] = useState('');

  // Friends list
  const { data: friends, isLoading: friendsLoading, refetch: refetchFriends } = useQuery({
    queryKey: ['friends', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('friends')
        .select('*, friend:profiles!friends_addressee_id_fkey(id, username, display_name, rank_tier, total_wins, total_losses)')
        .eq('requester_id', profile.id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  // Pending requests received
  const { data: requests, isLoading: reqLoading, refetch: refetchRequests } = useQuery({
    queryKey: ['friend_requests', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('friends')
        .select('*, requester:profiles!friends_requester_id_fkey(id, username, display_name, rank_tier)')
        .eq('addressee_id', profile.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!profile?.id,
  });

  // User search
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
        .insert({ requester_id: profile!.id, addressee_id: friendId, status: 'pending' });
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

  const RANK_COLORS: Record<string, string> = {
    Bronze: '#CD7F32', Silver: '#C0C0C0', Gold: '#FFD700',
    Platinum: '#E5E4E2', Diamond: '#B9F2FF', Elite: '#F59E0B',
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">Friends</Text>
      </View>

      {/* Tabs */}
      <View className="flex-row mx-5 bg-[#141414] rounded-xl p-1 mt-3 mb-4">
        {(['friends', 'requests', 'search'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            className={`flex-1 py-2 rounded-lg items-center ${tab === t ? 'bg-[#F59E0B]' : ''}`}
            onPress={() => setTab(t)}
          >
            <Text className={`text-sm font-bold capitalize ${tab === t ? 'text-black' : 'text-[#71717A]'}`}>
              {t}{t === 'requests' && (requests?.length ?? 0) > 0 ? ` (${requests?.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>

        {tab === 'search' && (
          <>
            <TextInput
              className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 text-white mb-4"
              placeholder="Search by username..."
              placeholderTextColor="#4B5563"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator color="#F59E0B" />}
            {searchResults?.map((user: any) => (
              <UserRow
                key={user.id}
                user={user}
                rankColor={RANK_COLORS[user.rank_tier]}
                action={
                  <TouchableOpacity
                    onPress={() => sendRequest.mutate(user.id)}
                    disabled={sendRequest.isPending}
                    className="bg-[#F59E0B] px-3 py-1.5 rounded-lg"
                  >
                    <Text className="text-black text-xs font-bold">Add</Text>
                  </TouchableOpacity>
                }
              />
            ))}
          </>
        )}

        {tab === 'friends' && (
          <>
            {friendsLoading ? (
              <ActivityIndicator color="#F59E0B" className="mt-10" />
            ) : (friends?.length ?? 0) === 0 ? (
              <View className="items-center py-16">
                <Text className="text-4xl mb-3">👥</Text>
                <Text className="text-white font-bold text-base mb-1">No Friends Yet</Text>
                <Text className="text-[#71717A] text-sm text-center">
                  Use the Search tab to find players to challenge!
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
                        className="border border-[#2E2E2E] px-3 py-1.5 rounded-lg"
                      >
                        <Text className="text-white text-xs">View</Text>
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
                <Text className="text-4xl mb-3">📨</Text>
                <Text className="text-[#71717A]">No pending requests.</Text>
              </View>
            ) : (
              requests?.map((req: any) => {
                const requester = req.requester;
                return (
                  <View
                    key={req.id}
                    className="flex-row items-center bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 mb-3"
                  >
                    <View className="w-10 h-10 rounded-full bg-[#1E1E1E] items-center justify-center mr-3">
                      <Text className="text-base">{requester.display_name?.[0] ?? '?'}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-bold">{requester.display_name ?? requester.username}</Text>
                      <Text className="text-[#71717A] text-xs">@{requester.username}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => respondRequest.mutate({ requestId: req.id, accept: false })}
                      className="border border-[#EF4444] px-3 py-1.5 rounded-lg mr-2"
                    >
                      <Text className="text-[#EF4444] text-xs font-bold">Ignore</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => respondRequest.mutate({ requestId: req.id, accept: true })}
                      className="bg-[#F59E0B] px-3 py-1.5 rounded-lg"
                    >
                      <Text className="text-black text-xs font-bold">Accept</Text>
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
    <View className="flex-row items-center bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 mb-3">
      <View
        className="w-10 h-10 rounded-full bg-[#1E1E1E] border items-center justify-center mr-3"
        style={{ borderColor: rankColor ?? '#2E2E2E' }}
      >
        <Text className="text-base">{user.display_name?.[0]?.toUpperCase() ?? user.username?.[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-white font-bold">{user.display_name ?? user.username}</Text>
        <Text className="text-[#71717A] text-xs">
          @{user.username} · {user.total_wins ?? 0}W {user.total_losses ?? 0}L
        </Text>
      </View>
      {action}
    </View>
  );
}
