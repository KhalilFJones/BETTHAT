// =============================================================================
// BETTHAT — Connections (Following · Followers · Friends · Suggested)
//
// Follow model, matching TikTok/Instagram:
//   • Following — people you follow (they may or may not follow back)
//   • Followers — everyone who follows you. This INCLUDES people you don't
//     follow back AND people you do (your friends) — it is the full count.
//   • Friends   — the mutual subset: you follow each other
//   • Suggested — contacts from this phone whose number matches a BETTHAT
//     account, minus anyone you already follow
//
// Row action depends on the relationship, not the tab: Following → unfollow,
// follows-you-only → Follow back, mutual → Friends.
// =============================================================================

import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, Image,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { useFollowing, useFollowers, useFollowMutation } from '@/hooks/social/useSocialGraph';

const TABS = [
  { key: 'following', label: 'Following' },
  { key: 'followers', label: 'Followers' },
  { key: 'friends', label: 'Friends' },
  { key: 'suggested', label: 'Suggested' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface Person {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  total_wins: number | null;
  total_losses: number | null;
}

export default function ConnectionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuthStore();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : 'following',
  );
  const [search, setSearch] = useState('');

  const me = profile?.id;
  const { data: followingIds } = useFollowing(me);
  const { data: followerIds } = useFollowers(me);
  const followMutation = useFollowMutation(me);

  // One fetch of every profile in the graph, sliced per tab client-side —
  // these lists are small and it keeps tab switching instant.
  const graphIds = useMemo(() => {
    const s = new Set<string>();
    followingIds?.forEach((id) => s.add(id));
    followerIds?.forEach((id) => s.add(id));
    return Array.from(s);
  }, [followingIds, followerIds]);

  const { data: people, isLoading } = useQuery({
    queryKey: ['connection-profiles', graphIds.length, graphIds.join(',').slice(0, 200)],
    queryFn: async () => {
      if (graphIds.length === 0) return new Map<string, Person>();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, total_wins, total_losses')
        .in('id', graphIds);
      if (error) throw error;
      return new Map((data ?? []).map((p: any) => [p.id as string, p as Person]));
    },
    enabled: graphIds.length > 0,
  });

  const suggested = useSuggestedFromContacts(me, followingIds, tab === 'suggested');

  const rows = useMemo(() => {
    const get = (id: string) => people?.get(id);
    let ids: string[] = [];
    if (tab === 'following') ids = Array.from(followingIds ?? []);
    else if (tab === 'followers') ids = Array.from(followerIds ?? []);
    else if (tab === 'friends') {
      ids = Array.from(followingIds ?? []).filter((id) => followerIds?.has(id));
    }

    let list: Person[] =
      tab === 'suggested'
        ? (suggested.data ?? [])
        : ids.map(get).filter(Boolean) as Person[];

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          (p.display_name ?? '').toLowerCase().includes(q) ||
          p.username.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) =>
      (a.display_name || a.username).localeCompare(b.display_name || b.username),
    );
  }, [tab, people, followingIds, followerIds, suggested.data, search]);

  const counts = {
    following: followingIds?.size ?? 0,
    followers: followerIds?.size ?? 0,
    friends: Array.from(followingIds ?? []).filter((id) => followerIds?.has(id)).length,
    suggested: suggested.data?.length ?? 0,
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Go back">
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sansBold, fontSize: 20, color: theme.ink }}>
          {profile?.display_name || profile?.username || 'Connections'}
        </Text>
      </View>

      {/* Tabs with counts */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 20, paddingBottom: 10 }}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{ paddingBottom: 8, borderBottomWidth: 2, borderColor: active ? theme.ink : 'transparent' }}
            >
              <Text style={{ fontFamily: active ? FONT.sansBold : FONT.sans, fontSize: 15, color: active ? theme.ink : theme.muted }}>
                {item.label}{counts[item.key] > 0 ? ` ${counts[item.key]}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 12, gap: 8, backgroundColor: theme.surfaceSunken, borderRadius: 10 }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.muted2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
            <Path d="m21 21-4.3-4.3" />
          </Svg>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search users"
            placeholderTextColor={theme.muted2}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search connections"
            style={{ flex: 1, padding: 0, fontFamily: FONT.sans, fontSize: 15, color: theme.ink }}
          />
        </View>
      </View>

      {tab === 'suggested' && suggested.permission === 'denied' ? (
        <ContactsPrompt theme={theme} onRetry={suggested.request} />
      ) : isLoading || (tab === 'suggested' && suggested.isLoading) ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 4 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PersonRow
              theme={theme}
              person={item}
              iFollow={!!followingIds?.has(item.id)}
              followsMe={!!followerIds?.has(item.id)}
              busy={followMutation.isPending}
              onPress={() => router.push(`/user/${item.id}` as any)}
              onToggle={() => followMutation.mutate({ targetId: item.id, following: !!followingIds?.has(item.id) })}
            />
          )}
          ListEmptyComponent={
            <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.muted, textAlign: 'center', paddingVertical: 50 }}>
              {emptyCopy(tab, !!search)}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

function emptyCopy(tab: TabKey, searching: boolean): string {
  if (searching) return 'Nobody matches that search.';
  switch (tab) {
    case 'following': return "You're not following anyone yet.";
    case 'followers': return 'No followers yet.';
    case 'friends': return 'No friends yet — friends are people you follow who follow you back.';
    case 'suggested': return 'No contacts of yours are on BETTHAT yet.';
  }
}

function PersonRow({
  theme, person, iFollow, followsMe, busy, onPress, onToggle,
}: {
  theme: Theme; person: Person; iFollow: boolean; followsMe: boolean; busy: boolean;
  onPress: () => void; onToggle: () => void;
}) {
  const name = person.display_name || person.username;
  // The label reflects the relationship, not which tab you're on.
  const label = iFollow && followsMe ? 'Friends' : iFollow ? 'Following' : followsMe ? 'Follow back' : 'Follow';
  const filled = !iFollow; // "Follow"/"Follow back" are the calls to action

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`View ${name}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
    >
      {person.avatar_url ? (
        <Image source={{ uri: person.avatar_url }} style={{ width: 46, height: 46, borderRadius: 9999 }} />
      ) : (
        <View style={{ width: 46, height: 46, borderRadius: 9999, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>
            {name.slice(0, 2).toUpperCase()}
          </Text>
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>{name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted2 }}>
          @{person.username}
          {person.total_wins != null ? `  ·  ${person.total_wins}W ${person.total_losses ?? 0}L` : ''}
        </Text>
      </View>

      <Pressable
        onPress={(e) => { e.stopPropagation(); if (!busy) onToggle(); }}
        disabled={busy}
        accessibilityLabel={`${label} ${name}`}
        style={{
          height: 34, paddingHorizontal: 16, borderRadius: 100,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: filled ? theme.ink : theme.surfaceSunken,
          borderWidth: filled ? 0 : 1, borderColor: theme.hairline,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: filled ? theme.surface : theme.ink }}>
          {label}
        </Text>
      </Pressable>
    </Pressable>
  );
}

function ContactsPrompt({ theme, onRetry }: { theme: Theme; onRetry: () => void }) {
  return (
    <View style={{ padding: 30, gap: 14, alignItems: 'center' }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink, textAlign: 'center' }}>
        Contacts access is off
      </Text>
      <Text style={{ fontFamily: FONT.sans, fontSize: 14, lineHeight: 21, color: theme.muted, textAlign: 'center' }}>
        Suggestions come from matching your phone contacts against BETTHAT accounts.
        Nothing is uploaded — numbers are hashed and matched on your device.
      </Text>
      <Pressable onPress={onRetry} style={{ height: 44, paddingHorizontal: 22, borderRadius: 100, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.surface }}>Allow contacts</Text>
      </Pressable>
      <Pressable onPress={() => Linking.openSettings()}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.muted }}>Open Settings</Text>
      </Pressable>
    </View>
  );
}

