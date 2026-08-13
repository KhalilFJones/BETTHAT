// =============================================================================
// BETTHAT — Game Setup (Figma redesign)
// The screen the Draft Market's "Continue to Wager" lands on, once 3 players
// are locked in. Pixel spec sourced from the Figma dev-mode CSS export for the
// "Market / Game Setup" frame (393x852).
//
// Two full-bleed white cards (radius 20, shadow 0 2px 8px rgba(21,21,23,.05))
// on the Greyscale/50 (#F4F4F4) page background, 8px apart:
//   1. Top Bar card — back / "Game Setup" / help round buttons, "Salary Cap"
//      + "Remaining : $x" over a 10px accent progress track, "Player Price
//      Freeze" + mm:ss countdown, then the three picked players as the spec's
//      "Stock" rows (circle initial, ticker + full name/position, 80x40
//      dashed-midline graph, price, triangle + % change).
//   2. Wager card — "Wager Amount" + wallet balance, a nested container with
//      the Value ($) field, Quick Wager pills, the read-only Potential Payout
//      field, and the dark (#151517) "Find Match" button.
//
// Price-direction green/red are the spec's row-level tokens (#36A34C /
// #F05D5D == theme.gain / theme.danger), NOT theme.up/theme.down.
// =============================================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Animated, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { placeLineupOrder, cancelLineupOrder } from '@/services/matchup';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, fmtTime, playerInitials, playerLastName, SALARY_CAP, MIN_WAGER, LINEUP_SIZE } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { PriceGraph } from '@/components/market/PriceGraph';
import { StockRow } from '@/components/market/StockRow';

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
  const [helpOpen, setHelpOpen] = useState(false);

  const wagerNum = Number(wager);
  const balance = Number(wallet?.balance ?? 0);

  const validation = useMemo(() => {
    // Figma's "Hint Text" slot under the field is display:none in the resting
    // state — it only surfaces to carry a validation error.
    if (!wager) return { ok: false, msg: '' };
    if (!Number.isFinite(wagerNum)) return { ok: false, msg: 'Enter a number' };
    if (wagerNum < MIN_WAGER) return { ok: false, msg: `Minimum wager is $${MIN_WAGER}` };
    if (wagerNum > balance) return { ok: false, msg: 'Insufficient buying power. Deposit to continue.' };
    return { ok: true, msg: '' };
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

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24, gap: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ═══ Top Bar card ═══════════════════════════════════════════════ */}
        {/* `overflow: hidden` is deliberately omitted (the export has it) —
            on iOS it clips the card's own drop shadow, and nothing in this
            flow layout bleeds past the radius. */}
        <View style={cardShadow(theme)}>
          {/* Title Container */}
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <RoundIconBtn theme={theme} label="Go back" onPress={() => router.back()}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m15 18-6-6 6-6" />
              </Svg>
            </RoundIconBtn>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, lineHeight: 23.4, color: theme.ink, letterSpacing: -0.18 }}>Game Setup</Text>
            <RoundIconBtn theme={theme} label="Help" onPress={() => setHelpOpen(true)}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                <Path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.6" />
                <Path d="M12 17h.01" />
              </Svg>
            </RoundIconBtn>
          </View>

          {/* Salary Cap + Player Price Freeze — the export's 361x107 block:
              cap row (27) · 6 · track (10) · 13 · freeze row (27) */}
          <View style={{ paddingHorizontal: 16, gap: 13 }}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={headline(theme)}>Salary Cap</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={headline(theme)}>Remaining :</Text>
                  <Text style={headline(theme)}>{fmtPrice(Math.max(0, SALARY_CAP - totalCost))}</Text>
                </View>
              </View>
              <View style={{ height: 10, borderRadius: 10, backgroundColor: theme.hairline, overflow: 'hidden', marginTop: 6 }}>
                <View style={{ width: `${capPct}%`, height: '100%', borderRadius: 10, backgroundColor: theme.accent }} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={headline(theme)}>Player Price Freeze</Text>
              <FreezeCountdown theme={theme} freezeAt={freezeAt} />
            </View>
          </View>

          {/* Stock rows — the picked lineup. The export puts this 369-wide
              stack at left 12 / top 214, i.e. 24px below the freeze row. */}
          <View style={{ paddingHorizontal: 12, paddingTop: 24, paddingBottom: 16, gap: 14 }}>
            {picked.map((lp: any) => (
              <StockRow
                key={lp.nba_players.id}
                theme={theme}
                player={lp.nba_players}
                price={lp.frozen_price}
                prices={sparkHistory?.get(lp.nba_players.id) ?? []}
                onPress={() => router.push(`/player/${lp.nba_players.id}` as any)}
              />
            ))}
          </View>
        </View>

        {/* ═══ Wager card ═════════════════════════════════════════════════ */}
        <View style={[cardShadow(theme), { padding: 16, gap: 16 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={headline(theme)}>Wager Amount</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: theme.faint }}>Wallet Amount :</Text>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, lineHeight: 16.5, color: theme.faint }}>{balance.toFixed(2)}</Text>
            </View>
          </View>

          {/* Nested input container */}
          <View style={[cardShadow(theme), { padding: 16, gap: 12 }]}>
            {/* Value ($) */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color: theme.ink }}>Value ($)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 12, gap: 4, backgroundColor: theme.surfaceSunken, borderRadius: 8 }}>
                <Text style={{ fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: wager ? (validation.ok ? theme.ink : theme.danger) : theme.faint }}>$</Text>
                <TextInput
                  value={wager}
                  onChangeText={(v) => setWager(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={theme.faint}
                  maxLength={7}
                  accessibilityLabel="Wager amount in dollars"
                  style={{
                    flex: 1, padding: 0,
                    fontFamily: FONT.sans, fontSize: 16,
                    color: validation.ok || !wager ? theme.ink : theme.danger,
                  }}
                />
              </View>
              {validation.msg ? (
                <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.danger }}>{validation.msg}</Text>
              ) : null}
            </View>

            {/* Quick Wager — 15px label, buttons start at y=27 → 12px gap */}
            <View style={{ gap: 12 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 10, lineHeight: 15, color: theme.faint }}>Quick Wager</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {QUICK_WAGERS.map((v) => {
                  const active = wagerNum === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setWager(String(v))}
                      style={{
                        height: 36, paddingHorizontal: 16, borderRadius: 100,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: active ? theme.accentEdge : theme.hairline,
                        backgroundColor: active ? theme.accentSoft : theme.surface,
                      }}
                    >
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, lineHeight: 18.6, color: theme.ink }}>${v} Bet</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Potential Payout — read-only field. Label and value both sit in
                Greyscale/300 in the export: it reads as a disabled output, not
                an editable input. */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color: theme.faint }}>Potential Payout</Text>
              <View style={{ height: 48, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: theme.surfaceSunken, borderRadius: 8 }}>
                <Text style={{ fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.faint }}>
                  {payout ? fmtPrice(payout.payout) : '$0.00'}
                </Text>
              </View>
            </View>
          </View>

          {/* Find Match */}
          <Pressable
            onPress={() => placeMutation.mutate()}
            disabled={!validation.ok || placeMutation.isPending}
            style={{
              height: 48, borderRadius: 100, alignItems: 'center', justifyContent: 'center', marginTop: 14,
              backgroundColor: validation.ok ? theme.ink : theme.surfaceSunken,
              opacity: placeMutation.isPending ? 0.6 : 1,
            }}
          >
            {placeMutation.isPending ? (
              <ActivityIndicator color={validation.ok ? theme.surface : theme.muted} />
            ) : (
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 25, color: validation.ok ? theme.surface : theme.faint }}>
                Find Match
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <HelpSheet theme={theme} visible={helpOpen} onClose={() => setHelpOpen(false)} />
    </SafeAreaView>
  );
}

