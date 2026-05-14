import { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import type { UserNotification } from '@/lib/database.types';

const NOTIF_ICONS: Record<string, string> = {
  matchup_result: '🏆',
  sidebet_result: '💰',
  friend_request: '👥',
  friend_accept: '✅',
  lineup_lock: '⏰',
  deposit_confirmed: '💳',
  withdrawal_processed: '💸',
  achievement_unlocked: '🎖️',
  rank_up: '🚀',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuthStore();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as UserNotification[];
    },
    enabled: !!profile?.id,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', profile!.id)
        .eq('is_read', false);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-3">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Text className="text-[#F59E0B] text-sm">← Back</Text>
          </TouchableOpacity>
          <Text className="text-white font-black text-xl">
            Notifications
            {unreadCount > 0 && (
              <Text className="text-[#F59E0B]"> ({unreadCount})</Text>
            )}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => markAllRead.mutate()}>
            <Text className="text-[#F59E0B] text-sm">Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#F59E0B" className="mt-20" />
      ) : (notifications?.length ?? 0) === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-4xl mb-3">🔔</Text>
          <Text className="text-white font-bold text-base">All caught up!</Text>
          <Text className="text-[#71717A] text-sm mt-1">No notifications yet.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => {
                if (!item.is_read) markRead.mutate(item.id);
              }}
              className="flex-row items-start py-4 border-b border-[#141414]"
              style={{ opacity: item.is_read ? 0.6 : 1 }}
            >
              <View
                className="w-10 h-10 rounded-full bg-[#1E1E1E] items-center justify-center mr-3 mt-0.5"
              >
                <Text className="text-xl">
                  {NOTIF_ICONS[item.type] ?? '🔔'}
                </Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-white font-bold text-sm flex-1">{item.title}</Text>
                  {!item.is_read && (
                    <View className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                  )}
                </View>
                {item.body && (
                  <Text className="text-[#71717A] text-xs mt-0.5" numberOfLines={2}>
                    {item.body}
                  </Text>
                )}
                <Text className="text-[#4B5563] text-xs mt-1">
                  {new Date(item.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
