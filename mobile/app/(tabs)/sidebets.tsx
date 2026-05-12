import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency, propSideLabel } from '@/lib/utils';
import type { OpenSidebet, Sidebet } from '@/lib/database.types';

type Tab = 'market' | 'my_bets';

const PROP_LABELS: Record<string, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST',
  steals: 'STL', blocks: 'BLK', fantasy_points: 'FP',
};

export default function SidebetsScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [tab, setTab] = useState<Tab>('market');

  const { data: openBets, isLoading: marketLoading, refetch: refetchMarket } = useQuery({
    queryKey: ['open_sidebets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mv_open_sidebets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as OpenSidebet[];
    },
    refetchInterval: 30_000,
  });

  const { data: myBets, isLoading: myLoading, refetch: refetchMy } = useQuery({
    queryKey: ['my_sidebets', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('sidebets')
        .select('*')
        .or(`creator_id.eq.${profile.id},acceptor_id.eq.${profile.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Sidebet[];
    },
    enabled: !!profile?.id,
  });

  const isLoading = tab === 'market' ? marketLoading : myLoading;

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-4">
        <Text className="text-white text-2xl font-black">Sidebets</Text>
        <TouchableOpacity
          onPress={() => router.push('/sidebet/create')}
          className="bg-[#F59E0B] px-4 py-2 rounded-xl"
        >
          <Text className="text-black font-bold text-sm">+ CREATE</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View className="flex-row px-5 mb-4 gap-2">
        {(['market', 'my_bets'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            className="flex-1 py-2 rounded-xl items-center border"
            style={{
              backgroundColor: tab === t ? '#F59E0B' : 'transparent',
              borderColor: tab === t ? '#F59E0B' : '#2E2E2E',
            }}
          >
            <Text
              className="text-xs font-bold"
              style={{ color: tab === t ? '#000' : '#71717A' }}
            >
              {t === 'market' ? 'MARKET' : 'MY BETS'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={tab === 'market' ? refetchMarket : refetchMy}
            tintColor="#F59E0B"
          />
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 80 }}
      >
        {isLoading ? (
          <ActivityIndicator color="#F59E0B" className="mt-10" />
        ) : tab === 'market' ? (
          (openBets?.length ?? 0) === 0 ? (
            <EmptyMarket onCreate={() => router.push('/sidebet/create')} />
          ) : (
            openBets?.map((bet) => (
              <OpenSidebetCard
                key={bet.id}
                bet={bet}
                myId={profile?.id ?? ''}
                onAccept={(id) => router.push(`/sidebet/${id}`)}
              />
            ))
          )
        ) : (
          (myBets?.length ?? 0) === 0 ? (
            <EmptyMyBets onCreate={() => router.push('/sidebet/create')} />
          ) : (
            myBets?.map((bet) => (
              <MySidebetCard
                key={bet.id}
                bet={bet}
                myId={profile?.id ?? ''}
                onPress={(id) => router.push(`/sidebet/${id}`)}
              />
            ))
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function OpenSidebetCard({
  bet, myId, onAccept,
}: { bet: OpenSidebet; myId: string; onAccept: (id: string) => void }) {
  const isOwn = bet.creator_id === myId;
  const { label: sideLabel, color: sideColor } = propSideLabel(bet.creator_side);
  const oppSide = bet.creator_side === 'over' ? 'under' : 'over';
  const { label: oppLabel, color: oppColor } = propSideLabel(oppSide);

  return (
    <TouchableOpacity
      onPress={() => onAccept(bet.id)}
      className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-4 mb-3"
    >
      {/* Player + prop */}
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-1">
          <Text className="text-white font-black text-base">{bet.player_name}</Text>
          <Text className="text-[#71717A] text-xs">{bet.team_abbr}</Text>
        </View>
        <View className="items-end">
          <Text className="text-[#F59E0B] font-black text-lg">
            {formatCurrency(bet.wager_amount)}
          </Text>
          <Text className="text-[#71717A] text-xs">to win {formatCurrency(bet.wager_amount * 2 * 0.95)}</Text>
        </View>
      </View>

      {/* Prop line */}
      <View className="bg-[#1E1E1E] rounded-xl p-3 mb-3">
        <Text className="text-[#71717A] text-xs text-center mb-1">
          {PROP_LABELS[bet.prop_type] ?? bet.prop_type} Line
        </Text>
        <Text className="text-white text-2xl font-black text-center">{bet.prop_line}</Text>
      </View>

      {/* Sides */}
      <View className="flex-row gap-3">
        <View
          className="flex-1 rounded-xl py-2.5 items-center border"
          style={{ borderColor: sideColor, backgroundColor: `${sideColor}15` }}
        >
          <Text className="text-xs font-bold" style={{ color: sideColor }}>
            {sideLabel} (taken)
          </Text>
          <Text className="text-[#71717A] text-xs">{bet.creator_username}</Text>
        </View>

        {!isOwn && (
          <TouchableOpacity
            onPress={() => onAccept(bet.id)}
            className="flex-1 rounded-xl py-2.5 items-center"
            style={{ backgroundColor: oppColor }}
          >
            <Text className="text-black text-xs font-black">{oppLabel} — TAKE IT</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

function MySidebetCard({
  bet, myId, onPress,
}: { bet: Sidebet; myId: string; onPress: (id: string) => void }) {
  const isCreator = bet.creator_id === myId;
  const mySide = isCreator ? bet.creator_side : (bet.creator_side === 'over' ? 'under' : 'over');
  const { label, color } = propSideLabel(mySide);
  const isWon = bet.result === (isCreator ? 'creator_win' : 'acceptor_win');
  const isLost = bet.result === (isCreator ? 'acceptor_win' : 'creator_win');

  return (
    <TouchableOpacity
      onPress={() => onPress(bet.id)}
      className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <View className="px-2 py-0.5 rounded" style={{ backgroundColor: `${color}20` }}>
              <Text className="text-xs font-bold" style={{ color }}>{label} {bet.prop_line}</Text>
            </View>
            <Text className="text-[#71717A] text-xs uppercase tracking-wide">{bet.status}</Text>
          </View>
          <Text className="text-white font-bold">{bet.prop_type} · {formatCurrency(bet.wager_amount)}</Text>
        </View>

        {bet.result && (
          <View
            className="px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: isWon ? '#052e16' : isLost ? '#1c0505' : '#141414' }}
          >
            <Text
              className="font-black text-sm"
              style={{ color: isWon ? '#22C55E' : isLost ? '#EF4444' : '#71717A' }}
            >
              {isWon ? 'WON' : isLost ? 'LOST' : 'PUSH'}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function EmptyMarket({ onCreate }: { onCreate: () => void }) {
  return (
    <View className="items-center mt-16">
      <Text className="text-4xl mb-3">💰</Text>
      <Text className="text-white font-black text-lg mb-2">No open sidebets</Text>
      <Text className="text-[#71717A] text-center mb-6">
        Be the first to create a sidebet on a player prop.
      </Text>
      <TouchableOpacity onPress={onCreate} className="bg-[#F59E0B] px-8 py-3 rounded-xl">
        <Text className="text-black font-black">CREATE SIDEBET</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyMyBets({ onCreate }: { onCreate: () => void }) {
  return (
    <View className="items-center mt-16">
      <Text className="text-4xl mb-3">🎯</Text>
      <Text className="text-white font-black text-lg mb-2">No sidebets yet</Text>
      <Text className="text-[#71717A] text-center mb-6">
        Create a bet or accept one from the market.
      </Text>
      <TouchableOpacity onPress={onCreate} className="bg-[#F59E0B] px-8 py-3 rounded-xl">
        <Text className="text-black font-black">CREATE SIDEBET</Text>
      </TouchableOpacity>
    </View>
  );
}
