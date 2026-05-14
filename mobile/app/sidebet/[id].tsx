import { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';

type SidebetDetail = {
  id: string;
  creator_id: string;
  acceptor_id: string | null;
  player_id: string;
  game_id: string;
  prop_type: string;
  prop_line: number;
  creator_side: 'over' | 'under';
  wager_amount: number;
  rake_amount: number;
  status: 'open' | 'matched' | 'live' | 'completed' | 'cancelled' | 'expired';
  result: 'creator_win' | 'acceptor_win' | 'push' | null;
  is_friend_bet: boolean;
  targeted_user_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  creator: { username: string; display_name: string | null; rank_tier: string } | null;
  acceptor: { username: string; display_name: string | null; rank_tier: string } | null;
  player: { full_name: string; team_abbreviation: string; position: string } | null;
};

const PROP_LABELS: Record<string, string> = {
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists',
  steals: 'Steals', blocks: 'Blocks', three_pointers: '3-Pointers',
  pts_reb_ast: 'Pts+Reb+Ast', double_double: 'Double-Double', triple_double: 'Triple-Double',
};

export default function SidebetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, wallet, setWallet } = useAuthStore();

  const { data: sidebet, isLoading } = useQuery({
    queryKey: ['sidebet', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sidebets')
        .select(`
          *,
          creator:profiles!sidebets_creator_id_fkey(username, display_name, rank_tier),
          acceptor:profiles!sidebets_acceptor_id_fkey(username, display_name, rank_tier),
          player:nba_players(full_name, team_abbreviation, position)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as SidebetDetail;
    },
  });

  // Subscribe to realtime updates for live sidebets
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`sidebet:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sidebets', filter: `id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ['sidebet', id] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const acceptSidebet = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !sidebet) throw new Error('Not ready');

      const { data: w } = await supabase.from('wallets').select('balance, escrow_balance').eq('user_id', profile.id).single();
      if (Number(w?.balance ?? 0) < sidebet.wager_amount) throw new Error('Insufficient balance');

      // Accept sidebet
      const { error } = await supabase.from('sidebets').update({
        acceptor_id: profile.id,
        status: 'matched',
      }).eq('id', sidebet.id).eq('status', 'open');
      if (error) throw error;

      // Escrow wager
      const newBal = Number(w!.balance) - sidebet.wager_amount;
      const newEsc = Number(w!.escrow_balance) + sidebet.wager_amount;
      await supabase.from('wallets').update({ balance: newBal, escrow_balance: newEsc }).eq('user_id', profile.id);
      await supabase.from('transactions').insert({
        user_id: profile.id, type: 'escrow_hold',
        amount: -sidebet.wager_amount, balance_after: newBal,
        description: `Accepted sidebet ${sidebet.id}`, status: 'completed',
        reference_id: sidebet.id,
      });

      setWallet({ ...w, balance: newBal, escrow_balance: newEsc } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sidebet', id] });
      Alert.alert('🤝 Accepted!', 'The sidebet is now live!');
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  if (isLoading || !sidebet) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0a0a] items-center justify-center">
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  const creator = sidebet.creator;
  const acceptor = sidebet.acceptor;
  const player = Array.isArray(sidebet.player) ? sidebet.player[0] : sidebet.player;
  const isMine = sidebet.creator_id === profile?.id;
  const canAccept = !isMine && sidebet.status === 'open';
  const isCompleted = sidebet.status === 'completed';
  const iWon = isCompleted && (
    (sidebet.result === 'creator_win' && sidebet.creator_id === profile?.id) ||
    (sidebet.result === 'acceptor_win' && sidebet.acceptor_id === profile?.id)
  );

  const totalPot = sidebet.wager_amount * 2;
  const payout = totalPot * (1 - 0.05); // 5% rake

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-base flex-1">Sidebet Detail</Text>
        <View
          className="px-2.5 py-1 rounded-full"
          style={{
            backgroundColor:
              sidebet.status === 'open' ? '#1a1200' :
              sidebet.status === 'matched' ? '#052e16' :
              '#1a1a1a',
          }}
        >
          <Text
            className="text-xs font-bold uppercase"
            style={{
              color:
                sidebet.status === 'open' ? '#F59E0B' :
                sidebet.status === 'matched' ? '#22C55E' :
                '#71717A',
            }}
          >
            {sidebet.status}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Result banner */}
        {isCompleted && (
          <View
            className="mx-5 mb-4 rounded-xl py-3 items-center"
            style={{ backgroundColor: iWon ? '#052e16' : '#1c0505' }}
          >
            <Text className="font-black text-lg" style={{ color: iWon ? '#22C55E' : '#EF4444' }}>
              {iWon ? `YOU WON ${formatCurrency(payout)} 🏆` : `YOU LOST ${formatCurrency(sidebet.wager_amount)} 💔`}
            </Text>
          </View>
        )}

        {/* Player + Prop Card */}
        <View className="mx-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-4">
          <Text className="text-[#71717A] text-xs uppercase tracking-wider mb-3">The Bet</Text>
          <View className="flex-row items-center mb-4">
            <View className="w-14 h-14 rounded-full bg-[#1E1E1E] items-center justify-center mr-4">
              <Text className="text-2xl">🏀</Text>
            </View>
            <View className="flex-1">
              <Text className="text-white font-black text-lg">{player?.full_name ?? '—'}</Text>
              <Text className="text-[#71717A] text-sm">{player?.position} · {player?.team_abbreviation}</Text>
            </View>
          </View>

          <View className="bg-[#0a0a0a] rounded-xl p-4">
            <Text className="text-[#71717A] text-xs mb-1">{PROP_LABELS[sidebet.prop_type] ?? sidebet.prop_type}</Text>
            <View className="flex-row items-baseline gap-2">
              <Text className="text-[#F59E0B] text-4xl font-black">{sidebet.prop_line}</Text>
              <Text className="text-white text-xl font-bold">{sidebet.creator_side === 'over' ? 'OVER' : 'UNDER'}</Text>
            </View>
          </View>
        </View>

        {/* Wager info */}
        <View className="mx-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-4">
          <Row label="Wager" value={formatCurrency(sidebet.wager_amount)} valueColor="#F59E0B" />
          <Row label="Total Pot" value={formatCurrency(totalPot)} />
          <Row label="Payout (after 5% rake)" value={formatCurrency(payout)} valueColor="#22C55E" />
        </View>

        {/* Players */}
        <View className="mx-5 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-6">
          <Text className="text-[#71717A] text-xs uppercase tracking-wider mb-3">Players</Text>
          <View className="flex-row items-center mb-3">
            <View className="w-9 h-9 rounded-full bg-[#1E1E1E] items-center justify-center mr-3">
              <Text className="font-bold text-sm text-white">{creator?.display_name?.[0] ?? '?'}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold">{creator?.display_name ?? creator?.username}</Text>
              <Text className="text-[#71717A] text-xs">Created bet · {sidebet.creator_side?.toUpperCase()}</Text>
            </View>
            {sidebet.result === 'creator_win' && <Text className="text-[#22C55E]">WON ✅</Text>}
          </View>

          {acceptor ? (
            <View className="flex-row items-center">
              <View className="w-9 h-9 rounded-full bg-[#1E1E1E] items-center justify-center mr-3">
                <Text className="font-bold text-sm text-white">{acceptor?.display_name?.[0] ?? '?'}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-bold">{acceptor?.display_name ?? acceptor?.username}</Text>
                <Text className="text-[#71717A] text-xs">Accepted bet · {sidebet.creator_side === 'over' ? 'UNDER' : 'OVER'}</Text>
              </View>
              {sidebet.result === 'acceptor_win' && <Text className="text-[#22C55E]">WON ✅</Text>}
            </View>
          ) : (
            <View className="flex-row items-center opacity-40">
              <View className="w-9 h-9 rounded-full border-2 border-dashed border-[#4B5563] items-center justify-center mr-3">
                <Text className="text-[#4B5563] text-xl">?</Text>
              </View>
              <Text className="text-[#4B5563]">Waiting for opponent...</Text>
            </View>
          )}
        </View>

        {/* Accept CTA */}
        {canAccept && (
          <View className="mx-5">
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Accept Sidebet?',
                  `Wager ${formatCurrency(sidebet.wager_amount)} that ${player?.full_name} goes ${sidebet.creator_side === 'over' ? 'UNDER' : 'OVER'} ${sidebet.prop_line} ${PROP_LABELS[sidebet.prop_type] ?? sidebet.prop_type}.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: `Accept — ${formatCurrency(sidebet.wager_amount)}`, onPress: () => acceptSidebet.mutate() },
                  ]
                );
              }}
              disabled={acceptSidebet.isPending}
              className="bg-[#F59E0B] rounded-xl py-4 items-center"
            >
              {acceptSidebet.isPending ? (
                <ActivityIndicator color="black" />
              ) : (
                <Text className="text-black font-black text-base">
                  ACCEPT BET — {formatCurrency(sidebet.wager_amount)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2.5 border-b border-[#1E1E1E] last:border-b-0">
      <Text className="text-[#71717A] text-sm">{label}</Text>
      <Text className="font-bold" style={{ color: valueColor ?? '#FFFFFF' }}>{value}</Text>
    </View>
  );
}
