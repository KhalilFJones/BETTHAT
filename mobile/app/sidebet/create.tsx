import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';

type PropType =
  | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks'
  | 'three_pointers' | 'pts_reb_ast' | 'double_double' | 'triple_double';

const PROP_OPTIONS: { key: PropType; label: string }[] = [
  { key: 'points', label: 'Points' },
  { key: 'rebounds', label: 'Rebounds' },
  { key: 'assists', label: 'Assists' },
  { key: 'steals', label: 'Steals' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'three_pointers', label: '3-Pointers' },
  { key: 'pts_reb_ast', label: 'PRA' },
  { key: 'double_double', label: 'DD' },
  { key: 'triple_double', label: 'TD' },
];

const WAGER_PRESETS = [1, 5, 10, 20, 50];

export default function SidebetCreateScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, wallet, setWallet } = useAuthStore();

  const [step, setStep] = useState<'player' | 'prop' | 'details'>('player');
  const [playerSearch, setPlayerSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null);
  const [selectedProp, setSelectedProp] = useState<PropType | null>(null);
  const [line, setLine] = useState('');
  const [side, setSide] = useState<'over' | 'under'>('over');
  const [wager, setWager] = useState<number>(5);

  // Player search
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['player_search_sidebet', playerSearch],
    queryFn: async () => {
      if (playerSearch.length < 2) return [];
      const { data } = await supabase
        .from('nba_players')
        .select('id, full_name, team_id, team_abbreviation, position')
        .ilike('full_name', `%${playerSearch}%`)
        .eq('is_active', true)
        .limit(20);
      return data ?? [];
    },
    enabled: playerSearch.length >= 2,
  });

  const createSidebet = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !selectedPlayer || !selectedProp || !line || !wager) {
        throw new Error('Please complete all fields.');
      }

      const lineNum = parseFloat(line);
      if (isNaN(lineNum) || lineNum <= 0) throw new Error('Enter a valid line.');

      const { data: w } = await supabase.from('wallets').select('balance, escrow_balance').eq('user_id', profile.id).single();
      if (Number(w?.balance ?? 0) < wager) throw new Error('Insufficient balance.');

      // Find the player's next upcoming game
      const today = new Date().toISOString().split('T')[0];
      const { data: games } = await supabase
        .from('nba_games')
        .select('id')
        .or(`home_team_id.eq.${selectedPlayer.team_id},away_team_id.eq.${selectedPlayer.team_id}`)
        .gte('game_date', today)
        .eq('status', 'scheduled')
        .order('game_date', { ascending: true })
        .limit(1);
      const game_id = games?.[0]?.id;
      if (!game_id) throw new Error('No upcoming game found for this player.');

      // Create sidebet
      const { data: sidebet, error } = await supabase.from('sidebets').insert({
        creator_id: profile.id,
        player_id: selectedPlayer.id,
        game_id,
        prop_type: selectedProp as 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'fantasy_points',
        prop_line: lineNum,
        creator_side: side,
        wager_amount: wager,
        status: 'open',
      }).select('id').single();
      if (error) throw error;

      // Escrow
      const newBal = Number(w!.balance) - wager;
      const newEsc = Number(w!.escrow_balance) + wager;
      await supabase.from('wallets').update({ balance: newBal, escrow_balance: newEsc }).eq('user_id', profile.id);
      await supabase.from('transactions').insert({
        user_id: profile.id, type: 'escrow_hold',
        amount: -wager, balance_after: newBal,
        description: `Created sidebet ${sidebet.id}`, status: 'completed',
        reference_id: sidebet.id,
      });

      setWallet({ ...w, balance: newBal, escrow_balance: newEsc } as any);
      return sidebet.id;
    },
    onSuccess: (sidebetId) => {
      queryClient.invalidateQueries({ queryKey: ['sidebets'] });
      Alert.alert('🎰 Sidebet Posted!', 'Your sidebet is live in the market.', [
        { text: 'View It', onPress: () => router.replace(`/sidebet/${sidebetId}`) },
        { text: 'Back to Sidebets', onPress: () => router.replace('/(tabs)/sidebets') },
      ]);
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* Nav */}
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => {
          if (step === 'player') router.back();
          else if (step === 'prop') setStep('player');
          else setStep('prop');
        }} className="mr-4">
          <Text className="text-[#F59E0B] text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white font-black text-xl">Create Sidebet</Text>
      </View>

      {/* Step indicator */}
      <View className="flex-row mx-5 mt-3 mb-5 gap-1.5">
        {['player', 'prop', 'details'].map((s, i) => (
          <View
            key={s}
            className="flex-1 h-1.5 rounded-full"
            style={{
              backgroundColor:
                step === s ? '#F59E0B' :
                ['player', 'prop', 'details'].indexOf(step) > i ? '#F59E0B55' : '#2E2E2E',
            }}
          />
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>

        {/* ── Step 1: Pick Player ── */}
        {step === 'player' && (
          <>
            <Text className="text-white font-black text-base mb-3">Pick a Player</Text>
            <TextInput
              className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 text-white mb-4"
              placeholder="Search player name..."
              placeholderTextColor="#4B5563"
              value={playerSearch}
              onChangeText={setPlayerSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator color="#F59E0B" />}
            {searchResults?.map((p: any) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => { setSelectedPlayer(p); setStep('prop'); }}
                className="flex-row items-center bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 mb-2"
              >
                <View className="w-10 h-10 rounded-full bg-[#1E1E1E] items-center justify-center mr-3">
                  <Text className="text-base">🏀</Text>
                </View>
                <View>
                  <Text className="text-white font-bold">{p.full_name}</Text>
                  <Text className="text-[#71717A] text-xs">{p.position} · {p.team_abbreviation}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {playerSearch.length >= 2 && !searchLoading && (searchResults?.length ?? 0) === 0 && (
              <Text className="text-[#71717A] text-center py-4">No players found</Text>
            )}
          </>
        )}

        {/* ── Step 2: Pick Prop ── */}
        {step === 'prop' && (
          <>
            <View className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 mb-5">
              <Text className="text-[#71717A] text-xs mb-1">Selected Player</Text>
              <Text className="text-white font-bold">{selectedPlayer?.full_name}</Text>
              <Text className="text-[#71717A] text-xs">{selectedPlayer?.position} · {selectedPlayer?.team_abbreviation}</Text>
            </View>
            <Text className="text-white font-black text-base mb-3">Pick a Prop Type</Text>
            <View className="flex-row flex-wrap gap-2 mb-6">
              {PROP_OPTIONS.map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setSelectedProp(key)}
                  className="px-4 py-2.5 rounded-xl border"
                  style={{
                    borderColor: selectedProp === key ? '#F59E0B' : '#2E2E2E',
                    backgroundColor: selectedProp === key ? '#1a1200' : '#141414',
                  }}
                >
                  <Text
                    className="font-bold text-sm"
                    style={{ color: selectedProp === key ? '#F59E0B' : '#71717A' }}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => { if (selectedProp) setStep('details'); }}
              disabled={!selectedProp}
              className="bg-[#F59E0B] rounded-xl py-4 items-center"
              style={{ opacity: selectedProp ? 1 : 0.4 }}
            >
              <Text className="text-black font-black">NEXT →</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 3: Set Line, Side, Wager ── */}
        {step === 'details' && (
          <>
            <View className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 mb-5">
              <Text className="text-white font-bold">{selectedPlayer?.full_name}</Text>
              <Text className="text-[#71717A] text-xs capitalize">
                {PROP_OPTIONS.find((p) => p.key === selectedProp)?.label ?? selectedProp}
              </Text>
            </View>

            {/* Line */}
            <Text className="text-white font-bold mb-2">Set the Line</Text>
            <TextInput
              className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-3 text-white text-center text-2xl font-black mb-5"
              placeholder="e.g. 25.5"
              placeholderTextColor="#4B5563"
              value={line}
              onChangeText={setLine}
              keyboardType="decimal-pad"
            />

            {/* Side */}
            <Text className="text-white font-bold mb-2">Your Side</Text>
            <View className="flex-row gap-3 mb-5">
              <TouchableOpacity
                onPress={() => setSide('over')}
                className="flex-1 py-3 rounded-xl border items-center"
                style={{ borderColor: side === 'over' ? '#22C55E' : '#2E2E2E', backgroundColor: side === 'over' ? '#052e16' : '#141414' }}
              >
                <Text className="font-black" style={{ color: side === 'over' ? '#22C55E' : '#71717A' }}>OVER</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSide('under')}
                className="flex-1 py-3 rounded-xl border items-center"
                style={{ borderColor: side === 'under' ? '#EF4444' : '#2E2E2E', backgroundColor: side === 'under' ? '#1c0505' : '#141414' }}
              >
                <Text className="font-black" style={{ color: side === 'under' ? '#EF4444' : '#71717A' }}>UNDER</Text>
              </TouchableOpacity>
            </View>

            {/* Wager */}
            <Text className="text-white font-bold mb-2">
              Wager Amount
              <Text className="text-[#71717A] font-normal text-xs"> (balance: {formatCurrency(wallet?.balance ?? 0)})</Text>
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-5">
              {WAGER_PRESETS.map((w) => (
                <TouchableOpacity
                  key={w}
                  onPress={() => setWager(w)}
                  disabled={(wallet?.balance ?? 0) < w}
                  className="px-5 py-2.5 rounded-xl border"
                  style={{
                    borderColor: wager === w ? '#F59E0B' : '#2E2E2E',
                    backgroundColor: wager === w ? '#1a1200' : '#141414',
                    opacity: (wallet?.balance ?? 0) < w ? 0.4 : 1,
                  }}
                >
                  <Text className="font-bold" style={{ color: wager === w ? '#F59E0B' : '#71717A' }}>
                    ${w}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Summary */}
            <View className="bg-[#141414] border border-[#2E2E2E] rounded-xl p-4 mb-6">
              <Text className="text-[#71717A] text-xs uppercase tracking-wider mb-3">Summary</Text>
              <Text className="text-white font-bold text-sm">
                {selectedPlayer?.full_name} {side.toUpperCase()} {line} {PROP_OPTIONS.find((p) => p.key === selectedProp)?.label}
              </Text>
              <Text className="text-[#71717A] text-xs mt-1">
                Wager: {formatCurrency(wager)} · Potential win: {formatCurrency(wager * 2 * 0.95)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Post Sidebet?',
                  `${selectedPlayer?.full_name} ${side.toUpperCase()} ${line} for ${formatCurrency(wager)}`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Post Bet', onPress: () => createSidebet.mutate() },
                  ]
                );
              }}
              disabled={createSidebet.isPending || !line || parseFloat(line) <= 0}
              className="bg-[#F59E0B] rounded-xl py-4 items-center"
              style={{ opacity: !line || parseFloat(line) <= 0 ? 0.4 : 1 }}
            >
              {createSidebet.isPending ? (
                <ActivityIndicator color="black" />
              ) : (
                <Text className="text-black font-black text-base">POST SIDEBET — {formatCurrency(wager)}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