// =============================================================================
// SUGGESTED — phone contacts matched against BETTHAT accounts
// =============================================================================

/** Last 10 digits, so +1 (305) 555-0199 and 3055550199 match. */
function normalisePhone(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function useSuggestedFromContacts(
  meId: string | undefined,
  followingIds: Set<string> | undefined,
  enabled: boolean,
) {
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const query = useQuery({
    queryKey: ['suggested-contacts', meId, followingIds?.size ?? 0],
    queryFn: async () => {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setPermission('denied');
        return [] as Person[];
      }
      setPermission('granted');

      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const numbers = new Set<string>();
      for (const c of data ?? []) {
        for (const p of c.phoneNumbers ?? []) {
          const n = normalisePhone(p.number ?? '');
          if (n) numbers.add(n);
        }
      }
      if (numbers.size === 0) return [] as Person[];

      // Only the last 10 digits ever leave the device, and only to match
      // against accounts that already chose to store a phone number.
      const { data: matches, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, total_wins, total_losses, phone_number')
        .not('phone_number', 'is', null)
        .limit(500);
      if (error) throw error;

      return ((matches ?? []) as any[])
        .filter((p) => {
          if (p.id === meId || followingIds?.has(p.id)) return false;
          const n = normalisePhone(p.phone_number ?? '');
          return !!n && numbers.has(n);
        })
        .map(({ phone_number, ...rest }) => rest as Person);
    },
    enabled: enabled && !!meId,
    staleTime: 5 * 60_000,
  });

  return {
    ...query,
    permission,
    request: async () => {
      const { status } = await Contacts.requestPermissionsAsync();
      setPermission(status === 'granted' ? 'granted' : 'denied');
      if (status === 'granted') query.refetch();
      else Alert.alert('Contacts permission needed', 'Enable Contacts for BETTHAT in Settings to see suggestions.');
    },
  };
}
