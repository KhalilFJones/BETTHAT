// =============================================================================
// BETTHAT — Match Found (Holy Grail V2.1, Screen 06.5)
// Diagonal split bg (you sky / opponent assigned color), ORDER FILLED eyebrow,
// VT323 wager hero with sequential char reveal, fight-card username strip,
// stacked lineups with stagger reveal, tipoff countdown CTA.
//
// Auto-routes from Place Order Pending when matchup status flips to 'matched'.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, opponentColor, playerInitials, playerLastName,
} from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

// =============================================================================
// MAIN SCREEN
// =============================================================================

export default function MatchFoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['match-found', id],
    queryFn: async () => {
      if (!id) throw new Error('No matchup id');
      const { data, error } = await supabase
        .from('matchups')
        .select(`
          id, status, settled_wager, user1_max_wager, user2_max_wager,
          payout_amount, pot_amount, user1_id, user2_id, matched_at,
          u1:profiles!user1_id(id, username, display_name, total_wins, total_losses),
          u2:profiles!user2_id(id, username, display_name, total_wins, total_losses),
          l1:lineups!lineup1_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price,
              nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation))),
          l2:lineups!lineup2_id(id, total_cap_used,
            lineup_players(slot_number, frozen_price,
              nba_players(id, full_name, first_name, last_name, ticker_handle, position, jersey_number, team_abbreviation))),
          matchup_games(game_id,
            nba_games(id, tip_off_time, home_team_abbreviation, away_team_abbreviation, status))
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  // Tipoff countdown
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  const meIs1 = data.user1_id === profile?.id;
  const me = meIs1 ? data.u1 : data.u2;
  const opp = meIs1 ? data.u2 : data.u1;
  const myLineup = meIs1 ? data.l1 : data.l2;
  const oppLineup = meIs1 ? data.l2 : data.l1;
  const myBid = Number(meIs1 ? data.user1_max_wager : data.user2_max_wager ?? 0);
  const oppBid = Number(meIs1 ? data.user2_max_wager : data.user1_max_wager ?? 0);
  const settled = Number(data.settled_wager ?? 0);
  const slippage = myBid > settled ? myBid - settled : 0;

  const oppAccent = opponentColor(opp?.username ?? 'unknown');

  const firstTipoff = (data.matchup_games ?? [])
    .map((mg: any) => mg.nba_games?.tip_off_time)
    .filter(Boolean)
    .map((s: string) => new Date(s).getTime())
    .sort((a: number, b: number) => a - b)[0];

  const secsUntilTipoff = firstTipoff ? Math.max(0, Math.floor((firstTipoff - now) / 1000)) : 0;
  const tipoffNear = secsUntilTipoff > 0 && secsUntilTipoff <= 120;
  const tipoffStarted = secsUntilTipoff === 0 && firstTipoff && firstTipoff <= now;
  const tipoffMm = String(Math.floor(secsUntilTipoff / 60)).padStart(2, '0');
  const tipoffSs = String(secsUntilTipoff % 60).padStart(2, '0');

  return (
    <View style={{ flex: 1, backgroundColor: HG.jet }}>
      <DiagonalSplit oppColor={oppAccent} />

      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Top eyebrow */}
        <View style={{ paddingTop: 8, alignItems: 'center' }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: 'rgba(232,237,242,0.45)', letterSpacing: 2.5, textTransform: 'uppercase' }}>
            Order · Filled
          </Text>
        </View>

        {/* Wager hero — VT323 LED scoreboard */}
        <View style={{ alignItems: 'center', paddingTop: 28 }}>
          <WagerHero amount={settled} />
          <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.ink, marginTop: 10, letterSpacing: 0.2 }}>
            You matched at <Text style={{ fontFamily: FONT.monoMedium, color: HG.ink }}>{fmtPrice(settled)}</Text>
          </Text>
          {slippage > 0 ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted, marginTop: 6 }}>
              You bid <Text style={{ fontFamily: FONT.monoMedium }}>{fmtPrice(myBid)}</Text>
              {' · '}
              <Text style={{ fontFamily: FONT.monoMedium }}>{fmtPrice(slippage)}</Text> returned to wallet
            </Text>
          ) : null}
        </View>

        {/* Fight-card strip */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginTop: 28 }}>
          <FighterCorner profile={me} accent={HG.sky} align="left" />
          <Text style={{ fontFamily: FONT.serifItalic, fontSize: 18, color: HG.muted, letterSpacing: 0.4 }}>vs</Text>
          <FighterCorner profile={opp} accent={oppAccent} align="right" />
        </View>

        {/* Lineups */}
        <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: 16, marginTop: 36, gap: 12 }}>
          <LineupColumn label="Your lineup" accent={HG.sky} lineup={myLineup} />
          <LineupColumn label="Opponent" accent={oppAccent} lineup={oppLineup} />
        </View>

        {/* Bottom CTA */}
        <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22, gap: 8 }}>
          {firstTipoff && !tipoffNear && !tipoffStarted ? (
            <>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, textAlign: 'center', letterSpacing: 1.6, textTransform: 'uppercase' }}>
                Tipoff in {tipoffMm}:{tipoffSs}
              </Text>
              <Pressable
                onPress={() => router.replace(`/matchup/${data.id}` as any)}
                style={{ height: 48, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: HG.jet, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                  View matchup
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => router.replace(`/matchup/${data.id}` as any)}
              style={{ height: 52, borderRadius: 999, backgroundColor: HG.sky, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: HG.jet, letterSpacing: 1.6, textTransform: 'uppercase' }}>
                Open Live Board
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

// =============================================================================
// DIAGONAL SPLIT BACKGROUND
// Sky on the left, opponent color on the right, diagonal from top-right to
// bottom-left, both fading to black at their outer edges and at the bottom.
// =============================================================================

function DiagonalSplit({ oppColor }: { oppColor: string }) {
  // Use Reanimated to slide both halves in from opposite edges (300ms).
  const tx = useSharedValue(120);
  useEffect(() => {
    tx.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) });
  }, []);
  const leftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -tx.value }] }));
  const rightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '60%' }}>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, leftStyle]}>
        <Svg height="100%" width="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="leftGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={HG.sky} stopOpacity="0.55" />
              <Stop offset="0.6" stopColor={HG.sky} stopOpacity="0.18" />
              <Stop offset="1" stopColor={HG.jet} stopOpacity="0.95" />
            </LinearGradient>
          </Defs>
          {/* Left polygon: takes top-left corner + diagonal */}
          <Path d="M 0 0 L 70 0 L 30 100 L 0 100 Z" fill="url(#leftGrad)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, rightStyle]}>
        <Svg height="100%" width="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="rightGrad" x1="1" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={oppColor} stopOpacity="0.6" />
              <Stop offset="0.6" stopColor={oppColor} stopOpacity="0.2" />
              <Stop offset="1" stopColor={HG.jet} stopOpacity="0.95" />
            </LinearGradient>
          </Defs>
          {/* Right polygon: complements the left */}
          <Path d="M 70 0 L 100 0 L 100 100 L 30 100 Z" fill="url(#rightGrad)" />
        </Svg>
      </Animated.View>
      {/* Bottom-of-split fade into jet for the lineup section */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 }}>
        <Svg height="100%" width="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={HG.jet} stopOpacity="0" />
              <Stop offset="1" stopColor={HG.jet} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Path d="M 0 0 L 1 0 L 1 1 L 0 1 Z" fill="url(#bottomFade)" />
        </Svg>
      </View>
    </View>
  );
}

// =============================================================================
// WAGER HERO — VT323 scoreboard text with sequential character reveal
// =============================================================================

function WagerHero({ amount }: { amount: number }) {
  const text = '$' + Math.round(amount);
  const chars = text.split('');

  // Each character has its own shared value for opacity + small scale, staged
  // in by index so the dollar sign lights first, then each digit.
  const opacities = chars.map(() => useSharedValue(0));
  const scales = chars.map(() => useSharedValue(0.85));

  useEffect(() => {
    chars.forEach((_, i) => {
      opacities[i].value = withDelay(
        420 + i * 140,
        withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) })
      );
      scales[i].value = withDelay(
        420 + i * 140,
        withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) })
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      {chars.map((c, i) => {
        const styleAnim = useAnimatedStyle(() => ({
          opacity: opacities[i].value,
          transform: [{ scale: scales[i].value }],
        }));
        return (
          <Animated.Text
            key={i}
            style={[
              {
                fontFamily: FONT.hero,
                fontSize: 132,
                color: HG.sky,
                letterSpacing: 4,
                lineHeight: 132,
                // VT323 looks best with a slight glow shadow
                textShadowColor: HG.sky,
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 16,
              },
              styleAnim,
            ]}
          >
            {c}
          </Animated.Text>
        );
      })}
    </View>
  );
}

// =============================================================================
// FIGHT-CARD CORNER
// =============================================================================

function FighterCorner({ profile, accent, align }: { profile: any; accent: string; align: 'left' | 'right' }) {
  const wins = Number(profile?.total_wins ?? 0);
  const losses = Number(profile?.total_losses ?? 0);
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const username = profile?.username ?? '—';

  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end', maxWidth: 130 }}>
      <View style={{ position: 'relative' }}>
        <MonogramTile
          initials={(profile?.display_name ?? username ?? '??').slice(0, 2).toUpperCase()}
          size={48}
          showJersey={false}
        />
        {/* Accent dot — colored marker so you can tell which side is whose */}
        <View
          style={{
            position: 'absolute',
            top: -3,
            [align === 'left' ? 'left' : 'right']: -3,
            width: 14,
            height: 14,
            borderRadius: 999,
            backgroundColor: accent,
            borderWidth: 2,
            borderColor: HG.jet,
          }}
        />
      </View>
      <Text
        numberOfLines={1}
        style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: HG.ink, marginTop: 8, letterSpacing: -0.2 }}
      >
        {username}
      </Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: 'rgba(232,237,242,0.55)', marginTop: 2, letterSpacing: 0.4 }}>
        {wins}–{losses} · {winRate}% WR
      </Text>
    </View>
  );
}

// =============================================================================
// LINEUP COLUMN — stagger-reveal rows
// =============================================================================

function LineupColumn({ label, accent, lineup }: { label: string; accent: string; lineup: any }) {
  const players = ((lineup?.lineup_players ?? []) as any[]).sort((a, b) => a.slot_number - b.slot_number);
  return (
    <View style={{ flex: 1, gap: 8 }}>
      <Text
        style={{
          fontFamily: FONT.monoMedium,
          fontSize: 10,
          color: 'rgba(232,237,242,0.55)',
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          marginBottom: 4,
          paddingHorizontal: 4,
        }}
      >
        {label}
      </Text>
      {players.map((lp, i) => (
        <LineupRow key={lp.nba_players?.id ?? i} index={i} accent={accent} lp={lp} />
      ))}
    </View>
  );
}

function LineupRow({ index, accent, lp }: { index: number; accent: string; lp: any }) {
  const opacity = useSharedValue(0);
  const ty = useSharedValue(12);
  useEffect(() => {
    // Wait for wager hero animation, then stagger rows
    const baseDelay = 900 + index * 110;
    opacity.value = withDelay(baseDelay, withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }));
    ty.value = withDelay(baseDelay, withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }],
  }));

  const p = lp.nba_players;
  return (
    <Animated.View
      style={[
        {
          backgroundColor: HG.surface,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: HG.hairline,
          padding: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          // Left-edge accent ribbon
          borderLeftWidth: 3,
          borderLeftColor: accent,
        },
        aStyle,
      ]}
    >
      <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={32} showJersey={false} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: HG.ink }}>
          {playerLastName(p)}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 0.4, marginTop: 1 }}>
          {p.ticker_handle ?? p.team_abbreviation}
        </Text>
      </View>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.ink }}>
        {fmtPrice(lp.frozen_price)}
      </Text>
    </Animated.View>
  );
}
