// =============================================================================
// BETTHAT — Player Detail (Holy Grail V2, Screen 05)
// Header + monogram + price + OVERALL dial + 5 stat dials + data tiles + news.
// =============================================================================

import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import {
  HG, FONT, fmtPrice, fmtPct, fmtFP, priceDirectionColor,
  playerInitials, playerLastName, LINEUP_SIZE,
} from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';
import { recomputeLineupCap } from '@/hooks/holygrail/lineupOps';

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuthStore();

  // ──────────────────────────────────────────────────────────────────────────
  // ALL HOOKS at the top. Never put a hook below an early return.
  // ──────────────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['player-detail', id, profile?.id],
    queryFn: async () => {
      if (!id) throw new Error('No player id');
      const [playerQ, lineupQ] = await Promise.all([
        supabase.from('nba_players').select(`
          *,
          player_prices(*),
          player_news(*)
        `).eq('id', id).single(),
        profile?.id
          ? supabase
              .from('lineups')
              .select('id, total_cap_used, lineup_players(player_id, slot_number, frozen_price)')
              .eq('user_id', profile.id)
              .eq('status', 'building')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (playerQ.error) throw playerQ.error;
      return { player: playerQ.data, lineup: lineupQ.data };
    },
    enabled: !!id,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !data) throw new Error('Not ready');
      const p: any = data.player;
      const pp = Array.isArray(p.player_prices) ? p.player_prices[0] : p.player_prices;
      if (!pp) throw new Error('No price');

      let lineupId = data.lineup?.id;
      if (!lineupId) {
        const { data: l, error } = await supabase
          .from('lineups')
          .insert({
            user_id: profile.id,
            entry_tier: 25,
            status: 'building',
            total_cap_used: 0,
            game_date: new Date().toISOString().slice(0, 10),
          })
          .select('id')
          .single();
        if (error) throw error;
        lineupId = l.id;
      }
      const used = new Set((data.lineup?.lineup_players ?? []).map((lp: any) => lp.slot_number));
      const slot = [1, 2, 3].find((n) => !used.has(n));
      if (!slot) throw new Error('Lineup full');
      const { error: insErr } = await supabase.from('lineup_players').insert({
        lineup_id: lineupId,
        player_id: p.id,
        slot_number: slot,
        frozen_price: pp.current_price,
      });
      if (insErr) throw insErr;
      await recomputeLineupCap(lineupId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-detail', id] });
      qc.invalidateQueries({ queryKey: ['player-market'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!data?.lineup?.id) return;
      const p: any = data.player;
      const { error } = await supabase
        .from('lineup_players')
        .delete()
        .eq('lineup_id', data.lineup.id)
        .eq('player_id', p.id);
      if (error) throw error;
      await recomputeLineupCap(data.lineup.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-detail', id] });
      qc.invalidateQueries({ queryKey: ['player-market'] });
    },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Early returns (after hooks).
  // ──────────────────────────────────────────────────────────────────────────
  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: HG.jet, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HG.sky} />
      </SafeAreaView>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────
  const p: any = data.player;
  const pp = Array.isArray(p.player_prices) ? p.player_prices[0] : p.player_prices;
  const news = (p.player_news ?? []).slice(0, 3);
  const isInLineup = (data.lineup?.lineup_players ?? []).some((lp: any) => lp.player_id === p.id);
  const isFull = (data.lineup?.lineup_players ?? []).length >= LINEUP_SIZE;
  const isLocked = pp?.is_locked;

  const ctaLabel =
    isLocked ? 'Out — not draftable' :
    isInLineup ? 'Added · Tap to remove' :
    isFull ? 'Lineup full · remove a player' :
    `Add ${playerLastName(p)} · ${fmtPrice(pp?.current_price)}`;
  const ctaDisabled = isLocked || (isFull && !isInLineup) || addMutation.isPending || removeMutation.isPending;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, letterSpacing: 1.6, color: HG.muted, textTransform: 'uppercase' }}>
          Player · Detail
        </Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Hero */}
        <View style={{ paddingHorizontal: 18, paddingTop: 24, paddingBottom: 20 }}>
          <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={120} />
          <Text style={{ fontFamily: FONT.serif, fontSize: 36, color: HG.ink, marginTop: 22, lineHeight: 38, letterSpacing: -0.6 }}>
            {p.full_name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 10 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: HG.sky, letterSpacing: 0.6 }}>
              {p.ticker_handle}
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              {p.team_abbreviation} · {p.position} · #{p.jersey_number}
            </Text>
          </View>
        </View>

        {/* Price strip */}
        <View style={{ paddingHorizontal: 18, marginBottom: 16, flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 44, color: HG.ink, letterSpacing: -0.8 }}>
            {fmtPrice(pp?.current_price)}
          </Text>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: priceDirectionColor(pp?.price_change_pct_24h) }}>
            {fmtPct(pp?.price_change_pct_24h)} · 24h
          </Text>
        </View>

        {/* SCRUM-128: Demand chip */}
        <PlayerDemandChip demand={pp?.demand_count_1h ?? 0} />

        {/* Last-5 FPTS breakdown (SCRUM-128) */}
        <Last5Breakdown player={p} />

        {/* OVERALL + 5 stat dials */}
        <DialGrid player={p} />

        {/* Data tiles */}
        <View style={{ paddingHorizontal: 18, marginTop: 28 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, marginBottom: 12 }}>
            <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Quick</Text> tiles
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <DataTile label="Last 5 FPTS" value={fmtFP(p.last5_avg_fpts)} />
            <DataTile label="Season FPTS" value={fmtFP(p.season_avg_fpts)} />
            <DataTile label="Games played" value={String(p.season_games_played ?? '—')} />
            <DataTile label="Salary tier" value={p.salary_tier ?? '—'} mono={false} />
          </View>
        </View>

        {/* News */}
        {news.length > 0 ? (
          <View style={{ paddingHorizontal: 18, marginTop: 28 }}>
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, marginBottom: 12 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Latest</Text> news
            </Text>
            {news.map((n: any) => (
              <View key={n.id} style={{ paddingVertical: 14, borderTopWidth: 1, borderColor: HG.hairline }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: HG.ink, lineHeight: 19 }}>{n.headline}</Text>
                {n.body ? (
                  <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, marginTop: 4, lineHeight: 18 }}>{n.body}</Text>
                ) : null}
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, marginTop: 6, letterSpacing: 0.6 }}>
                  {n.source ?? ''} · {new Date(n.published_at).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Persistent CTA */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24,
          backgroundColor: HG.jet, borderTopWidth: 1, borderTopColor: HG.hairline,
        }}
      >
        <Pressable
          onPress={() => {
            if (ctaDisabled) return;
            if (isInLineup) removeMutation.mutate();
            else addMutation.mutate();
          }}
          disabled={ctaDisabled}
          style={{
            height: 52, borderRadius: 999,
            backgroundColor: ctaDisabled ? HG.surface : isInLineup ? HG.surface : HG.sky,
            borderWidth: ctaDisabled || isInLineup ? 1 : 0,
            borderColor: HG.hairline,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{
            fontFamily: FONT.monoBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase',
            color: ctaDisabled ? HG.muted2 : isInLineup ? HG.ink : HG.jet,
          }}>
            {ctaLabel}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// =============================================================================
// STAT DIAL grid
// =============================================================================

function DialGrid({ player }: { player: any }) {
  const overall = Math.min(99, Math.max(40, Math.round((player.season_avg_fpts ?? 0) * 1.55)));
  const dials = [
    { label: 'PTS', value: player.season_avg_pts, max: 35 },
    { label: 'REB', value: player.season_avg_reb, max: 14 },
    { label: 'AST', value: player.season_avg_ast, max: 12 },
    { label: 'STL', value: player.season_avg_stl, max: 2.5 },
    { label: 'BLK', value: player.season_avg_blk, max: 3 },
  ];

  return (
    <View style={{ paddingHorizontal: 18 }}>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Dial value={overall} max={99} label="Overall" big />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
        {dials.map((d) => (
          <View key={d.label} style={{ width: '18%' }}>
            <Dial value={Number(d.value ?? 0)} max={d.max} label={d.label} />
          </View>
        ))}
      </View>
    </View>
  );
}

function Dial({ value, max, label, big = false }: { value: number; max: number; label: string; big?: boolean }) {
  const size = big ? 116 : 56;
  const stroke = big ? 6 : 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / max);
  const dash = c * pct;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={HG.hairline2} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={HG.sky} strokeWidth={stroke} fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: big ? 32 : 13, color: HG.ink, letterSpacing: -0.4 }}>
          {big ? value : Number(value || 0).toFixed(1)}
        </Text>
        {big ? (
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, marginTop: 2, textTransform: 'uppercase' }}>
            {label}
          </Text>
        ) : null}
      </View>
      {!big ? (
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 0.8, marginTop: 4 }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

function DataTile({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <View
      style={{
        width: '48.5%',
        padding: 14,
        borderRadius: 12,
        backgroundColor: HG.surface,
        borderWidth: 1,
        borderColor: HG.hairline,
      }}
    >
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: mono ? FONT.monoMedium : FONT.sansMedium, fontSize: 22, color: HG.ink, marginTop: 6, letterSpacing: -0.3 }}>
        {value}
      </Text>
    </View>
  );
}

