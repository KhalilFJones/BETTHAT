// =============================================================================
// BETTHAT — Notifications (Holy Grail V2, Screen 12)
// =============================================================================

import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtRelative } from '@/lib/holygrail';
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
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m15 18-6-6 6-6" />
            </Svg>
          </Pressable>
          <Text style={{ fontFamily: FONT.serif, fontSize: 28, color: HG.ink, letterSpacing: -0.4 }}>
            Notifications
            {unreadCount > 0 ? (
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 16, color: HG.sky }}> {unreadCount}</Text>
            ) : null}
          </Text>
        </View>
        {unreadCount > 0 && (
          <Pressable onPress={() => markAllRead.mutate()} hitSlop={10}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.sky, letterSpacing: 0.6 }}>
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={HG.sky} />
        </View>
      ) : (notifications?.length ?? 0) === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink }}>
            All <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>caught up</Text>
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.muted }}>No notifications yet.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { if (!item.is_read) markRead.mutate(item.id); }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderColor: HG.hairline,
                opacity: pressed ? 0.7 : item.is_read ? 0.55 : 1,
                gap: 12,
              })}
            >
              {/* Unread dot */}
              <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: item.is_read ? 'transparent' : HG.sky, marginTop: 6, flexShrink: 0 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink, lineHeight: 20 }}>
                  {item.title}
                </Text>
                {item.body ? (
                  <Text numberOfLines={2} style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, marginTop: 3, lineHeight: 18 }}>
                    {item.body}
                  </Text>
                ) : null}
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, marginTop: 5, letterSpacing: 0.4 }}>
                  {fmtRelative(item.created_at)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

