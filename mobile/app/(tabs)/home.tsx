// =============================================================================
// BETTHAT — Home (Figma redesign)
//
// Betthat wordmark + Wallet pill + notification bell, the dark full-bleed
// price ticker, a filter chip row, then four sections:
//   1. Hero carousel — featured upcoming games, paging with dot indicators
//   2. Live Games    — today's slate, paging with dots
//   3. Trending Players — name/team, 80x40 sparkline, price + % change
//   4. Around the league — 2x2 player-news grid
//
// Three deliberate substitutions from the export, agreed up front:
//   • The sport chips (Football/Cricket) become real filters over the one
//     sport this app has: Trending · Live · Tonight · Tomorrow.
//   • The "PlaceHolder" World Cup video grid becomes player news, which is
//     real content already in the schema.
//   • Bebas Neue / Manrope are rendered in the app's DM Sans stack.
// The hero has no image source, so each card is painted from the two teams'
// primary_color values instead of a photo.
// =============================================================================

import { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, FlatList,
  ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, fmtTime, fmtTimeWithZone } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { MarketTicker } from '@/components/market/MarketTicker';
import { TeamBackdrop } from '@/components/media/TeamBackdrop';
import { MatchupPoster, TEXT_BAND } from '@/components/media/MatchupPoster';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { TeamLogo } from '@/components/media/TeamLogo';
import { PlayerHeadshot } from '@/components/media/PlayerHeadshot';
import { PriceGraph } from '@/components/market/PriceGraph';
import {
  useHomeFeed, selectSlate, narrowToSlate,
  type HomeFilter, type HomeGame, type TrendingPlayer, type NewsItem, type TeamStar,
} from '@/hooks/home/useHomeFeed';

const FILTERS: Array<{ key: HomeFilter; label: string }> = [
  { key: 'trending', label: '🔥 Trending' },
  { key: 'live', label: '🔴 Live' },
  { key: 'tonight', label: '🏀 Tonight' },
  { key: 'tomorrow', label: '🗓 Tomorrow' },
];

const NAV_CLEARANCE = 120;

// The second carousel carries the remainder of whatever the chip selected, so
// its heading has to follow the chip rather than always saying "Live Games".
const SECTION_TITLE: Record<HomeFilter, string> = {
  trending: 'More games',
  live: 'Also live',
  tonight: 'Later tonight',
  tomorrow: 'Also tomorrow',
};

// Taller than the old 190 so the headline band and the figures each get room.
const HERO_H = 232;

