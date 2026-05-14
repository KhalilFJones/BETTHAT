import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';
import type { Transaction } from '@/lib/database.types';

type Tab = 'overview' | 'history';

export default function WalletScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, wallet, setWallet } = useAuthStore();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: transactions, isLoading: txLoading, refetch } = useQuery({
    queryKey: ['transactions', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Transaction[];
    },
    enabled: !!profile?.id,
  });

  const TX_ICONS: Record<string, string> = {
    deposit: '⬇️', withdrawal: '⬆️', entry_fee: '🎯',
    payout: '🏆', rake: '📊', escrow_hold: '🔒',
    escrow_release: '🔓', refund: '↩️',
    sidebet_wager: '💰', sidebet_payout: '💵',
  };

  const TX_COLORS: Record<string, string> = {
    deposit: '#22C55E', withdrawal: '#EF4444', payout: '#22C55E',
    sidebet_payout: '#22C55E', refund: '#22C55E',
    entry_fee: '#EF4444', rake: '#71717A', sidebet_wager: '#EF4444',
    escrow_hold: '#71717A', escrow_release: '#71717A',
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">Wallet</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={txLoading} onRefresh={refetch} tintColor="#F59E0B" />
        }
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* ── Balance Card ── */}
        <View className="mx-5 mt-4 bg-[#141414] border border-[#2E2E2E] rounded-2xl p-6 mb-5">
          <Text className="text-[#71717A] text-xs tracking-wider uppercase mb-2">Available Balance</Text>
          <Text className="text-white text-4xl font-black mb-1">
            {formatCurrency(wallet?.balance ?? 0)}
          </Text>
          {(wallet?.escrow_balance ?? 0) > 0 && (
            <Text className="text-[#71717A] text-sm">
              + {formatCurrency(wallet!.escrow_balance)} in escrow (active matchups)
            </Text>
          )}
          <View className="flex-row gap-3 mt-5">
            <TouchableOpacity
              onPress={() => router.push('/wallet/deposit')}
              className="flex-1 bg-[#F59E0B] rounded-xl py-3.5 items-center"
            >
              <Text className="text-black font-black">DEPOSIT</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/wallet/withdraw')}
              className="flex-1 border border-[#2E2E2E] rounded-xl py-3.5 items-center"
              style={{ opacity: (wallet?.balance ?? 0) > 0 ? 1 : 0.4 }}
            >
              <Text className="text-white font-bold">WITHDRAW</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Lifetime Stats ── */}
        <View className="mx-5 flex-row gap-3 mb-6">
          <View className="flex-1 bg-[#141414] border border-[#2E2E2E] rounded-xl p-4">
            <Text className="text-[#71717A] text-xs">Total Deposited</Text>
            <Text className="text-white font-black text-base mt-1">
              {formatCurrency(wallet?.total_deposited ?? 0)}
            </Text>
          </View>
          <View className="flex-1 bg-[#141414] border border-[#2E2E2E] rounded-xl p-4">
            <Text className="text-[#71717A] text-xs">Total Withdrawn</Text>
            <Text className="text-white font-black text-base mt-1">
              {formatCurrency(wallet?.total_withdrawn ?? 0)}
            </Text>
          </View>
        </View>

        {/* ── Transaction History ── */}
        <View className="px-5">
          <Text className="text-white font-black text-lg mb-3">Transaction History</Text>
          {txLoading ? (
            <ActivityIndicator color="#F59E0B" />
          ) : (transactions?.length ?? 0) === 0 ? (
            <View className="items-center py-10">
              <Text className="text-[#71717A]">No transactions yet.</Text>
            </View>
          ) : (
            transactions?.map((tx) => (
              <View
                key={tx.id}
                className="flex-row items-center py-3.5 border-b border-[#141414]"
              >
                <Text className="text-2xl mr-3">{TX_ICONS[tx.type] ?? '💸'}</Text>
                <View className="flex-1">
                  <Text className="text-white font-medium capitalize">
                    {tx.type.replace(/_/g, ' ')}
                  </Text>
                  {tx.description && (
                    <Text className="text-[#71717A] text-xs mt-0.5">{tx.description}</Text>
                  )}
                  <Text className="text-[#4B5563] text-xs mt-0.5">
                    {new Date(tx.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </Text>
                </View>
                <View className="items-end">
                  <Text
                    className="font-black text-base"
                    style={{ color: TX_COLORS[tx.type] ?? '#71717A' }}
                  >
                    {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
                  </Text>
                  <Text className="text-[#4B5563] text-xs">
                    bal: {formatCurrency(tx.balance_after)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
