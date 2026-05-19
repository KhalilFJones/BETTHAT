import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { COLORS } from '@/lib/utils';
import type { UserNotification } from '@/lib/database.types';

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
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pt-4 pb-3">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Text className="text-brand text-sm">← Back</Text>
          </TouchableOpacity>
          <Text className="text-text-primary font-bold text-xl">
            Notifications
            {unreadCount > 0 && (
              <Text className="text-brand font-mono"> ({unreadCount})</Text>
            )}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => markAllRead.mutate()}>
            <Text className="text-brand text-sm">Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.brand} className="mt-20" />
      ) : (notifications?.length ?? 0) === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-primary font-bold text-base">All caught up</Text>
          <Text className="text-text-muted text-sm mt-1 font-sans">No notifications yet.</Text>
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
              className="flex-row items-start py-4 border-b border-surface-border"
              style={{ opacity: item.is_read ? 0.6 : 1 }}
            >
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-text-primary font-bold text-sm flex-1">{item.title}</Text>
                  {!item.is_read && (
                    <View className="w-2 h-2 rounded-full bg-brand" />
                  )}
                </View>
                {item.body && (
                  <Text className="text-text-muted text-xs mt-0.5 font-sans" numberOfLines={2}>
                    {item.body}
                  </Text>
                )}
                <Text className="text-text-muted text-xs mt-1 font-mono">
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
