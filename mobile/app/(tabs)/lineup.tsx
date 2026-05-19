// =============================================================================
// BETTHAT — Player Market (Holy Grail V2, Screen 04)
// The trading floor. Browse every player playing tonight, watch prices move,
// build a lineup of 3 within the $500 cap.
// =============================================================================

import { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtPct, priceDirectionColor,
  playerInitials, playerLastName, SALARY_CAP, LINEUP_SIZE,
} from '@/lib/holygrail';
import { ScreenHeader } from '@/components/holygrail/ScreenHeader';
import { Ticker, type TickerEntry } from '@/components/holygrail/Ticker';
import { SectionHead } from '@/components/holygrail/SectionHead';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import { Sparkline } from '@/components/holygrail/Sparkline';
import {
  usePlayerMarket,
  type PlayerMarketRow,
  type TrendingRow,
  type InProgressLineup,
} from '@/hooks/holygrail/usePlayerMarket';
import { recomputeLineupCap } from '@/hooks/holygrail/lineupOps';

const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = (typeof POSITIONS)[number];

// Price filter buckets — UI only. Values are inclusive lower / exclusive upper.
const PRICE_BUCKETS = [
  { key: 'any',     label: 'Any',         lo: 0,   hi: Infinity },
  { key: 'lt50',    label: 'Under $50',   lo: 0,   hi: 50 },
  { key: '50to100', label: '$50–$100',    lo: 50,  hi: 100 },
  { key: '100to150',label: '$100–$150',   lo: 100, hi: 150 },
  { key: 'gt150',   label: 'Over $150',   lo: 150, hi: Infinity },
] as const;
type PriceBucketKey = (typeof PRICE_BUCKETS)[number]['key'];

