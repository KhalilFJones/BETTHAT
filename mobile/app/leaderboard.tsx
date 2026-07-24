// =============================================================================
// BETTHAT — Leaderboard (Holy Grail V2)
// Weekly / Monthly / All-Time tabs. Top 3 medals. My-rank sticky strip.
// =============================================================================

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import type { LeaderboardEntry } from '@/lib/database.types';

type Period = 'weekly' | 'monthly' | 'all_time';

// Schema columns: score (decimal, total winnings), calculated_at (timestamp).
type LeaderboardRow = LeaderboardEntry & {
  user: {
    id: string;
    username: string;
    display_name: string | null;
    rank_tier: string | null;
    avatar_url: string | null;
  } | null;
};

const PERIOD_LABELS: Record<Period, string> = {
  weekly: 'This Week', monthly: 'This Month', all_time: 'All Time',
};

const MEDAL = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuthStore();
  const [period, setPeriod] = useState<Period>('weekly');

  const { data: entries, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leaderboard_entries')
        .select(`
          *,
          user:profiles(id, username, display_name, rank_tier, avatar_url)
        `)
        .eq('period_type', period)
        .order('rank', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
    staleTime: 60_000,
  });

  const myEntry = entries?.find((e) => e.user?.id === profile?.id);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: theme.ink, marginLeft: 12 }}>
          Leaderboard
        </Text>
      </View>

      {/* Period tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: 18, backgroundColor: theme.surface, borderRadius: 12, padding: 4, marginTop: 8, marginBottom: 14, borderWidth: 1, borderColor: theme.hairline }}>
        {(['weekly', 'monthly', 'all_time'] as Period[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center', backgroundColor: period === p ? theme.accent : 'transparent' }}
          >
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, letterSpacing: 0.8, color: period === p ? theme.onAccent : theme.muted, textTransform: 'uppercase' }}>
              {PERIOD_LABELS[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* My rank strip */}
      {myEntry && (
        <View style={{ marginHorizontal: 18, marginBottom: 14, backgroundColor: theme.accentWash, borderWidth: 1, borderColor: theme.accentEdge, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 22, color: theme.accent, marginRight: 12 }}>#{myEntry.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }}>Your Rank</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, marginTop: 2 }}>
              {myEntry.wins}W · {fmtPrice(myEntry.score)} earned
            </Text>
          </View>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: theme.accent }}>{fmtPrice(myEntry.score)}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 80 }}>
        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : (entries?.length ?? 0) === 0 ? (
          <View style={{ paddingTop: 60, alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>No rankings yet</Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', paddingHorizontal: 24 }}>
              {PERIOD_LABELS[period]}'s leaderboard hasn't been calculated yet. Check back soon.
            </Text>
          </View>
        ) : (
          entries?.map((entry) => {
            const user = entry.user;
            const isMe = user?.id === profile?.id;
            const pos = entry.rank;
            const initials = (user?.display_name ?? user?.username ?? '??').slice(0, 2).toUpperCase();
            return (
              <View
                key={entry.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, borderWidth: 1,
                  backgroundColor: isMe ? theme.accentWash : theme.surface,
                  borderColor: isMe ? theme.accentEdge : theme.hairline,
                }}
              >
                <View style={{ width: 32, alignItems: 'center', marginRight: 10 }}>
                  {pos <= 3 ? (
                    <Text style={{ fontSize: 18 }}>{MEDAL[pos - 1]}</Text>
                  ) : (
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: theme.muted }}>#{pos}</Text>
                  )}
                </View>
                <MonogramTile initials={initials} size={36} showJersey={false} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }}>
                    {user?.display_name ?? user?.username}{isMe ? ' (You)' : ''}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, marginTop: 2 }}>
                    {entry.wins}W {entry.losses}L
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 14, color: theme.accent }}>{fmtPrice(entry.score)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
