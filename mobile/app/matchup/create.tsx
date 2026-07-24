// =============================================================================
// BETTHAT — Game Setup (Figma redesign)
// Salary cap remaining + price-freeze countdown, lineup review with per-player
// price graphs, open-input wager with quick presets, computed Potential
// Payout, and a plain "Find Match" button (no swipe gesture — the Figma spec
// for this frame shows a flat, always-tappable CTA, not a swipe track).
//
// Light/dark themed, yellow accent — matches app/(tabs)/profile.tsx and the
// redesigned app/(tabs)/lineup.tsx (Draft Market) patterns.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Animated, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { placeLineupOrder, cancelLineupOrder } from '@/services/matchup';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, fmtTime, playerLastName, SALARY_CAP, MIN_WAGER, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { PlayerAvatar } from '@/components/market/PlayerAvatar';
import { PriceGraph } from '@/components/market/PriceGraph';

// Fallback freeze window when no picked player has a known market_close_at
// (e.g. games without a scheduled tip-off yet). Purely informational.
const FALLBACK_FREEZE_MS = 5 * 60 * 1000;

// Locked rake spec (__tests__/rake.test.ts) — 3.5% of the pot, both sides
// matched at the entered wager. $75 wager → $144.75 payout, verified exactly
// against the Figma sample.
const MATCHUP_RAKE = 0.035;
function potentialPayout(wager: number): { pot: number; rake: number; payout: number } {
  const pot = wager * 2;
  const rake = Math.round(pot * MATCHUP_RAKE * 100) / 100;
  return { pot, rake, payout: pot - rake };
}

const QUICK_WAGERS = [5, 10, 50, 100] as const;