/** Figma "Body / Large / Semibold" — the 18px/27 headline used throughout this frame. */
function headline(theme: Theme) {
  return { fontFamily: FONT.sansBold, fontSize: 18, lineHeight: 27, color: theme.ink } as const;
}

// =============================================================================
// TOP BAR PIECES
// =============================================================================

/** Figma "Button/Secondary" — 40x40 pill, Greyscale/100 border on the surface. */
function RoundIconBtn({ theme, label, onPress, children }: { theme: Theme; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      style={{
        width: 40, height: 40, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
      }}
    >
      {children}
    </Pressable>
  );
}

// =============================================================================
// HELP SHEET — what the "?" button in the title bar explains
// =============================================================================

function HelpSheet({ theme, visible, onClose }: { theme: Theme; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 }}
        >
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <View style={{ width: 40, height: 5, borderRadius: 100, backgroundColor: theme.hairline2 }} />
          </View>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink, marginBottom: 14 }}>How this works</Text>
          <HelpRow theme={theme} title="Salary Cap" body={`Your 3 players have to fit inside the $${SALARY_CAP} cap. "Remaining" is what you didn't spend — it doesn't carry into scoring.`} />
          <HelpRow theme={theme} title="Player Price Freeze" body="The prices you drafted at are locked in until this countdown hits zero (first tip-off among your players). After that, prices re-float for everyone else." />
          <HelpRow theme={theme} title="Wager Amount" body={`Minimum $${MIN_WAGER}. We hold this from your wallet while we look for an opponent, and release it if you cancel before a match lands.`} />
          <HelpRow theme={theme} title="Potential Payout" body="Both sides stake the same amount. Payout is the pot minus a 3.5% rake — winner takes all." last />
          <Pressable onPress={onClose} style={{ height: 48, borderRadius: 100, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', marginTop: 20 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.bg }}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HelpRow({ theme, title, body, last }: { theme: Theme; title: string; body: string; last?: boolean }) {
  return (
    <View style={{ paddingBottom: last ? 0 : 14, marginBottom: last ? 0 : 14, borderBottomWidth: last ? 0 : 1, borderColor: theme.hairline }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: theme.ink, marginBottom: 4 }}>{title}</Text>
      <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, lineHeight: 19 }}>{body}</Text>
    </View>
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
  // Figma renders this as plain right-aligned Body/Large/Semibold text (no pill,
  // no dot) — the only deviation is turning it red inside the final minute.
  return (
    <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: urgent ? theme.danger : theme.ink, textAlign: 'right' }}>
      {label}
    </Text>
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
  const [helpOpen, setHelpOpen] = useState(false);

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

  // Priciest pick takes the hero (center, ringed) slot in the avatar cluster;
  // the other two flank it rotated ±15°, per the export's 206x78 group.
  const picked = ((lineup?.lineup_players ?? []) as any[]).slice().sort((a, b) => a.slot_number - b.slot_number);
  const byPrice = picked.slice().sort((a, b) => Number(b.frozen_price) - Number(a.frozen_price));
  const [hero, leftPick, rightPick] = byPrice;
  const totalCost = picked.reduce((sum, lp) => sum + Number(lp.frozen_price), 0);
  const leftoverSalary = Math.max(0, SALARY_CAP - totalCost);
  const { pot, rake, payout } = potentialPayout(wager);
  const freezeAt = computeFreezeAt(picked, lineup?.created_at ?? new Date().toISOString());
  const matched = !!matchedDemo?.id;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 8 }} showsVerticalScrollIndicator={false}>
        {/* ═══ Top Bar card ═══════════════════════════════════════════════ */}
        <View style={cardShadow(theme)}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <RoundIconBtn theme={theme} label="Close" onPress={() => router.replace('/(tabs)/home' as any)}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M18 6 6 18M6 6l12 12" />
              </Svg>
            </RoundIconBtn>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, lineHeight: 23.4, color: theme.ink, letterSpacing: -0.18 }}>Order Details</Text>
            <RoundIconBtn theme={theme} label="Help" onPress={() => setHelpOpen(true)}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                <Path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.6" />
                <Path d="M12 17h.01" />
              </Svg>
            </RoundIconBtn>
          </View>
        </View>

        {/* ═══ Receipt card ═══════════════════════════════════════════════ */}
        <View style={[cardShadow(theme), { padding: 16, gap: 8 }]}>
          <View style={{ backgroundColor: theme.surfaceSunken, borderRadius: 16, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>
            {/* Avatar cluster — 206x78, overflow-clipped so the hero circle
                bleeds into the white body below, as in the export. */}
            <View style={{ paddingTop: 24, paddingHorizontal: 12, alignItems: 'center' }}>
              <View style={{ width: 206, height: 78, overflow: 'hidden' }}>
                {leftPick ? <ClusterAvatar player={leftPick.nba_players} size={64} left={-3.38} top={40.37} rotate="-15deg" /> : null}
                {rightPick ? <ClusterAvatar player={rightPick.nba_players} size={64} left={148.56} top={23.81} rotate="15deg" /> : null}
                {hero ? <ClusterAvatar player={hero.nba_players} size={96} left={55.5} top={6} ring /> : null}
              </View>
            </View>

            {/* Body */}
            <View style={{ backgroundColor: theme.surface, paddingHorizontal: 12, paddingVertical: 16, alignItems: 'center', gap: 9 }}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, lineHeight: 31.2, color: theme.ink }}>
                  Order #{orderNumber(matchupId)}
                </Text>
                <Text style={{ fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.muted }}>3v3 Head to Head</Text>
              </View>

              <View style={{ alignSelf: 'stretch', gap: 16 }}>
                <ReceiptSection theme={theme} title="Wager Summary">
                  <ReceiptRow theme={theme} label="Your Entry" value={wager.toFixed(2)} />
                  <ReceiptRow theme={theme} label="Potential Opponent Stake" value={wager.toFixed(2)} />
                  <ReceiptRow theme={theme} label="Prize Pool" value={pot.toFixed(2)} />
                  <ReceiptRow theme={theme} label="Rake (3.5%)" value={`-${rake.toFixed(2)}`} />
                  <ReceiptRow theme={theme} label="Potential Payout" value={`+${fmtPrice(payout)}`} valueColor={theme.gain} />
                </ReceiptSection>

                <ReceiptSection theme={theme} title="Player Draft">
                  {picked.map((lp: any) => (
                    <ReceiptRow
                      key={lp.nba_players.id}
                      theme={theme}
                      label={lp.nba_players.full_name}
                      value={fmtPrice(lp.frozen_price)}
                      onPress={() => router.push(`/player/${lp.nba_players.id}` as any)}
                    />
                  ))}
                  <ReceiptRow theme={theme} label="Leftover Salary" value={fmtPrice(leftoverSalary)} />
                </ReceiptSection>

                <ReceiptSection theme={theme} title="Game Details">
                  <ReceiptRow theme={theme} label="Scoring" value="Standard" />
                  <ReceiptRow theme={theme} label="Lineup Locks" value={`${fmtTime(new Date(freezeAt))} ET`} />
                </ReceiptSection>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ═══ Bottom Bar ═══════════════════════════════════════════════════ */}
      <View style={{ backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.bg }}>
        <SafeAreaView edges={['bottom']}>
          <View style={{ padding: 16, gap: 12 }}>
            <Pressable
              onPress={matched ? () => router.replace(`/matchup/found/${matchedDemo!.id}` as any) : undefined}
              disabled={!matched}
              style={{
                height: 48, borderRadius: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: theme.ink,
              }}
            >
              {!matched ? <PulsingDot theme={theme} /> : null}
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.surface, textAlign: 'center' }}>
                {matched ? 'View Matchup →' : 'Looking for an opponent...'}
              </Text>
            </Pressable>

            {/* Not in the export, but the only way to release the escrowed
                stake once an order is live — keeping it as a quiet text link
                under the primary button. */}
            {!matched ? (
              <Pressable
                onPress={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                style={{ alignItems: 'center', paddingVertical: 2, opacity: cancelMutation.isPending ? 0.5 : 1 }}
              >
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, lineHeight: 20, color: theme.muted }}>
                  {cancelMutation.isPending ? 'Cancelling…' : `Cancel order · in queue ${mm}:${ss}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </View>

      <HelpSheet theme={theme} visible={helpOpen} onClose={() => setHelpOpen(false)} />
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

/**
 * One circle in the Order Details hero cluster. The export uses dark (#0D0D12)
 * logo pucks; with no player photography in the schema these carry the
 * monogram instead. Rotation pivots on the top-left corner, matching Figma's
 * transform-origin so the published left/top offsets land correctly.
 */
function ClusterAvatar({
  player, size, left, top, rotate, ring,
}: {
  player: any; size: number; left: number; top: number; rotate?: string; ring?: boolean;
}) {
  return (
    <View
      style={{
        position: 'absolute', left, top, width: size, height: size, borderRadius: size,
        backgroundColor: '#0D0D12', alignItems: 'center', justifyContent: 'center',
        borderWidth: ring ? 2.4 : 0, borderColor: '#FFFFFF',
        transform: rotate ? [{ rotate }] : undefined,
        transformOrigin: 'top left',
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 2.5, shadowOffset: { width: 2.5, height: 2.5 },
      }}
    >
      <Text style={{ fontFamily: FONT.sansBold, fontSize: Math.round(size * 0.34), color: '#FFFFFF', letterSpacing: -0.5 }}>
        {playerInitials(player)}
      </Text>
    </View>
  );
}

/** Figma section: 16/500 title · gap 4 · rows stack at gap 8. */
function ReceiptSection({ theme, title, children }: { theme: Theme; title: string; children: ReactNode }) {
  return (
    <View style={{ alignSelf: 'stretch', gap: 4 }}>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>{title}</Text>
      <View style={{ alignSelf: 'stretch', gap: 8 }}>{children}</View>
    </View>
  );
}

function ReceiptRow({
  theme, label, value, valueColor, onPress,
}: {
  theme: Theme; label: string; value: string; valueColor?: string; onPress?: () => void;
}) {
  const body = (
    <>
      <Text style={{ flex: 1, fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.muted }}>{label}</Text>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: valueColor ?? theme.ink, textAlign: 'right' }}>
        {value}
      </Text>
    </>
  );
  const style = { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 } as const;
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityLabel={`View ${label}`} style={style}>
      {body}
    </Pressable>
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