export default function PlayerMarketScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();
  const userId = profile?.id;

  const { data, isLoading, isRefetching, refetch } = usePlayerMarket(userId);

  const [position, setPosition] = useState<Position>('ALL');
  const [priceBucket, setPriceBucket] = useState<PriceBucketKey>('any');
  const [search, setSearch] = useState('');

  const lineup = data?.lineup ?? null;
  const pickedIds = useMemo(() => {
    const s = new Set<string>();
    if (lineup) for (const lp of lineup.lineup_players) s.add(lp.nba_players.id);
    return s;
  }, [lineup]);

  // Filter + sort
  const players = useMemo(() => {
    if (!data?.tonight) return [];
    const q = search.trim().toLowerCase();
    const bucket = PRICE_BUCKETS.find((b) => b.key === priceBucket)!;
    return data.tonight
      .filter((p) => p.player_prices != null)
      .filter((p) => {
        if (position !== 'ALL' && p.position !== position) return false;
        if (q && !`${p.full_name} ${p.ticker_handle} ${p.team_abbreviation}`.toLowerCase().includes(q)) return false;
        const price = Number(p.player_prices!.current_price);
        if (price < bucket.lo || price >= bucket.hi) return false;
        return true;
      })
      .sort((a, b) => {
        const al = a.player_prices!.is_locked ? 1 : 0;
        const bl = b.player_prices!.is_locked ? 1 : 0;
        if (al !== bl) return al - bl;
        return Number(b.player_prices!.current_price) - Number(a.player_prices!.current_price);
      });
  }, [data?.tonight, position, priceBucket, search]);

  // Ticker = top 16 absolute movers in tonight's slate
  const tickerEntries = useMemo<TickerEntry[]>(() => {
    if (!data?.tonight) return [];
    return data.tonight
      .filter((p) => p.player_prices?.price_change_pct_24h != null)
      .map((p) => ({
        ticker: p.ticker_handle || playerLastName(p).toUpperCase(),
        price: Number(p.player_prices!.current_price),
        pctChange: Number(p.player_prices!.price_change_pct_24h ?? 0),
      }))
      .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
      .slice(0, 16);
  }, [data?.tonight]);

  // Add / remove player mutation
  const addMutation = useMutation({
    mutationFn: async (vars: { player: PlayerMarketRow; price: number }) => {
      if (!userId) throw new Error('Not signed in');
      const lineupId = await ensureBuildingLineup(userId, lineup);
      const usedSlots = new Set((lineup?.lineup_players ?? []).map((lp) => lp.slot_number));
      const nextSlot = [1, 2, 3].find((n) => !usedSlots.has(n));
      if (!nextSlot) throw new Error('Lineup full');
      const { error } = await supabase.from('lineup_players').insert({
        lineup_id: lineupId,
        player_id: vars.player.id,
        slot_number: nextSlot,
        frozen_price: vars.price,
      });
      if (error) throw error;
      // Always sum from the source of truth — never math on stale cache.
      await recomputeLineupCap(lineupId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-market'] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (playerId: string) => {
      if (!lineup) return;
      const { error } = await supabase
        .from('lineup_players')
        .delete()
        .eq('lineup_id', lineup.id)
        .eq('player_id', playerId);
      if (error) throw error;
      await recomputeLineupCap(lineup.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-market'] }),
  });

  const picked = lineup?.lineup_players ?? [];
  const isFull = picked.length >= LINEUP_SIZE;

  // Build projection map: playerId → last5_avg_fpts for sticky bar total
  const projMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of (data?.tonight ?? [])) {
      if (p.last5_avg_fpts != null) m.set(p.id, Number(p.last5_avg_fpts));
    }
    return m;
  }, [data?.tonight]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <ScreenHeader walletBalance={wallet?.balance} />
      <Ticker entries={tickerEntries} />

      <FlatList
        data={players}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={HG.sky}
            colors={[HG.sky]}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Search */}
            <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  height: 44,
                  paddingHorizontal: 14,
                  gap: 10,
                  backgroundColor: HG.inputBg,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: HG.hairline,
                }}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
                  <Path d="m21 21-4.3-4.3" />
                </Svg>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search players or tickers"
                  placeholderTextColor={HG.muted}
                  style={{
                    flex: 1,
                    color: HG.ink,
                    fontFamily: FONT.sans,
                    fontSize: 14,
                    height: '100%',
                    padding: 0,
                  }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* Position chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6, gap: 8 }}
            >
              {POSITIONS.map((p) => {
                const active = position === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setPosition(p)}
                    style={{
                      height: 32,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: active ? HG.sky : HG.surface,
                      borderWidth: 1,
                      borderColor: active ? HG.sky : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 11,
                        letterSpacing: 0.9,
                        color: active ? HG.jet : HG.muted,
                      }}
                    >
                      {p === 'ALL' ? 'All' : p}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Price filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 6, gap: 8 }}
            >
              {PRICE_BUCKETS.map((b) => {
                const active = priceBucket === b.key;
                return (
                  <Pressable
                    key={b.key}
                    onPress={() => setPriceBucket(b.key)}
                    style={{
                      height: 28,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      backgroundColor: active ? HG.skySoft : 'transparent',
                      borderWidth: 1,
                      borderColor: active ? HG.skyEdge : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: active ? FONT.monoBold : FONT.monoMedium,
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: active ? HG.sky : HG.muted,
                      }}
                    >
                      {b.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Trending carousel */}
            {data?.trending && data.trending.length > 0 && position === 'ALL' && !search ? (
              <>
                <SectionHead word="" emphasis="Trending" emphasisFirst label="Last 4h" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingBottom: 4 }}
                >
                  {data.trending.slice(0, 6).map((t) => (
                    <TrendCard key={t.player_id} row={t} onPress={() => router.push(`/player/${t.player_id}` as any)} />
                  ))}
                </ScrollView>
              </>
            ) : null}

            <SectionHead word="Playing" emphasis="Tonight" label={`${players.length} players`} />
          </View>
        }
        renderItem={({ item }) => (
          <PlayerRow
            player={item}
            sparkPrices={data?.history.get(item.id) ?? []}
            isPicked={pickedIds.has(item.id)}
            disabled={isFull && !pickedIds.has(item.id)}
            onAdd={() => addMutation.mutate({ player: item, price: Number(item.player_prices!.current_price) })}
            onRemove={() => removeMutation.mutate(item.id)}
            onTap={() => router.push(`/player/${item.id}` as any)}
          />
        )}
        contentContainerStyle={{ paddingBottom: lineup && picked.length > 0 ? 240 : 60 }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 60, alignItems: 'center' }}>
              <ActivityIndicator color={HG.sky} />
            </View>
          ) : (
            <View style={{ padding: 60 }}>
              <Text style={{ color: HG.muted, fontFamily: FONT.sans, fontSize: 13, textAlign: 'center' }}>
                No players match your filter.
              </Text>
            </View>
          )
        }
      />

      {/* Sticky lineup builder */}
      {picked.length > 0 ? (
        <StickyLineupBar
          lineup={lineup}
          projMap={projMap}
          onPlaceOrder={() => router.push('/matchup/create' as any)}
          onRemove={(playerId) => removeMutation.mutate(playerId)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

async function ensureBuildingLineup(userId: string, existing: InProgressLineup | null): Promise<string> {
  if (existing?.id) return existing.id;
  // Create a new in-progress lineup. entry_tier is the legacy NOT NULL column;
  // populate with placeholder 25 since max_wager is the authoritative source.
  const { data, error } = await supabase
    .from('lineups')
    .insert({
      user_id: userId,
      entry_tier: 25,
      status: 'building',
      total_cap_used: 0,
      game_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// =============================================================================
// TRENDING CARD
// =============================================================================

function TrendCard({ row, onPress }: { row: TrendingRow; onPress: () => void }) {
  const p = row.nba_players;
  const dir = priceDirectionColor(row.price_change_pct_24h);
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 168,
        padding: 14,
        backgroundColor: HG.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: HG.hairline,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={38} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: HG.ink, lineHeight: 16 }}>
            {playerLastName(p)}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4, marginTop: 2 }}>
            {p.ticker_handle ?? ''}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: HG.ink }}>
          {fmtPrice(row.current_price)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: dir }}>
          {fmtPct(row.price_change_pct_24h)}
        </Text>
      </View>
    </Pressable>
  );
}