export default function HomeScreen() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const router = useRouter();
  const { profile, wallet } = useAuthStore();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<HomeFilter>('trending');

  const { data, isLoading, isRefetching, refetch } = useHomeFeed(profile?.id);

  // One payload, narrowed locally — so every section below reads the SAME
  // filtered list and the chips actually move the page.
  const slate = useMemo(() => selectSlate(data, filter), [data, filter]);

  // The player rails follow the chip too, so picking "Live" shows the players
  // actually on the floor rather than the same market-wide list every time.
  const trending = useMemo(
    () => narrowToSlate(data?.trending ?? [], slate.teams),
    [data?.trending, slate.teams],
  );
  const news = useMemo(
    () => narrowToSlate(data?.news ?? [], slate.teams),
    [data?.news, slate.teams],
  );

  const { data: hasUnread } = useQuery({
    queryKey: ['has-unread-notifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return false;
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
      return (count ?? 0) > 0;
    },
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  const tickerEntries = useMemo(
    () =>
      trending.map((t) => ({
        name: t.full_name,
        price: t.price,
        pctChange: t.pct,
      })),
    [trending],
  );

  const cardW = width - 32;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.surface }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      {/* ═══ Header ═════════════════════════════════════════════════════ */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <BrandLogo theme={theme} size={26} variant="mark" />
          <BrandLogo theme={theme} size={15} variant="wordmark" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={() => router.push('/wallet' as any)}
            accessibilityLabel={`Wallet, balance ${fmtPrice(wallet?.balance ?? null)}`}
            style={{
              height: 40, paddingLeft: 12, paddingRight: 16, borderRadius: 100,
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
            }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round">
              <Path d="M12 5v14M5 12h14" />
            </Svg>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.ink }}>Wallet</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/notifications' as any)}
            accessibilityLabel="Notifications"
            style={{
              width: 40, height: 40, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </Svg>
            {hasUnread ? (
              <View style={{ position: 'absolute', top: 7, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', borderWidth: 1.5, borderColor: theme.surface }} />
            ) : null}
          </Pressable>
        </View>
      </View>

      <MarketTicker entries={tickerEntries} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: NAV_CLEARANCE }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {/* ═══ Filter chips ═════════════════════════════════════════════ */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 25,
                  backgroundColor: active ? theme.ink : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontFamily: FONT.sansBold, fontSize: 12,
                    // A filter with nothing behind it is dimmed rather than
                    // hidden, so tapping it is never a dead end you discover
                    // only after the page empties.
                    color: active ? theme.surface : slate.counts[f.key] === 0 ? theme.muted2 : theme.ink,
                  }}
                >
                  {f.label}
                  {slate.counts[f.key] > 0 ? `  ${slate.counts[f.key]}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isLoading ? (
          <View style={{ padding: 60, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <>
            {/* ═══ Hero carousel ══════════════════════════════════════ */}
            <Carousel
              theme={theme}
              width={cardW}
              data={slate.games.slice(0, 5)}
              keyFor={(g) => g.id}
              empty={slate.emptyCopy}
              renderItem={(g) => (
                <HeroCard game={g} theme={theme} width={cardW} stars={data?.stars} onPress={() => router.push('/(tabs)/lineup' as any)} />
              )}
            />

            {/* ═══ The rest of the same slate ═════════════════════════ */}
            <SectionHeader theme={theme} title={SECTION_TITLE[filter]} onViewAll={() => router.push('/(tabs)/lineup' as any)} />
            <Carousel
              theme={theme}
              width={cardW}
              data={slate.games.slice(5, 11)}
              keyFor={(g) => g.id}
              empty={slate.games.length > 0 ? 'That is the whole slate.' : slate.emptyCopy}
              renderItem={(g) => (
                <MatchupCard game={g} theme={theme} width={cardW} onPress={() => router.push('/(tabs)/lineup' as any)} />
              )}
            />

            {/* ═══ Trending Players ═══════════════════════════════════ */}
            <SectionHeader theme={theme} title="Trending Players" onViewAll={() => router.push('/(tabs)/lineup' as any)} />
            <View style={{ paddingHorizontal: 16, gap: 18, paddingBottom: 8 }}>
              {trending.slice(0, 3).map((p) => (
                <TrendingRow key={p.id} player={p} theme={theme} onPress={() => router.push(`/player/${p.id}` as any)} />
              ))}
              {trending.length === 0 ? (
                <Text style={s.empty}>No price movement yet today.</Text>
              ) : null}
            </View>

            {/* ═══ Around the league ══════════════════════════════════ */}
            <SectionHeader theme={theme} title="Around the league" onViewAll={() => router.push('/(tabs)/lineup' as any)} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 16 }}>
              {news.slice(0, 4).map((n) => (
                <NewsCard
                  key={n.id}
                  item={n}
                  theme={theme}
                  width={(cardW - 16) / 2}
                  onPress={() => n.player_id && router.push(`/player/${n.player_id}` as any)}
                />
              ))}
              {news.length === 0 ? (
                <Text style={s.empty}>No news right now.</Text>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// CAROUSEL — paged list with the export's dot indicators
// =============================================================================

function Carousel<T>({
  theme, width, data, keyFor, renderItem, empty,
}: {
  theme: Theme; width: number; data: T[];
  keyFor: (item: T) => string; renderItem: (item: T) => React.ReactNode; empty: string;
}) {
  const [index, setIndex] = useState(0);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems?.length) setIndex(viewableItems[0].index ?? 0);
  }).current;

  if (data.length === 0) {
    return (
      <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', paddingVertical: 24 }}>
        {empty}
      </Text>
    );
  }

  return (
    <View style={{ gap: 8, paddingBottom: 8 }}>
      <FlatList
        data={data}
        keyExtractor={keyFor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={width + 16}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={({ item }) => <>{renderItem(item)}</>}
      />
      {data.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 3 }}>
          {data.slice(0, 6).map((_, i) => (
            <View
              key={i}
              style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: i === index ? theme.accent : theme.hairline2 }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SectionHeader({ theme, title, onViewAll }: { theme: Theme; title: string; onViewAll: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, lineHeight: 20.8, color: theme.ink }}>{title}</Text>
      <Pressable onPress={onViewAll} hitSlop={8} accessibilityLabel={`View all ${title}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: '#AAAAAC' }}>View all</Text>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#AAAAAC" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m9 6 6 6-6 6" />
        </Svg>
      </Pressable>
    </View>
  );
}