// SCRUM-128: Demand chip on player detail
function PlayerDemandChip({ demand }: { demand: number }) {
  if (demand < 5) return null;
  const high = demand >= 15;
  return (
    <View style={{ paddingHorizontal: 18, marginBottom: 16 }}>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: high ? HG.skySoft : HG.surface, borderWidth: 1, borderColor: high ? HG.sky : HG.hairline2 }}>
        <Text style={{ fontFamily: FONT.monoBold, fontSize: 10, color: high ? HG.sky : HG.muted, letterSpacing: 0.8 }}>
          {high ? '🔥 HIGH DEMAND' : '⚡ MED DEMAND'}
        </Text>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, letterSpacing: 0.4 }}>
          {demand} adds / 1h
        </Text>
      </View>
    </View>
  );
}

// SCRUM-128: Last-5 games breakdown table
function Last5Breakdown({ player }: { player: any }) {
  // Attempt to use last5_game_logs if available, else fall back to season stats
  const logs: any[] = Array.isArray(player.last5_game_logs) ? player.last5_game_logs.slice(0, 5) : [];
  if (logs.length === 0) return null;

  const fpts = (g: any) => {
    const pts = Number(g.pts ?? 0);
    const reb = Number(g.reb ?? 0);
    const ast = Number(g.ast ?? 0);
    const stl = Number(g.stl ?? 0);
    const blk = Number(g.blk ?? 0);
    const to = Number(g.to ?? g.tov ?? 0);
    return pts + reb * 1.2 + ast * 1.5 + stl * 3 + blk * 3 - to;
  };

  return (
    <View style={{ paddingHorizontal: 18, marginBottom: 24 }}>
      <Text style={{ fontFamily: FONT.serif, fontSize: 18, color: HG.ink, marginBottom: 12 }}>
        <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Last</Text> 5 games
      </Text>
      <View style={{ backgroundColor: HG.surface, borderRadius: 12, borderWidth: 1, borderColor: HG.hairline, overflow: 'hidden' }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderColor: HG.hairline, backgroundColor: HG.inputBg }}>
          {['OPP', 'PTS', 'REB', 'AST', 'FPTS'].map((h) => (
            <Text key={h} style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 9, color: HG.muted, letterSpacing: 1, textAlign: h === 'OPP' ? 'left' : 'right' }}>
              {h}
            </Text>
          ))}
        </View>
        {logs.map((g: any, i: number) => (
          <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderColor: HG.hairline }}>
            <Text style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 0.4 }}>{g.opponent ?? '—'}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink, textAlign: 'right' }}>{g.pts ?? 0}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink, textAlign: 'right' }}>{g.reb ?? 0}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.monoMedium, fontSize: 11, color: HG.ink, textAlign: 'right' }}>{g.ast ?? 0}</Text>
            <Text style={{ flex: 1, fontFamily: FONT.monoBold, fontSize: 11, color: HG.sky, textAlign: 'right' }}>{fpts(g).toFixed(1)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