// =============================================================================
// PLAYER ROW
// =============================================================================

function PlayerRow({
  player, sparkPrices, isPicked, disabled, onAdd, onRemove, onTap,
}: {
  player: PlayerMarketRow;
  sparkPrices: number[];
  isPicked: boolean;
  disabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onTap: () => void;
}) {
  const pp = player.player_prices!;
  const isLocked = pp.is_locked;
  const dirColor = priceDirectionColor(pp.price_change_pct_24h);
  const addLabel = isLocked ? 'Out' : isPicked ? 'Added' : '+ Add';
  const addState: 'add' | 'added' | 'locked' = isLocked ? 'locked' : isPicked ? 'added' : 'add';
  const proj = player.last5_avg_fpts != null ? Number(player.last5_avg_fpts).toFixed(1) : null;

  return (
    <Pressable
      onPress={onTap}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderColor: HG.hairline,
        opacity: isLocked ? 0.55 : 1,
      }}
    >
      <MonogramTile initials={playerInitials(player)} jersey={player.jersey_number} size={52} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: HG.ink, flexShrink: 1 }}
          >
            {player.full_name}
          </Text>
          {isLocked ? (
            <View style={{ backgroundColor: HG.downSoft, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 9, color: HG.down, letterSpacing: 0.6 }}>OUT</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4 }}>
            {player.ticker_handle ?? ''}
          </Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted }}>
            {player.team_abbreviation} · {player.position}
          </Text>
          {proj !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2 }}>proj</Text>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: HG.ink2 }}>{proj}</Text>
            </View>
          )}
          <DemandChip count={pp.demand_count_1h} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Sparkline prices={sparkPrices} width={48} height={20} />
        <View style={{ alignItems: 'flex-end', minWidth: 56 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 16, color: HG.ink }}>{fmtPrice(pp.current_price)}</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: dirColor, marginTop: 1 }}>
            {fmtPct(pp.price_change_pct_24h)}
          </Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            if (addState === 'locked') return;
            if (addState === 'added') onRemove();
            else if (!disabled) onAdd();
          }}
          disabled={disabled || isLocked}
          hitSlop={6}
          style={{
            height: 32,
            paddingHorizontal: 12,
            minWidth: 64,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: addState === 'added' ? HG.sky : HG.surface,
            borderWidth: 1,
            borderColor: addState === 'added' ? HG.sky : addState === 'locked' ? HG.hairline : HG.hairline2,
            opacity: disabled || isLocked ? 0.6 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: FONT.monoBold,
              fontSize: 11,
              letterSpacing: 0.9,
              color: addState === 'added' ? HG.jet : addState === 'locked' ? HG.muted2 : HG.ink2,
            }}
          >
            {addLabel}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// =============================================================================
