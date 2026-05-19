// =============================================================================
// BETTHAT — Sidebet Create (Holy Grail V2, Screen 09 sub-screen)
// User picks: player → stat → vegas line (prefilled, not editable) → OVER/UNDER
// → commentary → wager. Posts the take to the public feed.
// =============================================================================

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { HG, FONT, fmtPrice, playerInitials, MIN_WAGER, MAX_WAGER } from '@/lib/holygrail';
import { MonogramTile } from '@/components/holygrail/MonogramTile';

const STATS = [
  { key: 'points',         label: 'PTS' },
  { key: 'rebounds',       label: 'REB' },
  { key: 'assists',        label: 'AST' },
  { key: 'three_pointers', label: '3PM' },
  { key: 'steals',         label: 'STL' },
  { key: 'blocks',         label: 'BLK' },
  { key: 'turnovers',      label: 'TO' },
  { key: 'pts_reb_ast',    label: 'PRA' },
  { key: 'pts_reb',        label: 'P+R' },
  { key: 'pts_ast',        label: 'P+A' },
] as const;
type StatKey = (typeof STATS)[number]['key'];

const COMMENTARY_MAX = 240;

export default function SidebetCreateScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profile, wallet } = useAuthStore();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [stat, setStat] = useState<StatKey>('points');
  const [side, setSide] = useState<'OVER' | 'UNDER'>('OVER');
  const [commentary, setCommentary] = useState('');
  const [wager, setWager] = useState('');
  const [search, setSearch] = useState('');

  // Tonight's draftable players + prop lines (joined)
  const { data: players, isLoading } = useQuery({
    queryKey: ['sidebet-players'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: dateRow } = await supabase
        .from('player_game_availability')
        .select('game_date')
        .lte('game_date', today)
        .order('game_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const slateDate = (dateRow as any)?.game_date ?? today;
      const { data, error } = await supabase
        .from('player_game_availability')
        .select(`
          game_id, game_date,
          nba_players!inner(id, full_name, first_name, last_name, ticker_handle, jersey_number, team_abbreviation, position),
          nba_games!inner(id, home_team_abbreviation, away_team_abbreviation, status, tip_off_time)
        `)
        .eq('game_date', slateDate)
        .eq('is_draftable', true);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row.nba_players,
        game: row.nba_games,
      }));
    },
  });

  // Prop lines for selected player + stat
  const { data: propLine } = useQuery({
    queryKey: ['prop-line', playerId, stat],
    queryFn: async () => {
      if (!playerId) return null;
      const { data, error } = await supabase
        .from('prop_lines')
        .select('id, line_value, over_odds, under_odds, source')
        .eq('player_id', playerId)
        .eq('stat_category', stat)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!playerId,
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !playerId || !propLine) throw new Error('Pick a player and stat');
      const player = players?.find((p) => p.id === playerId);
      if (!player) throw new Error('Player not found');
      const wagerNum = Number(wager);
      if (wagerNum < MIN_WAGER || wagerNum > MAX_WAGER) throw new Error(`Wager must be $${MIN_WAGER}–$${MAX_WAGER}`);
      if (Number(wallet?.balance ?? 0) < wagerNum) throw new Error('Insufficient buying power');

      const { error } = await supabase.from('sidebets').insert({
        creator_id: profile.id,
        player_id: playerId,
        game_id: player.game.id,
        prop_line_id: propLine.id,
        stat_category: stat,
        line_value: propLine.line_value,
        creator_side: side,
        creator_reasoning: commentary.trim() || null,
        wager_amount: wagerNum,
        is_open: true,
        status: 'open',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sidebets-feed'] });
      router.back();
    },
  });

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => `${p.full_name} ${p.ticker_handle ?? ''} ${p.team_abbreviation}`.toLowerCase().includes(q));
  }, [players, search]);

  const wagerNum = Number(wager);
  const balance = Number(wallet?.balance ?? 0);
  const wagerOk = wagerNum >= MIN_WAGER && wagerNum <= MAX_WAGER && wagerNum <= balance;
  const formOk = !!playerId && !!propLine && wagerOk;
  const errorLine =
    !playerId ? 'Pick a player'
    : !propLine ? 'No Vegas line for this stat'
    : !wager ? `Set wager $${MIN_WAGER}–$${MAX_WAGER}`
    : wagerNum < MIN_WAGER ? `Minimum wager is $${MIN_WAGER}`
    : wagerNum > MAX_WAGER ? `Maximum wager is $${MAX_WAGER}`
    : wagerNum > balance ? 'Insufficient buying power'
    : null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: HG.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          Post · A · Take
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M18 6 6 18M6 6l12 12" />
          </Svg>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {/* Player picker */}
        <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, paddingHorizontal: 18, marginTop: 8, letterSpacing: -0.3 }}>
          <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Pick a</Text> player
        </Text>

        {/* Search input */}
        <View style={{ paddingHorizontal: 18, marginTop: 12 }}>
          <View style={{ height: 40, paddingHorizontal: 12, backgroundColor: HG.inputBg, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
              <Path d="m21 21-4.3-4.3" />
            </Svg>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search players"
              placeholderTextColor={HG.muted}
              style={{ flex: 1, fontFamily: FONT.sans, fontSize: 14, color: HG.ink, padding: 0 }}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </View>

        {isLoading ? (
          <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={HG.sky} /></View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6, gap: 10 }}
          >
            {filtered.map((p) => {
              const active = playerId === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPlayerId(p.id)}
                  style={{
                    width: 96,
                    padding: 10,
                    borderRadius: 14,
                    backgroundColor: active ? HG.skySoft : HG.surface,
                    borderWidth: 1,
                    borderColor: active ? HG.sky : HG.hairline,
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <MonogramTile initials={playerInitials(p)} jersey={p.jersey_number} size={42} />
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: HG.ink, textAlign: 'center', maxWidth: 80 }}>
                    {p.last_name ?? p.full_name}
                  </Text>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 9, color: active ? HG.sky : HG.muted, letterSpacing: 0.4 }}>
                    {p.team_abbreviation} · {p.position}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Stat + Line section — only meaningful once a player is picked */}
        {playerId ? (
          <>
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, paddingHorizontal: 18, marginTop: 22, letterSpacing: -0.3 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Pick the</Text> stat
            </Text>

            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginTop: 12 }}>
              {STATS.map((s) => {
                const active = stat === s.key;
                return (
                  <Pressable
                    key={s.key}
                    onPress={() => setStat(s.key)}
                    style={{
                      flex: 1,
                      height: 38,
                      borderRadius: 999,
                      backgroundColor: active ? HG.sky : HG.surface,
                      borderWidth: 1,
                      borderColor: active ? HG.sky : HG.hairline,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: active ? HG.jet : HG.muted, letterSpacing: 1 }}>
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Vegas line + over/under */}
            <View style={{ marginHorizontal: 18, marginTop: 18, padding: 18, backgroundColor: HG.surface, borderRadius: 16, borderColor: HG.hairline, borderWidth: 1 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                Vegas line {propLine?.source ? `· ${propLine.source}` : ''}
              </Text>
              {propLine ? (
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 56, color: HG.ink, marginTop: 6, letterSpacing: -1.2 }}>
                  {Number(propLine.line_value).toFixed(1)}
                </Text>
              ) : (
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted, marginTop: 8 }}>
                  No active line for this stat. Pick a different stat.
                </Text>
              )}

              {propLine ? (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  {(['OVER', 'UNDER'] as const).map((s) => {
                    const active = side === s;
                    const odds = s === 'OVER' ? propLine.over_odds : propLine.under_odds;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setSide(s)}
                        style={{
                          flex: 1,
                          height: 56,
                          borderRadius: 14,
                          backgroundColor: active ? HG.skySoft : 'transparent',
                          borderWidth: 1,
                          borderColor: active ? HG.sky : HG.hairline2,
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                        }}
                      >
                        <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: active ? HG.sky : HG.ink2, letterSpacing: 0.8 }}>
                          {s === 'OVER' ? '↑' : '↓'} {s}
                        </Text>
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: active ? HG.sky : HG.muted, letterSpacing: 0.4 }}>
                          {odds && odds < 0 ? odds : `+${odds}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            {/* Commentary */}
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, paddingHorizontal: 18, marginTop: 22, letterSpacing: -0.3 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Your</Text> take
            </Text>
            <View style={{ marginHorizontal: 18, marginTop: 12 }}>
              <View
                style={{
                  backgroundColor: HG.inputBg,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: HG.hairline,
                  padding: 14,
                  minHeight: 110,
                }}
              >
                <TextInput
                  value={commentary}
                  onChangeText={(t) => t.length <= COMMENTARY_MAX && setCommentary(t)}
                  placeholder="Why this hits. Be specific. (Optional but recommended.)"
                  placeholderTextColor={HG.muted}
                  multiline
                  textAlignVertical="top"
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 14,
                    color: HG.ink,
                    minHeight: 80,
                    padding: 0,
                    lineHeight: 20,
                  }}
                />
              </View>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted2, marginTop: 6, textAlign: 'right', letterSpacing: 0.4 }}>
                {commentary.length} / {COMMENTARY_MAX}
              </Text>
            </View>

            {/* Wager */}
            <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: HG.ink, paddingHorizontal: 18, marginTop: 14, letterSpacing: -0.3 }}>
              <Text style={{ fontFamily: FONT.serifItalic, color: HG.muted }}>Your</Text> wager
            </Text>
            <View style={{ paddingHorizontal: 18, marginTop: 12, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: FONT.monoMedium, fontSize: 28, color: wager ? HG.muted2 : HG.muted2, marginRight: 4 }}>$</Text>
                <TextInput
                  value={wager}
                  onChangeText={setWager}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={HG.muted2}
                  maxLength={4}
                  style={{
                    fontFamily: FONT.monoMedium,
                    fontSize: 44,
                    color: wagerOk || !wager ? HG.ink : HG.down,
                    letterSpacing: -1,
                    minWidth: 80,
                    textAlign: 'center',
                    padding: 0,
                  }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                {[5, 10, 25, 50].map((v) => {
                  const active = wagerNum === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setWager(String(v))}
                      style={{
                        paddingHorizontal: 12,
                        height: 28,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? HG.sky : HG.hairline2,
                        backgroundColor: active ? HG.skySoft : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: active ? HG.sky : HG.muted, letterSpacing: 0.6 }}>
                        ${v}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Post CTA */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24,
          backgroundColor: HG.jet, borderTopWidth: 1, borderTopColor: HG.hairline,
        }}
      >
        {errorLine ? (
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted, marginBottom: 8, textAlign: 'center' }}>
            {errorLine}
          </Text>
        ) : null}
        <Pressable
          onPress={() => formOk && postMutation.mutate()}
          disabled={!formOk || postMutation.isPending}
          style={{
            height: 48,
            borderRadius: 999,
            backgroundColor: formOk ? HG.sky : HG.surface,
            borderWidth: formOk ? 0 : 1,
            borderColor: HG.hairline,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {postMutation.isPending ? (
            <ActivityIndicator color={HG.jet} />
          ) : (
            <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: formOk ? HG.jet : HG.muted2, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              {wager ? `Post · ${fmtPrice(Number(wager))}` : 'Post take'}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
