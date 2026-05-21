// =============================================================================
// BETTHAT — Place Order (Holy Grail V2, Screen 06)
// Open-input max wager $5–$50. Swipe-to-confirm with tap fallback.
// Post-swipe: Pending Order state — "In queue · 00:14" with sky-blue dot.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  useDerivedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, playerLastName, playerInitials,
  SALARY_CAP, MIN_WAGER, LINEUP_SIZE,
} from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

const SWIPE_TRACK_HEIGHT = 56;
const THUMB_SIZE = 48;

export default function PlaceOrderScreen() {
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
          id, total_cap_used, status, max_wager,
          lineup_players(slot_number, frozen_price,
            nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation))
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

  const [wager, setWager] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [queueSec, setQueueSec] = useState(0);

  const wagerNum = Number(wager);
  const balance = Number(wallet?.balance ?? 0);

  const validation = useMemo(() => {
    if (!wager) return { ok: false, msg: '', helper: 'Floor $5 · No limit' };
    if (!Number.isFinite(wagerNum)) return { ok: false, msg: 'Enter a number', helper: '' };
    if (wagerNum < MIN_WAGER) return { ok: false, msg: `Minimum wager is $${MIN_WAGER}`, helper: '' };
    if (wagerNum > balance) return { ok: false, msg: 'Insufficient buying power. Deposit to continue.', helper: '' };
    return { ok: true, msg: '', helper: 'You\'ll match at or below this amount.' };
  }, [wager, wagerNum, balance]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !lineup?.id) throw new Error('Missing lineup');
      // 1. Submit lineup: status → submitted, lock max_wager
      const { error: e1 } = await supabase
        .from('lineups')
        .update({ status: 'submitted', max_wager: wagerNum, submitted_at: new Date().toISOString(), locked_at: new Date().toISOString() })
        .eq('id', lineup.id);
      if (e1) throw e1;

      // 2. Insert into matchmaking queue
      const { error: e2 } = await supabase
        .from('matchmaking_queue')
        .insert({
          lineup_id: lineup.id,
          user_id: profile.id,
          entry_tier: wagerNum, // legacy mirror
          max_wager: wagerNum,
          game_date: new Date().toISOString().slice(0, 10),
        });
      if (e2) throw e2;
    },
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ['place-order-lineup'] });
      qc.invalidateQueries({ queryKey: ['player-market'] });
    },
  });

  // Pending order timer
  useEffect(() => {
    if (!submitted) return;
    const id = setInterval(() => setQueueSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [submitted]);

  // Loading
  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  // No lineup → bounce back
  if (!lineup || (lineup.lineup_players ?? []).length < LINEUP_SIZE) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.serif, fontSize: 28, color: HG.ink, marginBottom: 12 }}>
          No <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>lineup</Text> ready
        </Text>
        <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.muted, lineHeight: 21, marginBottom: 24 }}>
          Pick 3 players in the Market before placing an order.
        </Text>
        <Pressable
          onPress={() => router.replace('/(tabs)/lineup' as any)}
          style={{ height: 48, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Open Market
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Pending Order state
  if (submitted) {
    return <PendingOrderState lineup={lineup} wager={wagerNum} queueSec={queueSec} onCancel={() => router.replace('/(tabs)/matchups' as any)} />;
  }

  const picked = (lineup.lineup_players ?? []).sort((a: any, b: any) => a.slot_number - b.slot_number);
  const totalCost = picked.reduce((s: number, lp: any) => s + Number(lp.frozen_price), 0);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: HG.jet }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
              Order · Review
            </Text>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M18 6 6 18M6 6l12 12" />
              </Svg>
            </Pressable>
          </View>

          <Text style={{ fontFamily: FONT.serif, fontSize: 36, color: HG.ink, paddingHorizontal: 18, marginTop: 8, letterSpacing: -0.6 }}>
            Place <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Order</Text>
          </Text>

          {/* Lineup summary */}
          <View style={{ paddingHorizontal: 18, marginTop: 26 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 12 }}>
              Lineup
            </Text>
            <View style={{ backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, overflow: 'hidden' }}>
              {picked.map((lp: any, i: number) => (
                <View
                  key={lp.nba_players.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderColor: HG.hairline }}
                >
                  <MonogramTile initials={playerInitials(lp.nba_players)} jersey={lp.nba_players.jersey_number} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink }}>
                      {lp.nba_players.full_name}
                    </Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.sky, letterSpacing: 0.4, marginTop: 2 }}>
                      {lp.nba_players.ticker_handle ?? ''}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 15, color: HG.ink }}>
                    {fmtPrice(lp.frozen_price)}
                  </Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderColor: HG.hairline }}>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.6 }}>
                  Lineup total
                </Text>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: HG.ink }}>
                  {fmtPrice(totalCost)} <Text style={{ color: HG.muted }}>/ ${SALARY_CAP} cap</Text>
                </Text>
              </View>
            </View>
          </View>

          {/* Max wager */}
          <View style={{ paddingHorizontal: 18, marginTop: 36, alignItems: 'center' }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
              Max wager
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 12 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 36, color: validation.ok || !wager ? HG.muted2 : HG.down, marginRight: 4 }}>$</Text>
              <TextInput
                value={wager}
                onChangeText={setWager}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={HG.muted2}
                maxLength={6}
                style={{
                  fontFamily: FONT.monoMedium,
                  fontSize: 64,
                  color: validation.ok || !wager ? HG.ink : HG.down,
                  letterSpacing: -2,
                  minWidth: 110,
                  textAlign: 'center',
                  padding: 0,
                }}
              />
            </View>
            <Text
              style={{
                fontFamily: FONT.sans,
                fontSize: 12,
                color: validation.msg ? HG.down : HG.muted,
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              {validation.msg || validation.helper}
            </Text>

            {/* Quick tap presets */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
              {[5, 25, 50, 100, 500].map((v) => {
                const active = wagerNum === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setWager(String(v))}
                    style={{
                      paddingHorizontal: 14,
                      height: 32,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? HG.sky : HG.hairline2,
                      backgroundColor: active ? HG.skySoft : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: FONT.monoBold,
                        fontSize: 11,
                        color: active ? HG.sky : HG.muted,
                        letterSpacing: 0.6,
                      }}
                    >
                      ${v}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Swipe to place order */}
        <View
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28,
            backgroundColor: HG.jet, borderTopWidth: 1, borderTopColor: HG.hairline,
          }}
        >
          <SwipeToPlaceOrder
            enabled={validation.ok && !placeMutation.isPending}
            onConfirm={() => placeMutation.mutate()}
          />
          <Pressable
            onPress={() => placeMutation.mutate()}
            disabled={!validation.ok || placeMutation.isPending}
            style={{ alignItems: 'center', paddingVertical: 12, marginTop: 4 }}
          >
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: validation.ok ? HG.sky : HG.muted2, letterSpacing: 1, textTransform: 'uppercase' }}>
              {placeMutation.isPending ? 'Placing…' : 'Tap to place order'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// =============================================================================
// SWIPE-TO-CONFIRM track with Reanimated 4 PanGesture
// =============================================================================

function SwipeToPlaceOrder({ enabled, onConfirm }: { enabled: boolean; onConfirm: () => void }) {
  // CRITICAL: trackWidth must be a shared value, NOT a ref. Worklet handlers
  // (Gesture.Pan().onUpdate / onEnd) run on the UI thread and cannot read
  // `.current` from a JS-thread ref. Reading a stale ref is what kept the
  // gesture from firing in the first cut of this screen.
  const translateX = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const triggered = useRef(false);

  function fire() {
    if (triggered.current) return;
    triggered.current = true;
    onConfirm();
  }

  const pan = Gesture.Pan()
    .activeOffsetX(8)        // need 8px of movement before claiming the gesture
    .failOffsetY([-20, 20])  // give up if user is scrolling vertically
    .onUpdate((e) => {
      'worklet';
      const max = trackWidth.value - THUMB_SIZE - 8;
      if (max <= 0) return;
      translateX.value = Math.min(Math.max(0, e.translationX), max);
    })
    .onEnd(() => {
      'worklet';
      const max = trackWidth.value - THUMB_SIZE - 8;
      if (max > 0 && translateX.value >= max * 0.88) {
        translateX.value = withTiming(max, { duration: 120 });
        runOnJS(fire)();
      } else {
        translateX.value = withTiming(0, { duration: 220 });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Fill expands as the thumb moves; opacity also lifts so the user feels
  // the action arming.
  const fillStyle = useAnimatedStyle(() => {
    const tw = trackWidth.value || 1;
    return {
      width: translateX.value + THUMB_SIZE,
      opacity: 0.22 + Math.min(0.55, translateX.value / tw),
    };
  });

  return (
    <View
      onLayout={(e) => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
      style={{
        height: SWIPE_TRACK_HEIGHT,
        borderRadius: 999,
        backgroundColor: HG.surface,
        borderWidth: 1,
        borderColor: enabled ? HG.skyEdge : HG.hairline,
        overflow: 'hidden',
        justifyContent: 'center',
        position: 'relative',
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: HG.sky },
          fillStyle,
        ]}
      />
      <Text
        pointerEvents="none"
        style={{
          fontFamily: FONT.monoBold,
          fontSize: 12,
          color: HG.ink,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        Swipe to place order
      </Text>
      <GestureDetector gesture={pan}>
        <Animated.View
          // hitSlop on the thumb so users with thicker fingers can grab it
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[
            {
              position: 'absolute',
              left: 4,
              top: 4,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: 999,
              backgroundColor: HG.sky,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: HG.sky,
              shadowOpacity: 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 0 },
            },
            thumbStyle,
          ]}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={HG.jet} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 12h14M13 6l6 6-6 6" />
          </Svg>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// =============================================================================
// PENDING ORDER STATE — "In queue · 00:14"
// =============================================================================

function PendingOrderState({
  lineup, wager, queueSec, onCancel,
}: {
  lineup: any; wager: number; queueSec: number; onCancel: () => void;
}) {
  const mm = String(Math.floor(queueSec / 60)).padStart(2, '0');
  const ss = String(queueSec % 60).padStart(2, '0');
  const router = useRouter();
  const { profile } = useAuthStore();

  // Demo helper: until a real matchmaker Edge Fn exists, surface any pending
  // 'matched' matchup so the user can see Match Found (Screen 06.5) on demand.
  const { data: matchedDemo } = useQuery({
    queryKey: ['matched-demo', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('matchups')
        .select('id, status, matched_at')
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .eq('status', 'matched')
        .order('matched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!profile?.id,
    refetchInterval: 5000,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
        <View style={{ width: 22 }} />
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          Order · Pending
        </Text>
        <Pressable onPress={() => router.replace('/(tabs)/home' as any)} hitSlop={12}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M18 6 6 18M6 6l12 12" />
          </Svg>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 18, paddingTop: 36, alignItems: 'center' }}>
        <Text style={{ fontFamily: FONT.serif, fontSize: 36, color: HG.ink, letterSpacing: -0.6 }}>
          Order placed.
        </Text>
        <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.muted, marginTop: 10, textAlign: 'center', lineHeight: 21 }}>
          Looking for a match around your max wager.
        </Text>

        {/* Status pill */}
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            marginTop: 28,
            paddingHorizontal: 18, paddingVertical: 10,
            backgroundColor: HG.surface,
            borderRadius: 999,
            borderWidth: 1, borderColor: HG.skyEdge,
          }}
        >
          <PulsingDot />
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.ink, letterSpacing: 0.4 }}>
            In queue · {mm}:{ss}
          </Text>
        </View>

        <View style={{ marginTop: 36, padding: 18, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1, width: '100%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Max wager
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: HG.ink }}>{fmtPrice(wager)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Lineup
            </Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.ink }}>
              {(lineup?.lineup_players ?? []).map((lp: any) => playerLastName(lp.nba_players)).join(' · ')}
            </Text>
          </View>
        </View>

        {/* Demo handoff to Match Found — replaces the real matchmaker for now */}
        {matchedDemo?.id ? (
          <Pressable
            onPress={() => router.replace(`/matchup/found/${matchedDemo.id}` as any)}
            style={{
              marginTop: 28, height: 48, paddingHorizontal: 22,
              borderRadius: 999, backgroundColor: HG.sky,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              See your match
            </Text>
          </Pressable>
        ) : null}

        <Pressable onPress={onCancel} style={{ marginTop: matchedDemo?.id ? 12 : 24, padding: 12 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Cancel order
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function PulsingDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(0.35, { duration: 800 });
    const id = setInterval(() => {
      opacity.value = withTiming(opacity.value === 1 ? 0.35 : 1, { duration: 800 });
    }, 800);
    return () => clearInterval(id);
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[{ width: 8, height: 8, borderRadius: 999, backgroundColor: HG.sky }, style]} />
  );
}