export default function PlaceOrderScreen() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();

  const { data: lineup, isLoading } = useQuery({
    queryKey: ['place-order-lineup', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data, error } = await supabase
        .from('lineups')
        .select(`
          id, total_cap_used, status, max_wager, created_at,
          lineup_players(slot_number, frozen_price,
            nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation,
              player_prices(current_price, price_change_pct_24h, market_close_at)))
        `)
        .eq('user_id', profile.id)
        .eq('status', 'building')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!profile?.id,
  });

  const pickedIds = useMemo(
    () => ((lineup?.lineup_players ?? []) as any[]).map((lp) => lp.nba_players.id),
    [lineup?.lineup_players],
  );
  const { data: sparkHistory } = useQuery({
    queryKey: ['place-order-sparklines', pickedIds],
    queryFn: async () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('price_history')
        .select('player_id, price, recorded_at')
        .in('player_id', pickedIds)
        .gte('recorded_at', sixHoursAgo)
        .order('recorded_at', { ascending: true });
      const m = new Map<string, number[]>();
      for (const h of (data ?? []) as any[]) {
        const arr = m.get(h.player_id) ?? [];
        arr.push(Number(h.price));
        m.set(h.player_id, arr);
      }
      return m;
    },
    enabled: pickedIds.length > 0,
  });

  const [wager, setWager] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [matchupId, setMatchupId] = useState<string | undefined>();
  const [queueSec, setQueueSec] = useState(0);

  const wagerNum = Number(wager);
  const balance = Number(wallet?.balance ?? 0);

  const validation = useMemo(() => {
    if (!wager) return { ok: false, msg: '', helper: 'Floor $5 · No limit' };
    if (!Number.isFinite(wagerNum)) return { ok: false, msg: 'Enter a number', helper: '' };
    if (wagerNum < MIN_WAGER) return { ok: false, msg: `Minimum wager is $${MIN_WAGER}`, helper: '' };
    if (wagerNum > balance) return { ok: false, msg: 'Insufficient buying power. Deposit to continue.', helper: '' };
    return { ok: true, msg: '', helper: "You'll match at or below this amount." };
  }, [wager, wagerNum, balance]);

  const payout = validation.ok ? potentialPayout(wagerNum) : null;

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !lineup?.id) throw new Error('Missing lineup');
      const result = await placeLineupOrder(lineup.id, wagerNum);
      return { matchupId: result.matchup_id, matched: result.matched };
    },
    onSuccess: (result: any) => {
      setSubmitted(true);
      setMatchupId(result?.matchupId);
      qc.invalidateQueries({ queryKey: ['place-order-lineup'] });
      qc.invalidateQueries({ queryKey: ['player-market'] });
      qc.invalidateQueries({ queryKey: ['matchups-list'] });
    },
    onError: (err: any) => Alert.alert('Could not place order', err?.message ?? 'Try again.'),
  });

  useEffect(() => {
    if (!submitted) return;
    const id = setInterval(() => setQueueSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [submitted]);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  if (!lineup || (lineup.lineup_players ?? []).length < LINEUP_SIZE) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, padding: 24, justifyContent: 'center' }}>
        <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />
        <Text style={{ fontFamily: FONT.sansBold, fontSize: 26, color: theme.ink, marginBottom: 12 }}>
          No lineup ready
        </Text>
        <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.muted, lineHeight: 21, marginBottom: 24 }}>
          Pick 3 players in the Draft Market before placing an order.
        </Text>
        <Pressable
          onPress={() => router.replace('/(tabs)/lineup' as any)}
          style={{ height: 48, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Open Draft Market
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <PendingOrderState
        theme={theme}
        lineup={lineup}
        wager={wagerNum}
        queueSec={queueSec}
        matchupId={matchupId}
        onCancel={() => router.replace('/(tabs)/matchups' as any)}
      />
    );
  }

  const picked = (lineup.lineup_players ?? []).sort((a: any, b: any) => a.slot_number - b.slot_number);
  const totalCost = picked.reduce((sum: number, lp: any) => sum + Number(lp.frozen_price), 0);
  const capPct = Math.max(0, Math.min(100, (totalCost / SALARY_CAP) * 100));

  // Price-freeze countdown: earliest market_close_at among picked players' live
  // prices. That's the real moment a frozen price would otherwise re-float.
  // Plain computation (not useMemo) — this function body sits after several
  // early `return`s above, so a hook here would violate the Rules of Hooks.
  const freezeAt = computeFreezeAt(picked, lineup.created_at);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, color: theme.ink, letterSpacing: -0.2 }}>Game Setup</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>

        {/* Salary cap + price freeze */}
        <View style={{ marginHorizontal: 16, marginTop: 8, ...cardShadow(theme), padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>Salary Cap</Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>
              Remaining :  <Text style={{ fontFamily: FONT.monoMedium, color: theme.ink }}>{fmtPrice(SALARY_CAP - totalCost)}</Text>
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 999, backgroundColor: theme.surfaceSunken, overflow: 'hidden', marginTop: 10 }}>
            <View style={{ width: `${capPct}%`, height: '100%', backgroundColor: theme.accent }} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink2 }}>Player Price Freeze</Text>
            <FreezeCountdown theme={theme} freezeAt={freezeAt} />
          </View>
        </View>

        {/* Lineup */}
        <View style={{ marginHorizontal: 16, marginTop: 8, ...cardShadow(theme), overflow: 'hidden' }}>
          {picked.map((lp: any, i: number) => {
            const pp = lp.nba_players?.player_prices;
            const pct = Number(pp?.price_change_pct_24h ?? 0);
            const color = pct === 0 ? theme.muted : pct > 0 ? theme.gain : theme.danger;
            const primaryLabel = (lp.nba_players.ticker_handle ?? playerLastName(lp.nba_players)).toUpperCase();
            return (
              <Pressable
                key={lp.nba_players.id}
                onPress={() => router.push(`/player/${lp.nba_players.id}` as any)}
                accessibilityLabel={`View ${lp.nba_players.full_name}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderColor: theme.hairline }}
              >
                <PlayerAvatar player={lp.nba_players} theme={theme} size={40} />
                <View style={{ width: 108 }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{primaryLabel}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted, marginTop: 1 }}>
                    {lp.nba_players.full_name} {lp.nba_players.position}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <PriceGraph prices={sparkHistory?.get(lp.nba_players.id) ?? []} theme={theme} width={72} height={36} />
                </View>
                <View style={{ alignItems: 'flex-end', minWidth: 78 }}>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{fmtPrice(lp.frozen_price)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                    <Svg width={8} height={7} viewBox="0 0 8 7">
                      <Path d={pct >= 0 ? 'M4 0 L8 7 L0 7 Z' : 'M0 0 L8 0 L4 7 Z'} fill={color} />
                    </Svg>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color }}>{Math.abs(pct).toFixed(2)}%</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surfaceSunken }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.6 }}>Lineup total</Text>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }}>
              {fmtPrice(totalCost)} <Text style={{ color: theme.muted }}>/ {fmtPrice(SALARY_CAP)} cap</Text>
            </Text>
          </View>
        </View>

        {/* Wager amount */}
        <View style={{ marginHorizontal: 16, marginTop: 8, ...cardShadow(theme), padding: 20, alignItems: 'center' }}>
          <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>Wager Amount</Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>
              Wallet Amount :  <Text style={{ fontFamily: FONT.monoMedium, color: theme.ink }}>{balance.toFixed(2)}</Text>
            </Text>
          </View>

          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.6 }}>
            Value ($)
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 30, color: validation.ok || !wager ? theme.muted2 : theme.danger, marginRight: 4 }}>$</Text>
            <TextInput
              value={wager}
              onChangeText={setWager}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.muted2}
              maxLength={6}
              style={{
                fontFamily: FONT.sansMedium,
                fontSize: 52,
                color: validation.ok || !wager ? theme.ink : theme.danger,
                letterSpacing: -1.5,
                minWidth: 100,
                textAlign: 'center',
                padding: 0,
              }}
            />
          </View>
          <Text
            style={{
              fontFamily: FONT.sans, fontSize: 12,
              color: validation.msg ? theme.danger : theme.muted,
              marginTop: 8, textAlign: 'center',
            }}
          >
            {validation.msg || validation.helper}
          </Text>

          <View style={{ width: '100%', marginTop: 22 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.6, marginBottom: 10 }}>
              Quick Wager
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {QUICK_WAGERS.map((v) => {
                const active = wagerNum === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setWager(String(v))}
                    style={{
                      flex: 1, paddingHorizontal: 8, height: 40, borderRadius: 12,
                      borderWidth: 1, borderColor: active ? theme.accentEdge : theme.hairline2,
                      backgroundColor: active ? theme.accentSoft : theme.surfaceSunken,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: active ? theme.ink : theme.muted }}>${v} Bet</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ width: '100%', marginTop: 22, alignItems: 'center', paddingTop: 18, borderTopWidth: 1, borderColor: theme.hairline }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: theme.muted, letterSpacing: 0.6 }}>
              Potential Payout
            </Text>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 30, color: theme.gain, marginTop: 6 }}>
              {payout ? fmtPrice(payout.payout) : '$—'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Find Match */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28,
          backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.hairline,
        }}
      >
        <Pressable
          onPress={() => placeMutation.mutate()}
          disabled={!validation.ok || placeMutation.isPending}
          style={{
            height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
            backgroundColor: validation.ok ? theme.accent : theme.surfaceSunken,
            borderWidth: validation.ok ? 0 : 1, borderColor: theme.hairline,
            opacity: placeMutation.isPending ? 0.6 : 1,
          }}
        >
          {placeMutation.isPending ? (
            <ActivityIndicator color={validation.ok ? theme.onAccent : theme.muted} />
          ) : (
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: validation.ok ? theme.onAccent : theme.muted2, letterSpacing: 0.2 }}>
              Find Match
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function cardShadow(theme: Theme) {
  return {
    backgroundColor: theme.surface,
    borderRadius: 20,
    shadowColor: '#151517',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: theme.mode === 'light' ? 0.05 : 0,
    shadowRadius: 8,
    elevation: theme.mode === 'light' ? 2 : 0,
  } as const;
}

function computeFreezeAt(picked: any[], lineupCreatedAt: string): number {
  const closes = picked
    .map((lp: any) => lp.nba_players?.player_prices?.market_close_at)
    .filter(Boolean)
    .map((iso: string) => new Date(iso).getTime())
    .filter((t: number) => Number.isFinite(t));
  if (closes.length > 0) return Math.min(...closes);
  return new Date(lineupCreatedAt).getTime() + FALLBACK_FREEZE_MS;
}

// =============================================================================
// PRICE-FREEZE COUNTDOWN
// =============================================================================

function FreezeCountdown({ theme, freezeAt }: { theme: Theme; freezeAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const rawRemainingMs = freezeAt - now;
  const remainingMs = Math.max(0, rawRemainingMs);
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');
  const urgent = remainingMs < 60_000;
  // "Locking…" implies an imminent transition; if the freeze point passed a
  // while ago (picked players whose game already tipped off), the accurate
  // static label is "Locked" — otherwise a lineup drafted mid-live-game would
  // show "Locking…" indefinitely, which reads as still-in-progress.
  const label = rawRemainingMs > 0 ? `${mm}:${ss}` : rawRemainingMs > -60_000 ? 'Locking…' : 'Locked';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: urgent ? theme.gainSoft : theme.surfaceSunken, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
      <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: urgent ? theme.danger : theme.accent }} />
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: urgent ? theme.danger : theme.ink, letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}

// =============================================================================
// PENDING ORDER STATE — "In queue · 00:14"
// =============================================================================

function PendingOrderState({
  theme, lineup, wager, queueSec, onCancel, matchupId,
}: {
  theme: Theme; lineup: any; wager: number; queueSec: number; onCancel: () => void; matchupId?: string;
}) {
  const mm = String(Math.floor(queueSec / 60)).padStart(2, '0');
  const ss = String(queueSec % 60).padStart(2, '0');
  const router = useRouter();
  const qc = useQueryClient();

  // Real matches are detected purely by the `matchedDemo` poll below (every
  // 3s, watching this matchup's `status`) once an actual opponent's order
  // gets FIFO-matched server-side by `place_lineup_order`. This used to also
  // fire a "TEST MODE" timer that force-matched the order against the same
  // user via the `test_auto_match` RPC after 10s — removed because that RPC
  // fabricated a match with no second-side escrow (the "opponent" was never
  // actually charged, so settlement would have paid out money nobody put in)
  // and was independently found reachable by the unauthenticated `anon` role
  // with attacker-controlled matchup/user/lineup/wager params. The function
  // itself has been dropped server-side (see the friend_challenges migration
  // follow-up); this client-side call is removed to match.

  // Routed through the cancel_lineup_order RPC instead of raw client deletes:
  // that RPC locks the matchup row and atomically refuses to cancel once an
  // opponent has already matched (raises "already matched"), closing a race
  // where tapping Cancel at the same instant a match landed used to reset a
  // lineup that was actually already live. It's also the only path that still
  // works at all — the RLS policies that used to let the client DELETE
  // matchmaking_queue/matchups rows directly were removed when escrow-based
  // ordering shipped (see 20260620000000_fix_matchup_escrow_and_account_deletion.sql).
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!matchupId) return;
      await cancelLineupOrder(matchupId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matchups-list'] });
      qc.invalidateQueries({ queryKey: ['place-order-lineup'] });
      onCancel();
    },
    onError: (err: any) => {
      const alreadyMatched = /already matched/i.test(err?.message ?? '');
      if (alreadyMatched) {
        // A match landed in the same instant — refresh instead of erroring out
        // so the user lands on their now-live matchup rather than a dead end.
        qc.invalidateQueries({ queryKey: ['matched-demo', matchupId] });
        Alert.alert('Match found!', "An opponent matched your order just now — it can't be cancelled.");
      } else {
        Alert.alert('Could not cancel order', err?.message ?? 'Try again.');
      }
    },
  });

  const { data: matchedDemo } = useQuery({
    queryKey: ['matched-demo', matchupId],
    queryFn: async () => {
      if (!matchupId) return null;
      const { data } = await supabase
        .from('matchups')
        .select('id, status, matched_at')
        .eq('id', matchupId)
        .eq('status', 'matched')
        .maybeSingle();
      return data;
    },
    enabled: !!matchupId,
    refetchInterval: 3000,
  });

  const picked = ((lineup?.lineup_players ?? []) as any[]).slice().sort((a, b) => a.slot_number - b.slot_number);
  const totalCost = picked.reduce((sum, lp) => sum + Number(lp.frozen_price), 0);
  const leftoverSalary = Math.max(0, SALARY_CAP - totalCost);
  const { pot, rake, payout } = potentialPayout(wager);
  const freezeAt = computeFreezeAt(picked, lineup?.created_at ?? new Date().toISOString());
  const matched = !!matchedDemo?.id;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
        <View style={{ width: 22 }} />
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, color: theme.ink, letterSpacing: -0.2 }}>Order Details</Text>
        <Pressable onPress={() => router.replace('/(tabs)/home' as any)} hitSlop={12}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M18 6 6 18M6 6l12 12" />
          </Svg>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 4 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 1.2 }}>
            Order #{orderNumber(matchupId)}
          </Text>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 20, color: theme.ink, marginTop: 4 }}>
            3v3 Head to Head
          </Text>
        </View>

        {/* Wager Summary */}
        <View style={{ marginTop: 16, ...cardShadow(theme), padding: 16 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink, marginBottom: 12 }}>Wager Summary</Text>
          <SummaryRow theme={theme} label="Your Entry" value={fmtPrice(wager)} />
          <SummaryRow theme={theme} label="Potential Opponent Stake" value={fmtPrice(wager)} />
          <SummaryRow theme={theme} label="Prize Pool" value={fmtPrice(pot)} />
          <SummaryRow theme={theme} label="Rake (3.5%)" value={`-${fmtPrice(rake)}`} muted />
          <SummaryRow theme={theme} label="Potential Payout" value={`+${fmtPrice(payout)}`} accent last />
        </View>

        {/* Player Draft */}
        <View style={{ marginTop: 12, ...cardShadow(theme), overflow: 'hidden' }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink, padding: 16, paddingBottom: 8 }}>Player Draft</Text>
          {picked.map((lp: any, i: number) => (
            <Pressable
              key={lp.nba_players.id}
              onPress={() => router.push(`/player/${lp.nba_players.id}` as any)}
              accessibilityLabel={`View ${lp.nba_players.full_name}`}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderColor: theme.hairline }}
            >
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>{lp.nba_players.full_name}</Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: theme.ink }}>{fmtPrice(lp.frozen_price)}</Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderTopWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surfaceSunken }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.muted }}>Leftover Salary</Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: theme.ink }}>{fmtPrice(leftoverSalary)}</Text>
          </View>
        </View>

        {/* Game Details */}
        <View style={{ marginTop: 12, ...cardShadow(theme), padding: 16 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink, marginBottom: 12 }}>Game Details</Text>
          <SummaryRow theme={theme} label="Scoring" value="Standard" />
          <SummaryRow theme={theme} label="Lineup Locks" value={`${fmtTime(new Date(freezeAt))} ET`} last />
        </View>

        {/* Status */}
        <View style={{ alignItems: 'center', marginTop: 24 }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingHorizontal: 18, paddingVertical: 10,
              backgroundColor: matched ? theme.accentSoft : theme.surface,
              borderRadius: 999, borderWidth: 1, borderColor: theme.accentEdge,
            }}
          >
            {matched
              ? <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink, letterSpacing: 0.4 }}>✓ Match found!</Text>
              : <><PulsingDot theme={theme} /><Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink, letterSpacing: 0.4 }}>Looking for an opponent…</Text></>
            }
          </View>
          {!matched ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 8 }}>
              In queue · {mm}:{ss}
            </Text>
          ) : null}

          {matched ? (
            <Pressable
              onPress={() => router.replace(`/matchup/found/${matchedDemo.id}` as any)}
              style={{ marginTop: 20, height: 52, paddingHorizontal: 28, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}
            >
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: theme.onAccent, letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center' }}>
                View Matchup →
              </Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} style={{ marginTop: 20, padding: 12, opacity: cancelMutation.isPending ? 0.5 : 1 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: theme.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel order'}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Cosmetic-only display id ("Order #1234") derived from the real matchup
// UUID — there's no separate human-readable order sequence in the schema,
// and matchup ids are UUIDs, not the small integers the design calls for.
function orderNumber(id?: string): string {
  if (!id) return '----';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return String(1000 + (h % 9000));
}

function SummaryRow({
  theme, label, value, muted, accent, last,
}: {
  theme: Theme; label: string; value: string; muted?: boolean; accent?: boolean; last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: 8,
        borderTopWidth: last ? 1 : 0, borderColor: theme.hairline,
        marginTop: last ? 4 : 0,
      }}
    >
      <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>{label}</Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: accent ? theme.gain : muted ? theme.muted : theme.ink }}>
        {value}
      </Text>
    </View>
  );
}

function PulsingDot({ theme }: { theme: Theme }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: theme.accent, opacity }} />;
}