// =============================================================================
// HERO — no photography in the schema, so each card is painted from the two
// teams' primary colours with the export's bottom scrim over it.
// =============================================================================

function HeroCard({ game, theme, width, onPress, stars }: {
  game: HomeGame; theme: Theme; width: number; onPress: () => void;
  stars?: Map<string, TeamStar>;
}) {
  const left = game.home_color || '#1F2937';
  const right = game.away_color || '#111827';
  const tip = game.tip_off_time ? new Date(game.tip_off_time) : null;
  const awayStar = stars?.get(game.away_team_abbreviation) ?? null;
  const homeStar = stars?.get(game.home_team_abbreviation) ?? null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${game.away_team} at ${game.home_team}`}
      style={{ width, height: HERO_H, borderRadius: 16, overflow: 'hidden' }}
    >
      <MatchupPoster
        id={`hero-${game.id}`}
        height={HERO_H}
        width={width}
        awayAbbr={game.away_team_abbreviation}
        homeAbbr={game.home_team_abbreviation}
        awayColor={right}
        homeColor={left}
        awayStar={awayStar}
        homeStar={homeStar}
      />

      {/* Headline sits in the band the poster reserves for it, so it never
          lands on top of a player's face. */}
      <View style={{ height: HERO_H * TEXT_BAND, paddingHorizontal: 16, paddingTop: 14, gap: 6 }}>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.18)' }}>
          {game.status === 'live' ? (
            <View style={{ width: 6, height: 6, borderRadius: 100, backgroundColor: '#D6453C' }} />
          ) : null}
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 9, color: '#FAFAFA', letterSpacing: 1 }}>
            {game.status === 'live' ? 'LIVE NOW' : 'TONIGHT'}
          </Text>
        </View>

        <Text
          numberOfLines={2}
          style={{
            fontFamily: FONT.sansBold, fontSize: 21, lineHeight: 24,
            color: '#FFFFFF', letterSpacing: -0.4,
            textShadowColor: 'rgba(0,0,0,0.5)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 6,
          }}
        >
          {game.away_team} vs {game.home_team}
        </Text>

        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: 'rgba(255,255,255,0.78)' }}>
          {tip ? tip.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }) : '—'}
          {tip ? `  ·  ${fmtTime(tip)}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

// =============================================================================
// LIVE GAMES — "Today's MatchUp" card
// =============================================================================

function MatchupCard({ game, theme, width, onPress }: { game: HomeGame; theme: Theme; width: number; onPress: () => void }) {
  const live = game.status === 'live';
  const tip = game.tip_off_time ? new Date(game.tip_off_time) : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${game.away_team_abbreviation} at ${game.home_team_abbreviation}`}
      style={{
        width, borderRadius: 20, overflow: 'hidden', backgroundColor: theme.surface,
        shadowColor: '#151517', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: theme.mode === 'light' ? 0.05 : 0, shadowRadius: 8,
        elevation: theme.mode === 'light' ? 2 : 0,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
          {live ? "Today's MatchUp" : 'Upcoming'}
        </Text>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color: theme.muted2 }}>
          {live
            ? `Q${game.period ?? 1} · ${game.game_clock ?? '--:--'}`
            : tip ? fmtTimeWithZone(tip) : ''}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, gap: 12 }}>
        <TeamBlock theme={theme} abbr={game.away_team_abbreviation} name={game.away_team} color={game.away_color} score={live ? game.away_score : null} />
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.muted2 }}>vs</Text>
        <TeamBlock theme={theme} abbr={game.home_team_abbreviation} name={game.home_team} color={game.home_color} score={live ? game.home_score : null} align="flex-end" />
      </View>

      <View style={{ height: 48, justifyContent: 'center', overflow: 'hidden' }}>
        <TeamBackdrop
          id={`strip-${game.id}`}
          height={48}
          homeAbbr={game.home_team_abbreviation}
          awayAbbr={game.away_team_abbreviation}
          homeColor={game.home_color}
          awayColor={game.away_color}
          intensity={1.4}
          scrim={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
          {live ? <View style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: '#D6453C' }} /> : null}
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, lineHeight: 24, color: '#FFFFFF' }}>
            {live ? 'Live · Regular Season' : 'Regular Season'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function TeamBlock({
  theme, abbr, name, color, score, align = 'flex-start',
}: {
  theme: Theme; abbr: string; name: string; color: string | null; score: number | null; align?: 'flex-start' | 'flex-end';
}) {
  return (
    <View style={{ flex: 1, alignItems: align, gap: 6 }}>
      <View
        style={{
          width: 40, height: 40, borderRadius: 9999, alignItems: 'center', justifyContent: 'center',
          // Club colour behind the crest, softened so the mark still reads.
          backgroundColor: color ? `${color}22` : theme.surfaceSunken,
          borderWidth: 1, borderColor: color ? `${color}55` : theme.hairline,
        }}
      >
        <TeamLogo abbreviation={abbr} size={28} theme={theme} />
      </View>
      <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color: theme.ink }}>{name}</Text>
      {score != null ? (
        <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink }}>{score}</Text>
      ) : null}
    </View>
  );
}

// =============================================================================
// TRENDING PLAYERS
// =============================================================================

function TrendingRow({ player, theme, onPress }: { player: TrendingPlayer; theme: Theme; onPress: () => void }) {
  const up = player.pct >= 0;
  const color = player.pct === 0 ? theme.muted : up ? theme.gain : theme.danger;

  return (
    <Pressable onPress={onPress} accessibilityLabel={`View ${player.full_name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <PlayerHeadshot
        theme={theme}
        size={40}
        showTeamCrest
        player={{ full_name: player.full_name, headshot_url: player.headshot_url, team_abbreviation: player.team }}
      />

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
          {player.full_name}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 14, lineHeight: 21, color: theme.muted2 }}>{player.team}</Text>
      </View>

      <PriceGraph prices={player.history} theme={theme} width={80} height={40} />

      <View style={{ minWidth: 78, alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color }}>
          {up ? '+' : '-'}{fmtPrice(Math.abs(player.change)).replace('$', '$')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={12} height={10} viewBox="0 0 12 10">
              <Path d={up ? 'M6 0 L12 10 L0 10 Z' : 'M0 0 L12 0 L6 10 Z'} fill={color} />
            </Svg>
          </View>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color }}>
            {Math.abs(player.pct).toFixed(2)}%
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// =============================================================================
// NEWS GRID — replaces the export's placeholder video grid
// =============================================================================

