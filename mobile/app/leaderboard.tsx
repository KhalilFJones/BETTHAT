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
import { HG, FONT, fmtPrice } from '@/lib/holygrail';
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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, marginLeft: 12 }}>
          Leaderboard
        </Text>
      </View>

      {/* Period tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: 18, backgroundColor: HG.surface, borderRadius: 12, padding: 4, marginTop: 8, marginBottom: 14, borderWidth: 1, borderColor: HG.hairline }}>
        {(['weekly', 'monthly', 'all_time'] as Period[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center', backgroundColor: period === p ? HG.sky : 'transparent' }}
          >
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, letterSpacing: 0.8, color: period === p ? HG.jet : HG.muted, textTransform: 'uppercase' }}>
              {PERIOD_LABELS[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* My rank strip */}
      {myEntry && (
        <View style={{ marginHorizontal: 18, marginBottom: 14, backgroundColor: HG.skyEdge + '22', borderWidth: 1, borderColor: HG.sky + '44', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 22, color: HG.sky, marginRight: 12 }}>#{myEntry.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>Your Rank</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, marginTop: 2 }}>
              {myEntry.wins}W · {fmtPrice(myEntry.score)} earned
            </Text>
          </View>
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 15, color: HG.sky }}>{fmtPrice(myEntry.score)}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 80 }}>
        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
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
                  backgroundColor: isMe ? HG.sky + '18' : HG.surface,
                  borderColor: isMe ? HG.sky + '55' : HG.hairline,
                }}
              >
                <View style={{ width: 32, alignItems: 'center', marginRight: 10 }}>
                  {pos <= 3 ? (
                    <Text style={{ fontSize: 18 }}>{MEDAL[pos - 1]}</Text>
                  ) : (
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.muted }}>#{pos}</Text>
                  )}
                </View>
                <MonogramTile initials={initials} size={36} showJersey={false} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink }}>
                    {user?.display_name ?? user?.username}{isMe ? ' (You)' : ''}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, marginTop: 2 }}>
                    {entry.wins}W {entry.losses}L
                  </Text>
                </View>
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 14, color: HG.sky }}>{fmtPrice(entry.score)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
