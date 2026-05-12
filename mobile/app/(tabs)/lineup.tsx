import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useLineupStore } from '@/stores/lineup.store';
import { formatCurrency, formatStatLine, TIER_CAPS, TIER_COLORS, salaryColor, truncateName } from '@/lib/utils';
import type { PlayerMarket } from '@/lib/database.types';

const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];
const TIERS = ['ALL', 'budget', 'mid', 'star', 'superstar'] as const;

export default function LineupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tier?: string }>();

  const { tier, salaryCap, slots, totalSalary, remainingSalary, setTier, addPlayer, removePlayer, reset } = useLineupStore();

  const [selectedPosition, setSelectedPosition] = useState('ALL');
  const [selectedTierFilter, setSelectedTierFilter] = useState<typeof TIERS[number]>('ALL');
  const [search, setSearch] = useState('');
  const [pickingSlot, setPickingSlot] = useState<string | null>(null); // which position slot is being filled

  // If tier param passed (from Home quick enter), set it
  useState(() => {
    if (params.tier && !tier) {
      const t = params.tier as '$1' | '$5' | '$10' | '$20' | '$50';
      setTier(t, TIER_CAPS[t]);
    }
  });

  const { data: players, isLoading } = useQuery({
    queryKey: ['player_market'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mv_player_market')
        .select('*')
        .eq('is_active', true)
        .order('current_price', { ascending: false });
      if (error) throw error;
      return data as PlayerMarket[];
    },
    staleTime: 30_000,
  });

  const filteredPlayers = players?.filter((p) => {
    if (selectedPosition !== 'ALL' && p.position !== selectedPosition) return false;
    if (selectedTierFilter !== 'ALL' && p.salary_tier !== selectedTierFilter) return false;
    if (search && !p.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }) ?? [];

  const filledSlots = slots.filter((s) => s.playerId !== null).length;
  const isComplete = filledSlots === 5;

  async function handleSubmitLineup() {
    if (!isComplete || !tier) return;
    // Navigate to matchup creation with this lineup
    router.push({ pathname: '/matchup/create', params: { tier } });
  }

  // ─── Tier picker (if no tier selected yet) ───────────────────
  if (!tier) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
        <View className="px-5 pt-4 pb-6">
          <Text className="text-white text-2xl font-black mb-1">Build Lineup</Text>
          <Text className="text-[#71717A]">Choose your entry tier to start.</Text>
        </View>
        <ScrollView className="px-5">
          {(['$1', '$5', '$10', '$20', '$50'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTier(t, TIER_CAPS[t])}
              className="bg-[#141414] border border-[#2E2E2E] rounded-2xl p-5 mb-4"
            >
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-[#F59E0B] text-2xl font-black">{t} Entry</Text>
                  <Text className="text-[#71717A] text-sm mt-1">
                    Salary Cap: ${TIER_CAPS[t]}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-white font-black text-xl">
                    {formatCurrency(Number(t.slice(1)) * 2 * 0.965)}
                  </Text>
                  <Text className="text-[#71717A] text-xs">win prize</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]" edges={['top']}>
      {/* ── Header ── */}
      <View className="px-5 pt-4 pb-2">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-white text-xl font-black">{tier} Lineup</Text>
          <TouchableOpacity onPress={reset}>
            <Text className="text-[#71717A] text-sm">Reset</Text>
          </TouchableOpacity>
        </View>
        {/* Salary cap bar */}
        <View className="flex-row items-center gap-3">
          <View className="flex-1 h-2 bg-[#1E1E1E] rounded-full overflow-hidden">
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.min((totalSalary / salaryCap) * 100, 100)}%`,
                backgroundColor: salaryColor(remainingSalary, salaryCap),
              }}
            />
          </View>
          <Text className="text-white text-sm font-bold" style={{ color: salaryColor(remainingSalary, salaryCap) }}>
            ${remainingSalary} left
          </Text>
        </View>
      </View>

      {/* ── Lineup Slots ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-5 py-3" style={{ maxHeight: 100 }}>
        {slots.map((slot) => (
          <TouchableOpacity
            key={slot.position}
            onPress={() => {
              if (slot.playerId) {
                removePlayer(slot.position);
              } else {
                setPickingSlot(slot.position);
              }
            }}
            className="mr-3 items-center"
          >
            <View
              className="w-14 h-14 rounded-xl border-2 items-center justify-center"
              style={{
                borderColor: slot.playerId ? '#F59E0B' : pickingSlot === slot.position ? '#F59E0B' : '#2E2E2E',
                backgroundColor: slot.playerId ? '#1a1a0a' : '#141414',
              }}
            >
              {slot.playerId ? (
                <Text className="text-white text-xs font-bold text-center" numberOfLines={2}>
                  {truncateName(slot.playerName ?? '', 8)}
                </Text>
              ) : (
                <Text className="text-[#4B5563] font-bold text-sm">{slot.position}</Text>
              )}
            </View>
            <Text className="text-[#71717A] text-[10px] mt-1">{slot.position}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Filters ── */}
      <View className="px-5 pb-2">
        {/* Search */}
        <TextInput
          className="bg-[#141414] border border-[#2E2E2E] rounded-xl px-4 py-2.5 text-white text-sm mb-2"
          placeholder="Search players..."
          placeholderTextColor="#4B5563"
          value={search}
          onChangeText={setSearch}
        />
        {/* Position filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {POSITIONS.map((pos) => (
            <TouchableOpacity
              key={pos}
              onPress={() => setSelectedPosition(pos)}
              className="mr-2 px-3 py-1.5 rounded-full border"
              style={{
                borderColor: selectedPosition === pos ? '#F59E0B' : '#2E2E2E',
                backgroundColor: selectedPosition === pos ? '#1a1400' : 'transparent',
              }}
            >
              <Text
                className="text-xs font-bold"
                style={{ color: selectedPosition === pos ? '#F59E0B' : '#71717A' }}
              >
                {pos}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── Player List ── */}
      {isLoading ? (
        <ActivityIndicator color="#F59E0B" className="mt-8" />
      ) : (
        <FlatList
          data={filteredPlayers}
          keyExtractor={(item) => item.player_id}
          renderItem={({ item }) => (
            <PlayerRow
              player={item}
              salaryCap={salaryCap}
              remainingSalary={remainingSalary}
              pickingSlot={pickingSlot}
              isSelected={slots.some((s) => s.playerId === item.player_id)}
              onSelect={(player) => {
                if (!pickingSlot) return;
                addPlayer({
                  position: pickingSlot,
                  playerId: player.player_id,
                  playerName: player.full_name,
                  price: player.current_price ?? 0,
                });
                setPickingSlot(null);
              }}
            />
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      {/* ── Submit CTA ── */}
      {isComplete && (
        <View className="absolute bottom-0 left-0 right-0 p-5 bg-[#0a0a0a] border-t border-[#1E1E1E]">
          <TouchableOpacity
            onPress={handleSubmitLineup}
            className="bg-[#F59E0B] rounded-xl py-4 items-center"
          >
            <Text className="text-black font-black text-base">
              ENTER MATCHUP — {tier}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function PlayerRow({
  player, salaryCap, remainingSalary, pickingSlot, isSelected, onSelect,
}: {
  player: PlayerMarket;
  salaryCap: number;
  remainingSalary: number;
  pickingSlot: string | null;
  isSelected: boolean;
  onSelect: (p: PlayerMarket) => void;
}) {
  const price = player.current_price ?? 0;
  const canAfford = price <= remainingSalary;
  const tierColor = TIER_COLORS[player.salary_tier ?? 'budget'];

  return (
    <TouchableOpacity
      onPress={() => {
        if (!pickingSlot || !canAfford || isSelected) return;
        onSelect(player);
      }}
      className="flex-row items-center px-5 py-3 border-b border-[#141414]"
      style={{ opacity: (pickingSlot && !canAfford) || isSelected ? 0.5 : 1 }}
    >
      {/* Tier color indicator */}
      <View className="w-1 h-10 rounded-full mr-3" style={{ backgroundColor: tierColor }} />

      {/* Player info */}
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-white font-bold text-base">{truncateName(player.full_name, 18)}</Text>
          {player.is_injured && (
            <View className="bg-[#EF4444] rounded px-1.5 py-0.5">
              <Text className="text-white text-[9px] font-bold">OUT</Text>
            </View>
          )}
        </View>
        <Text className="text-[#71717A] text-xs mt-0.5">
          {player.position} · {player.team_abbr ?? '—'} ·{' '}
          {formatStatLine(player.points_per_game, player.reb_per_game, player.assists_per_game)} avg
        </Text>
      </View>

      {/* Price */}
      <View className="items-end ml-3">
        <Text className="text-white font-black text-base">${price}</Text>
        {player.fantasy_pts_pg != null && (
          <Text className="text-[#71717A] text-xs">{player.fantasy_pts_pg.toFixed(1)} fp/g</Text>
        )}
      </View>

      {/* Selected checkmark */}
      {isSelected && (
        <View className="ml-2 w-6 h-6 rounded-full bg-[#F59E0B] items-center justify-center">
          <Text className="text-black font-black text-xs">✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
