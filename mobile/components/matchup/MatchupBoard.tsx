import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { PlayerStatCard, type PlayerStatLine } from '@/components/matchup/PlayerStatCard';

// =============================================================================
// BETTHAT — Live board (Figma "Current Match")
//
// Dark scoreboard card — live pill, game context (Q3 · 8:42 · LAL 88 - BOS 82),
// both totals with their recent deltas, and a tug-of-war lead bar — over the
// segmented lineups, the activity log, and a docked Chat CTA.
//
// The scoreboard is always dark regardless of app theme; it's the one
// art-directed surface on this screen.
// =============================================================================

const BOARD_BG = '#151517';
const LIVE_RED = '#D6453C';
// Orange marks YOUR side — identity, not outcome. Green and red are reserved
// for direction: a delta that went up, a lead you hold.
const ACCENT = '#CE5A12';
const UP_GREEN = '#3FBE59';
const DOWN_RED = '#D6453C';
const LOG_INK = '#AAAAAC';

export interface ActivityEvent {
  id: string;
  lineup_id: string | null;
  description: string | null;
  fpts_delta: number | null;
}

export function MatchupBoard({
  theme, me, opp, meL, oppL, meScore, oppScore, events, liveGame, boxScores,
  isCompleted, onOpenChat, onPlayerPress,
}: {
  theme: Theme;
  me: any; opp: any; meL: any; oppL: any;
  meScore: number | string | null; oppScore: number | string | null;
  events: ActivityEvent[];
  liveGame: any;
  boxScores: Record<string, any>;
  isCompleted: boolean;
  onOpenChat: () => void;
  onPlayerPress: (playerId: string) => void;
}) {
  const [side, setSide] = useState<'mine' | 'theirs'>('mine');

  const mineTotal = Number(meScore ?? 0);
  const theirsTotal = Number(oppScore ?? 0);
  const lead = mineTotal - theirsTotal;
  // Bar fills with your share of the combined score — reads as a tug-of-war
  // rather than progress toward an arbitrary target.
  const share = mineTotal + theirsTotal > 0 ? mineTotal / (mineTotal + theirsTotal) : 0.5;

  const build = (lineup: any): PlayerStatLine[] =>
    ((lineup?.lineup_players ?? []) as any[])
      .slice()
      .sort((a, b) => a.slot_number - b.slot_number)
      .map((lp) => {
        const p = lp.nba_players;
        const st = boxScores?.[p?.id];
        const g = st?.nba_games;
        const vs = g && p
          ? (p.team_abbreviation === g.home_team_abbreviation ? g.away_team : g.home_team)
          : undefined;
        return {
          id: p?.id,
          name: p?.full_name ?? 'Unknown',
          vs,
          headshot_url: p?.headshot_url ?? null,
          team: p?.team_abbreviation ?? null,
          fp: Number(st?.fantasy_points ?? lp.fantasy_points_scored ?? 0),
          PTS: st?.points ?? 0, REB: st?.rebounds ?? 0, AST: st?.assists ?? 0,
          STL: st?.steals ?? 0, TO: st?.turnovers ?? 0,
        };
      });

  const roster = side === 'mine' ? build(meL) : build(oppL);
  const oppHandle = opp?.username ? `@${opp.username}` : 'Opponent';

  // Net of the most recent plays per side — the small figure under each total.
  const recent = (lineupId: string | undefined) =>
    (events ?? [])
      .filter((e) => e.lineup_id === lineupId)
      .slice(0, 3)
      .reduce((sum, e) => sum + Number(e.fpts_delta ?? 0), 0);
  const myDelta = recent(meL?.id);
  const theirDelta = recent(oppL?.id);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* ═══ Scoreboard ═══════════════════════════════════════════════ */}
        <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 16, backgroundColor: BOARD_BG, padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: isCompleted ? LOG_INK : LIVE_RED }} />
              <Text style={{ fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: isCompleted ? LOG_INK : LIVE_RED }}>
                {isCompleted ? 'Final' : 'Live Match'}
              </Text>
            </View>
            {liveGame ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={META}>Q{liveGame.period ?? 1}</Text>
                <Dot />
                <Text style={META}>{liveGame.game_clock ?? '--:--'}</Text>
                <Dot />
                <Text style={META}>
                  {liveGame.home_team_abbreviation} {liveGame.home_score ?? 0} - {liveGame.away_team_abbreviation} {liveGame.away_score ?? 0}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <Text style={SIDE}>You</Text>
            <Text numberOfLines={1} style={[SIDE, { textAlign: 'right', maxWidth: 140 }]}>
              {opp?.display_name || opp?.username || 'Opponent'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={[SCORE, { color: ACCENT }]}>{mineTotal.toFixed(1)}</Text>
              {myDelta !== 0 ? (
                <Text style={{ fontFamily: FONT.sans, fontSize: 10, lineHeight: 15, color: myDelta > 0 ? UP_GREEN : DOWN_RED }}>
                  {myDelta > 0 ? '+' : ''}{myDelta.toFixed(1)}
                </Text>
              ) : null}
            </View>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, lineHeight: 22.5, color: '#FFFFFF' }}>vs.</Text>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={[SCORE, { color: '#FFFFFF' }]}>{theirsTotal.toFixed(1)}</Text>
              {theirDelta !== 0 ? (
                <Text style={{ fontFamily: FONT.sans, fontSize: 10, lineHeight: 15, color: theirDelta > 0 ? UP_GREEN : DOWN_RED }}>
                  {theirDelta > 0 ? '+' : ''}{theirDelta.toFixed(1)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={{ height: 6, borderRadius: 10, backgroundColor: '#EAEAEA', overflow: 'hidden' }}>
            <View style={{
              width: `${Math.max(2, Math.min(98, share * 100))}%`, height: 6, borderRadius: 10,
              backgroundColor: lead > 0 ? UP_GREEN : lead < 0 ? DOWN_RED : ACCENT,
            }} />
          </View>

          <Text style={{
            fontFamily: FONT.sansMedium, fontSize: 12, lineHeight: 18, textAlign: 'center',
            color: lead > 0 ? UP_GREEN : lead < 0 ? DOWN_RED : '#FFFFFF',
          }}>
            {lead === 0
              ? 'Dead even'
              : `${lead > 0 ? 'You lead' : `${opp?.username ?? 'Opponent'} leads`} by ${Math.abs(lead).toFixed(1)} points`}
          </Text>
        </View>

        {/* ═══ Lineups ══════════════════════════════════════════════════ */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', height: 40, borderRadius: 100, backgroundColor: theme.surfaceSunken, overflow: 'hidden' }}>
            {([['mine', 'Your Lineup'], ['theirs', oppHandle]] as const).map(([k, label]) => {
              const active = side === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setSide(k)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 100,
                    backgroundColor: active ? theme.surface : 'transparent',
                    borderWidth: active ? 1 : 0, borderColor: theme.hairline,
                  }}
                >
                  <Text numberOfLines={1} style={{ fontFamily: active ? FONT.sansMedium : FONT.sans, fontSize: 14, lineHeight: 21.7, color: active ? theme.ink : '#AAAAAC' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ paddingHorizontal: 10, gap: 11 }}>
          {roster.length === 0 ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', padding: 24 }}>
              No lineup to show for this side yet.
            </Text>
          ) : (
            roster.map((p) => (
              <PlayerStatCard
                key={p.id ?? p.name}
                player={p}
                theme={theme}
                onPress={p.id ? () => onPlayerPress(p.id!) : undefined}
              />
            ))
          )}
        </View>

        {/* ═══ Activity Log ═════════════════════════════════════════════ */}
        <View
          style={{
            margin: 16, padding: 16, borderRadius: 20, gap: 7,
            backgroundColor: theme.surface,
            shadowColor: '#151517', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: theme.mode === 'light' ? 0.05 : 0, shadowRadius: 8,
            elevation: theme.mode === 'light' ? 2 : 0,
          }}
        >
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, lineHeight: 27, color: theme.ink }}>Activity Log</Text>
          {(events ?? []).length === 0 ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, lineHeight: 20, color: theme.muted, paddingVertical: 8 }}>
              Nothing yet — scoring plays land here as they happen.
            </Text>
          ) : (
            (events ?? []).slice(0, 12).map((e) => {
              const mine = e.lineup_id === meL?.id;
              const delta = Number(e.fpts_delta ?? 0);
              return (
                <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 12, alignItems: 'center' }}>
                    <View style={{ width: 4, height: 4, borderRadius: 9999, backgroundColor: mine ? ACCENT : '#C4C4C5' }} />
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sansMedium, fontSize: 12, lineHeight: 18, color: LOG_INK }}>
                    {e.description ?? 'Scoring play'}
                  </Text>
                  <Text style={{ minWidth: 44, textAlign: 'center', fontFamily: FONT.sansBold, fontSize: 12, lineHeight: 18, color: LOG_INK }}>
                    {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ═══ Chat ═══════════════════════════════════════════════════════ */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, backgroundColor: theme.bg }}>
        <Pressable
          onPress={onOpenChat}
          accessibilityLabel="Open match chat"
          style={{ height: 48, borderRadius: 100, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.surface }}>Chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Dot() {
  return <View style={{ width: 2, height: 2, borderRadius: 9999, backgroundColor: '#FFFFFF' }} />;
}

const META = { fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: '#FFFFFF' } as const;
const SIDE = { fontFamily: FONT.sansMedium, fontSize: 12, lineHeight: 18, color: '#FFFFFF' } as const;
const SCORE = { fontFamily: FONT.sansBold, fontSize: 44, lineHeight: 56, letterSpacing: -1 } as const;