const IMPACT_TONE: Record<string, string> = {
  out: '#960200', doubtful: '#960200', questionable: '#CE5A12',
  probable: '#36A34C', available: '#36A34C', positive: '#36A34C',
};

function NewsCard({ item, theme, width, onPress }: { item: NewsItem; theme: Theme; width: number; onPress: () => void }) {
  const tone = IMPACT_TONE[item.impact ?? ''] ?? theme.muted;
  return (
    <Pressable onPress={onPress} accessibilityLabel={item.headline} style={{ width, gap: 8 }}>
      <View style={{ width, height: 110, borderRadius: 12, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Club crest as a watermark, the player cut out over the top of it. */}
        <TeamLogo abbreviation={item.team} size={92} theme={theme} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <PlayerHeadshot
            theme={theme}
            size={64}
            player={{ full_name: item.player_name, headshot_url: item.headshot_url, team_abbreviation: item.team }}
          />
        </View>
        {item.impact ? (
          <View style={{ position: 'absolute', bottom: 8, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: tone }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 11, color: '#FAFAFA' }}>{item.impact.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 4 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: '#322D2D', textAlign: 'center' }}>
          {item.player_name ?? 'League'}
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: FONT.sansBold, fontSize: 14, lineHeight: 19, color: theme.ink, textAlign: 'center' }}>
          {item.headline}
        </Text>
      </View>
    </Pressable>
  );
}

function styles(t: Theme) {
  return {
    empty: { fontFamily: FONT.sans, fontSize: 13, color: t.muted, paddingVertical: 20, textAlign: 'center' as const, width: '100%' as const },
  };
}
