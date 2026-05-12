import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { useLineupStore } from '@/stores/lineup.store';
import { formatCurrency } from '@/lib/utils';
import type { Matchup } from '@/lib/database.types';

/**
 * Matchup create / matchmaking queue screen.
 * Reached after submitting a lineup from the lineup builder.
 * - Creates a lineup record in DB
 * - Creates / joins a matchup
 * - Polls until an opponent is matched
 * - Escrows the entry fee
 */
export default function MatchupCreateScreen() {
  const router = useRouter();
  const { tier } = useLocalSearchParams<{ tier: string }>();
  const { profile, wallet, setWallet } = useAuthStore();
  const { slots, tier: entryTier, reset: resetLineup } = useLineupStore();
  const [phase, setPhase] = useState<'submitting' | 'waiting' | 'matched' | 'error'>('submitting');
  const [matchupId, setMatchupId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const entryFee = Number((tier ?? entryTier ?? '$5').replace('$', ''));

  const submitLineup = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error('Not authenticated');

      // 1. Check wallet balance
      const { data: walletData } = await supabase
        .from('wallets')
        .select('balance, escrow_balance')
        .eq('user_id', profile.id)
        .single();

      if (!walletData || Number(walletData.balance) < entryFee) {
        throw new Error('Insufficient balance. Please deposit funds.');
      }

      // 2. Create lineup
      const salaryCap = { 1: 45, 5: 75, 10: 105, 20: 135, 50: 180 }[entryFee] ?? 75;
      const totalSalary = slots.filter((s) => s.playerId !== null).reduce((sum, s) => sum + s.price, 0);
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: lineup, error: lineupErr } = await supabase
        .from('lineups')
        .insert({
          user_id: profile.id,
          entry_tier: `$${entryFee}` as any,
          salary_cap: salaryCap,
          total_salary: totalSalary,
          status: 'submitted',
        })
        .select('id')
        .single();
      if (lineupErr) throw lineupErr;

      // 3. Insert lineup_players
      const playerRows = slots
        .filter((s) => s.playerId !== null)
        .map((s) => ({
          lineup_id: lineup.id,
          player_id: s.playerId!,
          slot_position: s.position,
          price_at_selection: s.price,
        }));
      const { error: playersErr } = await supabase.from('lineup_players').insert(playerRows);
      if (playersErr) throw playersErr;

      // 4. Escrow entry fee
      const newBalance = Number(walletData.balance) - entryFee;
      const newEscrow = Number(walletData.escrow_balance) + entryFee;
      await supabase.from('wallets').update({ balance: newBalance, escrow_balance: newEscrow })
        .eq('user_id', profile.id);

      // 5. Look for an open matchup to join, or create one
      const { data: openMatchup } = await supabase
        .from('matchups')
        .select('id, creator_id')
        .eq('entry_tier', `$${entryFee}` as '$1' | '$5' | '$10' | '$20' | '$50')
        .eq('status', 'pending')
        .neq('creator_id', profile.id)
        .is('opponent_id', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      let finalMatchupId: string;

      if (openMatchup) {
        // Join existing matchup
        const pot = entryFee * 2;
        const { data: joined, error: joinErr } = await supabase
          .from('matchups')
          .update({
            opponent_id: profile.id,
            pot,
            rake_amount: pot * 0.035,
            status: 'matched',
          })
          .eq('id', openMatchup.id)
          .select('id')
          .single();
        if (joinErr) throw joinErr;
        finalMatchupId = joined!.id;

        // Link lineup to this matchup
        await supabase.from('lineups').update({ matchup_id: finalMatchupId }).eq('id', lineup.id);

        // Log entry fee transaction for both
        await supabase.from('transactions').insert({
          user_id: profile.id, type: 'escrow_hold',
          amount: -entryFee, balance_after: newBalance,
          description: `Joined $${entryFee} matchup`, status: 'completed',
          reference_id: finalMatchupId,
        });
      } else {
        // Create new matchup — wait for opponent
        const { data: created, error: createErr } = await supabase
          .from('matchups')
          .insert({
            creator_id: profile.id,
            entry_tier: `$${entryFee}` as any,
            entry_fee: entryFee,
            pot: 0,
            rake_amount: 0,
            game_date: todayStr,
            status: 'pending',
          })
          .select('id')
          .single();
        if (createErr) throw createErr;
        finalMatchupId = created!.id;

        // Link lineup to this matchup
        await supabase.from('lineups').update({ matchup_id: finalMatchupId }).eq('id', lineup.id);

        await supabase.from('transactions').insert({
          user_id: profile.id, type: 'escrow_hold',
          amount: -entryFee, balance_after: newBalance,
          description: `Created $${entryFee} matchup`, status: 'completed',
          reference_id: finalMatchupId,
        });
      }

      setWallet({ ...walletData, balance: newBalance, escrow_balance: newEscrow } as any);
      return { matchupId: finalMatchupId, joined: !!openMatchup };
    },
    onSuccess: ({ matchupId, joined }) => {
      setMatchupId(matchupId);
      resetLineup();
      if (joined) {
        setPhase('matched');
      } else {
        setPhase('waiting');
      }
    },
    onError: (err: any) => {
      setErrorMsg(err.message ?? 'Something went wrong.');
      setPhase('error');
    },
  });

  // Auto-submit on mount
  useEffect(() => {
    submitLineup.mutate();
  }, []);

  // Poll for opponent while waiting
  const { data: matchup } = useQuery({
    queryKey: ['matchup_status', matchupId],
    queryFn: async () => {
      const { data } = await supabase
        .from('matchups')
        .select('status, opponent_id')
        .eq('id', matchupId!)
        .single();
      return data;
    },
    enabled: !!matchupId && phase === 'waiting',
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (matchup?.status === 'matched' && matchup.opponent_id) {
      setPhase('matched');
    }
  }, [matchup]);

  const handleCancel = async () => {
    if (!matchupId || !profile?.id) return;
    Alert.alert(
      'Cancel Matchup?',
      'Your entry fee will be refunded.',
      [
        { text: 'Keep Waiting', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('matchups').update({ status: 'cancelled' }).eq('id', matchupId);
            // Refund escrow
            const { data: w } = await supabase.from('wallets').select('balance, escrow_balance').eq('user_id', profile.id).single();
            const newBal = Number(w!.balance) + entryFee;
            const newEsc = Math.max(0, Number(w!.escrow_balance) - entryFee);
            await supabase.from('wallets').update({ balance: newBal, escrow_balance: newEsc }).eq('user_id', profile.id);
            setWallet({ ...w, balance: newBal, escrow_balance: newEsc } as any);
            router.replace('/(tabs)/home');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a] items-center justify-center px-8">

      {phase === 'submitting' && (
        <View className="items-center">
          <ActivityIndicator size="large" color="#F59E0B" className="mb-6" />
          <Text className="text-white text-xl font-black mb-2">Submitting Lineup</Text>
          <Text className="text-[#71717A] text-center">Locking your picks and securing escrow...</Text>
        </View>
      )}

      {phase === 'waiting' && (
        <View className="items-center w-full">
          {/* Pulsing ring animation via opacity cycling */}
          <View className="w-28 h-28 rounded-full border-4 border-[#F59E0B] items-center justify-center mb-6">
            <ActivityIndicator size="large" color="#F59E0B" />
          </View>
          <Text className="text-white text-2xl font-black mb-2">Finding Opponent</Text>
          <Text className="text-[#71717A] text-center mb-8">
            Your {formatCurrency(entryFee)} lineup is locked in.{'\n'}Matching you with a worthy competitor...
          </Text>

          <View className="w-full bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-8">
            <View className="flex-row justify-between mb-3">
              <Text className="text-[#71717A] text-sm">Entry Tier</Text>
              <Text className="text-[#F59E0B] font-bold">{formatCurrency(entryFee)}</Text>
            </View>
            <View className="flex-row justify-between mb-3">
              <Text className="text-[#71717A] text-sm">Potential Payout</Text>
              <Text className="text-[#22C55E] font-bold">{formatCurrency(entryFee * 2 * 0.965)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-[#71717A] text-sm">Status</Text>
              <View className="flex-row items-center gap-1.5">
                <View className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                <Text className="text-[#F59E0B] font-bold text-sm">In Queue</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            onPress={handleCancel}
            className="border border-[#2E2E2E] rounded-xl py-3 px-8"
          >
            <Text className="text-[#71717A] font-medium">Cancel & Refund</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'matched' && (
        <View className="items-center w-full">
          <Text className="text-5xl mb-4">🔥</Text>
          <Text className="text-white text-2xl font-black mb-2">Opponent Found!</Text>
          <Text className="text-[#71717A] text-center mb-8">
            Your matchup is live. May the best lineup win!
          </Text>
          <TouchableOpacity
            onPress={() => router.replace(`/matchup/${matchupId}`)}
            className="bg-[#F59E0B] w-full rounded-xl py-4 items-center mb-3"
          >
            <Text className="text-black font-black text-base">VIEW MATCHUP</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/home')}
            className="py-3 items-center"
          >
            <Text className="text-[#71717A]">Back to Home</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'error' && (
        <View className="items-center w-full">
          <Text className="text-5xl mb-4">❌</Text>
          <Text className="text-white text-xl font-black mb-2">Something Went Wrong</Text>
          <Text className="text-[#EF4444] text-center mb-8">{errorMsg}</Text>
          <TouchableOpacity
            onPress={() => router.back()}
            className="border border-[#2E2E2E] rounded-xl py-3 px-8"
          >
            <Text className="text-white">Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

    </SafeAreaView>
  );
}