// STICKY LINEUP BAR
// =============================================================================

function StickyLineupBar({
  lineup,
  projMap,
  onPlaceOrder,
  onRemove,
}: {
  lineup: InProgressLineup | null;
  projMap: Map<string, number>;
  onPlaceOrder: () => void;
  onRemove: (playerId: string) => void;
}) {
  const picked = lineup?.lineup_players ?? [];
  const capUsed = Number(lineup?.total_cap_used ?? 0);
  const capLeft = SALARY_CAP - capUsed;
  const remaining = LINEUP_SIZE - picked.length;
  const ready = remaining === 0;
  const slots = Array.from({ length: LINEUP_SIZE }, (_, i) => picked[i] ?? null);

  const totalProj = picked.reduce((sum, p) => sum + (projMap.get(p.nba_players.id) ?? 0), 0);
  const hasProj = picked.some((p) => projMap.has(p.nba_players.id));

  const cta =
    remaining === 1 ? 'Pick 1 more player'
    : remaining > 0 ? `Pick ${remaining} more players`
    : 'Place Order';

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: HG.surface,
        borderTopWidth: 1,
        borderTopColor: HG.hairline,
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 14,
        shadowColor: '#000',
        shadowOpacity: 0.6,
        shadowOffset: { width: 0, height: -8 },
        shadowRadius: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, letterSpacing: 1.6, color: HG.muted, textTransform: 'uppercase' }}>
            Your lineup
          </Text>
          <View
            style={{
              backgroundColor: HG.navySoft,
              borderColor: HG.skyEdge,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.ink, letterSpacing: 0.4 }}>
              {picked.length} / {LINEUP_SIZE}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          {hasProj && (
            <>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>proj FP</Text>
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky }}>{totalProj.toFixed(1)}</Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.hairline2 }}>·</Text>
            </>
          )}
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>Cap left</Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink }}>${capLeft.toFixed(0)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {slots.map((s, i) => {
          if (!s) {
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: HG.inputBg,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: HG.hairline2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, letterSpacing: 1.2 }}>PICK</Text>
              </View>
            );
          }
          return (
            <Pressable
              key={s.nba_players.id}
              onPress={() => onRemove(s.nba_players.id)}
              accessibilityLabel={`Remove ${playerLastName(s.nba_players)} from lineup`}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 10,
                backgroundColor: HG.surface,
                borderWidth: 1,
                borderColor: HG.skyEdge,
                paddingHorizontal: 8,
                justifyContent: 'center',
                gap: 1,
                position: 'relative',
              }}
            >
              <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: HG.ink, paddingRight: 14 }}>
                {playerLastName(s.nba_players)}
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted }}>
                {fmtPrice(s.frozen_price)}
              </Text>
              {/* Tap-to-remove × badge */}
              <View
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  backgroundColor: HG.jet,
                  borderWidth: 1,
                  borderColor: HG.hairline2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: HG.muted, lineHeight: 12 }}>×</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={ready ? onPlaceOrder : undefined}
        disabled={!ready}
        style={{
          height: 48,
          borderRadius: 999,
          backgroundColor: ready ? HG.sky : HG.surface,
          borderWidth: ready ? 0 : 1,
          borderColor: HG.hairline,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: FONT.monoBold,
            fontSize: 12,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: ready ? HG.jet : HG.muted2,
          }}
        >
          {cta}
        </Text>
      </Pressable>
    </View>
  );
}

// =============================================================================
// DEMAND CHIP — LOW / MED / HIGH visibility indicator
// Thresholds (1h demand count): 0-4 = LOW, 5-14 = MED, 15+ = HIGH
// =============================================================================

function DemandChip({ count }: { count: number | null | undefined }) {
  if (count == null) return null;
  const n = Number(count);
  let label: string;
  let color: string;
  let bg: string;
  if (n >= 15) {
    label = 'HIGH';
    color = HG.up;
    bg = HG.upSoft;
  } else if (n >= 5) {
    label = 'MED';
    color = HG.sky;
    bg = HG.skySoft;
  } else {
    return null; // LOW demand — show nothing to avoid noise
  }
  return (
    <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: bg }}>
      <Text style={{ fontFamily: FONT.monoBold, fontSize: 8, color, letterSpacing: 0.8 }}>{label}</Text>
    </View>
  );
}
