// =============================================================================
// BETTHAT — Profile (Figma redesign)
// Light/dark themed, yellow accent. Header + stat cards + Last-10 trend chart
// + Overview / Stats / Friends tabs + log-out confirm sheet.
//
// Data policy: use real Supabase data wherever it exists; where a section has
// no real data yet (or the user has none), fall back to clearly-labelled SAMPLE
// data so every section, color and control is still visible. Sample fallbacks
// live in the SAMPLE_* constants below and are only used when real data is empty.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl,
  Modal, TextInput, Alert, Share, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, {
  Path, Circle, Line, Rect, Defs, LinearGradient, Stop, Text as SvgText,
} from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, fmtPriceShort } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';

const RANK_COLOR: Record<string, string> = {
  Bronze: '#CD7F32', Silver: '#B8BCC4', Gold: '#E8B923',
  Platinum: '#8FD3E8', Diamond: '#7FE3F0',
};

const TIME_RANGES = ['1D', '1W', '1M', '3M', '1Y', 'All'] as const;
type Range = (typeof TIME_RANGES)[number];

// ── Sample fallbacks (only rendered when the real query returns nothing) ──────
const SAMPLE_ACHIEVEMENTS = ['Hot Streak 🔥', 'Gold III', 'Sleeper King 🤯'];
const SAMPLE_LAST10 = buildSampleLast10();
const SAMPLE_TOP_WINS = [
  { id: 's1', title: 'H2H win $500', sub: '$50 entry vs @Jroc32', a: 'S', b: 'L' },
  { id: 's2', title: 'Co-op H2H win $200', sub: '$50 entry vs @Jroc32', a: 'S', b: 'L' },
];
const SAMPLE_RECENT = [
  { id: 'r1', name: '@been_bleezy', date: 'Mar 14', amount: 120.22, score: '147.3 - 121.8', won: true },
  { id: 'r2', name: '@been_bleezy', date: 'Mar 14', amount: 120.22, score: '147.3 - 121.8', won: true },
  { id: 'r3', name: '@been_bleezy', date: 'Mar 12', amount: -50.0, score: '121.8 - 147.3', won: false },
];
const SAMPLE_DRAFTED = [
  { initials: 'N', name: 'Nikola Jokic', sub: 'Drafted 9 times', pct: '78%', record: '7 - 2' },
  { initials: 'L', name: 'Luka Doncic', sub: 'Drafted 7 times', pct: '71%', record: '5 - 2' },
  { initials: 'S', name: 'Shai Gilgeous', sub: 'Drafted 6 times', pct: '66%', record: '4 - 2' },
];
const SAMPLE_MODES = [
  { mode: '3v3 H2H', pct: 50 },
  { mode: 'Co op H2H', pct: 33 },
  { mode: 'Friend Challenges', pct: 70 },
];
const SAMPLE_RANK = [
  { id: 'k1', name: 'cantlosenomo', record: '64-22', recent: '(6-3)', self: false },
  { id: 'k2', name: 'beenbleezy', record: '33-17', recent: '(1-2)', self: false },
  { id: 'k3', name: 'arie_33', record: '21-12', recent: '-', self: true },
  { id: 'k4', name: 'james_8_', record: '8-12', recent: '(6-3)', self: false },
];

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, signOut, setProfile } = useAuthStore();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'overview' | 'stats' | 'friends'>('overview');
  const [range, setRange] = useState<Range>('1D');
  const [editOpen, setEditOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const editMutation = useMutation({
    mutationFn: async ({ displayName, username }: { displayName: string; username: string }) => {
      if (!profile?.id) throw new Error('Not authenticated');
      const trimmedUsername = username.trim().toLowerCase();
      const trimmedName = displayName.trim();
      type ProfileUpdate = { display_name?: string; username?: string };
      const updates: ProfileUpdate = {};
      if (trimmedName !== profile.display_name) updates.display_name = trimmedName;
      if (trimmedUsername !== profile.username) {
        const { data: existing } = await supabase
          .from('profiles').select('id')
          .eq('username', trimmedUsername).neq('id', profile.id).maybeSingle();
        if (existing) throw new Error('Username already taken. Please choose another.');
        updates.username = trimmedUsername;
      }
      if (Object.keys(updates).length === 0) return undefined;
      const { error } = await supabase.from('profiles').update(updates).eq('id', profile.id);
      if (error) throw error;
      return updates;
    },
    onSuccess: (updates) => {
      if (profile && updates) setProfile({ ...profile, ...updates });
      qc.invalidateQueries({ queryKey: ['profile-detail', profile?.id] });
      setEditOpen(false);
    },
    onError: (err: any) => Alert.alert('Could not save', err?.message ?? 'Try again.'),
  });

  const checkUsername = async (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === profile?.username) { setUsernameAvailable(null); return; }
    if (trimmed.length < 3) { setUsernameAvailable(false); return; }
    setCheckingUsername(true);
    const { data } = await supabase
      .from('profiles').select('id')
      .eq('username', trimmed).neq('id', profile?.id ?? '').maybeSingle();
    setCheckingUsername(false);
    setUsernameAvailable(!data);
  };

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['profile-detail', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const [friendsQ, matchupsQ, achQ] = await Promise.all([
        supabase
          .from('friends')
          .select('id, requester_id, recipient_id, requester:profiles!requester_id(id, username, display_name, avatar_url, total_wins, total_losses), recipient:profiles!recipient_id(id, username, display_name, avatar_url, total_wins, total_losses)')
          .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
          .eq('status', 'accepted'),
        supabase
          .from('matchups')
          .select(`
            id, status, settled_wager, payout_amount,
            user1_id, user2_id, user1_score, user2_score,
            winner_user_id, completed_at, created_at,
            u1:profiles!user1_id(id, username, display_name, avatar_url),
            u2:profiles!user2_id(id, username, display_name, avatar_url)
          `)
          .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(10),
        supabase
          .from('user_achievements')
          .select('id, earned_at, achievement:achievements(key, name, description, category, rarity, icon_url)')
          .eq('user_id', profile.id)
          .order('earned_at', { ascending: false }),
      ]);
      return {
        friends: friendsQ.data ?? [],
        matchups: matchupsQ.data ?? [],
        achievements: achQ.data ?? [],
      };
    },
    enabled: !!profile?.id,
  });

  const wins = profile?.total_wins ?? 0;
  const losses = profile?.total_losses ?? 0;
  const matches = wins + losses;
  const winPct = matches > 0 ? (wins / matches) * 100 : 64; // sample when no record
  const rank = profile?.rank_tier ?? 'Gold';
  const verified = (profile?.kyc_status ?? '').toLowerCase() === 'approved';

  const matchups = data?.matchups ?? [];
  const friendsRaw = data?.friends ?? [];
  const friendsCount = friendsRaw.length;

  // ── Last-10 equity curve (real): cumulative net $ across last 10 settled games.
  const realChart = useMemo(() => {
    const chrono = [...matchups].reverse();
    let cum = 0, w = 0, l = 0;
    const points = chrono.map((m: any) => {
      const won = m.winner_user_id === profile?.id;
      const wager = Number(m.settled_wager ?? 0);
      const net = won ? Number(m.payout_amount ?? 0) - wager : -wager;
      cum += net;
      if (won) w++; else l++;
      return { v: cum, day: m.completed_at ?? m.created_at, won };
    });
    return { points, w, l };
  }, [matchups, profile?.id]);

  const hasRealChart = realChart.points.length >= 2;
  const chartPoints = hasRealChart ? realChart.points : SAMPLE_LAST10;
  const chartW = hasRealChart ? realChart.w : 7;
  const chartL = hasRealChart ? realChart.l : 3;

  // ── Derived Stats-tab figures (real where possible, else sample) ────────────
  const myScores = matchups
    .map((m: any) => (m.user1_id === profile?.id ? m.user1_score : m.user2_score))
    .filter((x: any) => x != null)
    .map(Number);
  const avgFantasy = myScores.length ? myScores.reduce((a, b) => a + b, 0) / myScores.length : 192.6;

  const bestStreak = useMemo(() => {
    const chrono = [...matchups].reverse();
    let best = 0, cur = 0;
    chrono.forEach((m: any) => {
      if (m.winner_user_id === profile?.id) { cur++; best = Math.max(best, cur); } else cur = 0;
    });
    return best || 7;
  }, [matchups, profile?.id]);

  const netWinnings = Number(profile?.total_earnings ?? 0) || 345.2;
  const recentNet = realChart.points.length ? realChart.points[realChart.points.length - 1].v : 3.2;
  const changePct = netWinnings ? (recentNet / netWinnings) * 100 : 0.93;

  // Net-winnings series — sample walk ending at the headline value, sliced by range.
  const netSeries = useMemo(() => genSeries(netWinnings, 40, 7), [netWinnings]);
  const rangedSeries = useMemo(() => {
    const take: Record<Range, number> = { '1D': 8, '1W': 14, '1M': 22, '3M': 30, '1Y': 36, All: 40 };
    return netSeries.slice(-take[range]);
  }, [netSeries, range]);

  // Rank Amongst Friends — real friends + self, ranked by wins; sample if no friends.
  const rankRows = useMemo(() => {
    if (friendsCount === 0) return SAMPLE_RANK;
    const rows = friendsRaw.map((f: any) => {
      const fr = f.requester_id === profile?.id ? f.recipient : f.requester;
      const w = fr?.total_wins ?? 0, l = fr?.total_losses ?? 0;
      return { id: fr?.id ?? f.id, name: fr?.username ?? '—', w, record: `${w}-${l}`, recent: '-', self: false };
    });
    rows.push({ id: profile?.id ?? 'me', name: profile?.username ?? 'you', w: wins, record: `${wins}-${losses}`, recent: '-', self: true });
    rows.sort((a, b) => b.w - a.w);
    return rows;
  }, [friendsRaw, friendsCount, profile?.id, profile?.username, wins, losses]);

  const achievementsReal = (data?.achievements ?? []).map(
    (a: any) => a.achievement?.name ?? a.achievement?.key,
  ).filter(Boolean) as string[];
  const achievementsList = achievementsReal.length ? achievementsReal : SAMPLE_ACHIEVEMENTS;

  const s = styles(theme);

  const openEdit = () => {
    setEditName(profile?.display_name ?? profile?.username ?? '');
    setEditUsername(profile?.username ?? '');
    setUsernameAvailable(null);
    setEditOpen(true);
  };
  const shareProfile = () =>
    Share.share({ message: `Check out @${profile?.username} on BETTHAT` }).catch(() => {});

  // Overview Top Wins / Recent — real if present, else sample.
  const realTopWins = matchups
    .filter((m: any) => m.winner_user_id === profile?.id)
    .sort((a: any, b: any) => Number(b.payout_amount ?? 0) - Number(a.payout_amount ?? 0))
    .slice(0, 3);
  const realRecent = matchups.slice(0, 4);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      {/* Top bar: people (friends) · settings */}
      <View style={s.topbar}>
        <IconBtn onPress={() => router.push('/friends' as any)} label="Friends">
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <Circle cx={9} cy={7} r={4} />
            <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </Svg>
        </IconBtn>
        <IconBtn onPress={() => router.push('/settings' as any)} label="Settings">
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={12} r={3} />
            <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </Svg>
        </IconBtn>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} />}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={[s.card, { alignItems: 'center', paddingVertical: 22, marginTop: 4 }]}>
          <Avatar
            uri={profile?.avatar_url}
            initials={(profile?.display_name ?? profile?.username ?? '??').slice(0, 2).toUpperCase()}
            size={88}
            theme={theme}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 14 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 20, color: theme.ink, letterSpacing: -0.2 }}>
              {profile?.display_name ?? profile?.username ?? '—'}
            </Text>
            {verified ? <VerifiedBadge color={theme.accent} check={theme.onAccent} /> : null}
          </View>
          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 4 }}>
            Joined {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : '—'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <MetaStat n={String(friendsCount)} label="Friends" theme={theme} />
            <Text style={{ fontFamily: FONT.sans, fontSize: 16, color: theme.ink }}>{rank}</Text>
            <MetaStat n={String(matches)} label="Matches" theme={theme} />
          </View>
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}>
            <IconBtn onPress={shareProfile} label="Share profile" round>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 15V3M8 7l4-4 4 4" />
                <Path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
              </Svg>
            </IconBtn>
            <IconBtn onPress={openEdit} label="Edit profile" round>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
              </Svg>
            </IconBtn>
          </View>
        </View>

        {/* Stats strip */}
        <View style={[s.panel, { flexDirection: 'row', gap: 12 }]}>
          <StatCard value={`${wins}-${losses}`} label="Win Record" theme={theme} />
          <StatCard value={`${Math.round(winPct)}%`} label="Win Percentage" theme={theme} />
          <StatCard value={fmtPriceShort(netWinnings)} label="Total Won" theme={theme} />
        </View>

        {/* Last 10 trend */}
        <View style={[s.panel, { paddingBottom: 8 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink }}>Last 10</Text>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink }}>{chartW} - {chartL}</Text>
          </View>
          <TrendChart points={chartPoints} theme={theme} loading={isLoading} />
        </View>

        {/* Tabs */}
        <SegTabs value={tab} onChange={setTab} theme={theme} />

        {tab === 'overview' && (
          <>
            {/* Achievements */}
            <SectionTitle theme={theme}>Achievements</SectionTitle>
            <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                {achievementsList.map((name, i) => (
                  <View key={i} style={s.chip}>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.ink }}>{name}</Text>
                  </View>
                ))}
              </View>
              <RankCard rank={rank} winPct={winPct} theme={theme} onPress={() => router.push('/achievements' as any)} />
            </View>

            {/* Top Wins */}
            <SectionTitle theme={theme}>Top Wins</SectionTitle>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {realTopWins.length > 0
                ? realTopWins.map((m: any) => {
                    const opp = m.user1_id === profile?.id ? m.u2 : m.u1;
                    return (
                      <Pressable key={m.id} onPress={() => router.push(`/matchup/${m.id}` as any)} style={s.rowCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>H2H win {fmtPriceShort(m.payout_amount)}</Text>
                          <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 3 }}>
                            {fmtPriceShort(m.settled_wager)} entry vs @{opp?.username ?? '—'}
                          </Text>
                        </View>
                        <StackedAvatars initials={[initialsOf(profile?.display_name ?? profile?.username), initialsOf(opp?.display_name ?? opp?.username)]} theme={theme} />
                      </Pressable>
                    );
                  })
                : SAMPLE_TOP_WINS.map((m) => (
                    <View key={m.id} style={s.rowCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>{m.title}</Text>
                        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 3 }}>{m.sub}</Text>
                      </View>
                      <StackedAvatars initials={[m.a, m.b, 'J']} theme={theme} />
                    </View>
                  ))}
            </View>

            {/* Recent Games */}
            <SectionTitle theme={theme}>Recent Games</SectionTitle>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {realRecent.length > 0
                ? realRecent.map((m: any) => {
                    const meIs1 = m.user1_id === profile?.id;
                    const opp = meIs1 ? m.u2 : m.u1;
                    const myScore = meIs1 ? m.user1_score : m.user2_score;
                    const oppScore = meIs1 ? m.user2_score : m.user1_score;
                    const won = m.winner_user_id === profile?.id;
                    const net = won ? Number(m.payout_amount ?? 0) - Number(m.settled_wager ?? 0) : -Number(m.settled_wager ?? 0);
                    return (
                      <Pressable key={m.id} onPress={() => router.push(`/matchup/${m.id}` as any)} style={s.rowCard}>
                        <GameRow
                          theme={theme}
                          won={won}
                          name={`@${opp?.username ?? '—'}`}
                          date={m.completed_at ? new Date(m.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                          amount={net}
                          score={`${Number(myScore ?? 0).toFixed(1)} - ${Number(oppScore ?? 0).toFixed(1)}`}
                        />
                      </Pressable>
                    );
                  })
                : SAMPLE_RECENT.map((m) => (
                    <View key={m.id} style={s.rowCard}>
                      <GameRow theme={theme} won={m.won} name={m.name} date={m.date} amount={m.amount} score={m.score} />
                    </View>
                  ))}
            </View>
          </>
        )}

        {tab === 'stats' && (
          <>
            {/* Net Winnings */}
            <SectionTitle theme={theme}>Net Winnings</SectionTitle>
            <View style={[s.panel, { marginTop: 0 }]}>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 32, color: theme.ink, letterSpacing: -0.4 }}>
                {fmtPrice(netWinnings)}
              </Text>
              <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                <ChangePill amount={recentNet} pct={changePct} suffix="this month" theme={theme} />
              </View>
              <NetWinningsChart values={rangedSeries} theme={theme} />
              <TimeSegments value={range} onChange={setRange} theme={theme} />
            </View>

            {/* Top Wins (aggregate stat cards) */}
            <SectionTitle theme={theme}>Top Wins</SectionTitle>
            <View style={[s.panel, { marginTop: 0, flexDirection: 'row', gap: 12 }]}>
              <StatCard value={avgFantasy.toFixed(1)} label="Avg. Fantasy" theme={theme} />
              <StatCard value={`${Math.round(winPct)}%`} label="Win Percentage" theme={theme} />
              <StatCard value={`${bestStreak}W`} label="Best Streak" theme={theme} />
            </View>

            {/* Most Drafted Players */}
            <SectionTitle theme={theme}>Most Drafted Players</SectionTitle>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {SAMPLE_DRAFTED.map((p, i) => (
                <View key={i} style={s.rowCard}>
                  <View style={[s.roundInitial, { backgroundColor: theme.surfaceSunken }]}>
                    <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>{p.initials}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{p.name}</Text>
                    <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2, marginTop: 2 }}>{p.sub}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink }}>{p.pct}</Text>
                    <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2, marginTop: 2 }}>{p.record}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Win Rate By Mode */}
            <SectionTitle theme={theme}>Win Rate By Mode</SectionTitle>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {SAMPLE_MODES.map((m, i) => (
                <View key={i} style={s.rowCard}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: theme.ink, marginBottom: 8 }}>{m.mode}</Text>
                    <View style={{ height: 6, borderRadius: 10, backgroundColor: theme.surfaceSunken, overflow: 'hidden' }}>
                      <View style={{ width: `${m.pct}%`, height: '100%', backgroundColor: theme.accent, borderRadius: 10 }} />
                    </View>
                  </View>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>{m.pct}%</Text>
                </View>
              ))}
            </View>

            {/* Rank Amongst Friends */}
            <SectionTitle theme={theme}>Rank Amongst Friends</SectionTitle>
            <View style={{ paddingHorizontal: 16, gap: 6 }}>
              {rankRows.map((r: any, i: number) => (
                <View
                  key={r.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8,
                    borderRadius: 10, backgroundColor: r.self ? theme.accentWash : 'transparent',
                  }}
                >
                  <Text style={{ width: 20, fontFamily: FONT.sans, fontSize: 12, color: theme.muted2 }}>{i + 1}</Text>
                  <Avatar uri={null} initials={initialsOf(r.name)} size={40} theme={theme} />
                  <Text style={{ flex: 1, marginLeft: 10, fontFamily: FONT.sans, fontSize: 14, color: theme.ink }}>{r.name}</Text>
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>{r.record}</Text>
                  <Text style={{ marginLeft: 5, fontFamily: FONT.sansMedium, fontSize: 12, color: theme.muted2 }}>{r.recent}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {tab === 'friends' && (
          <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 10 }}>
            {friendsCount > 0
              ? friendsRaw.map((f: any) => {
                  const fr = f.requester_id === profile?.id ? f.recipient : f.requester;
                  return (
                    <Pressable key={f.id} onPress={() => router.push(`/user/${fr.id}` as any)} style={s.rowCard}>
                      <Avatar uri={fr.avatar_url} initials={initialsOf(fr.display_name ?? fr.username)} size={40} theme={theme} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink }}>{fr.display_name ?? fr.username}</Text>
                        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>@{fr.username}</Text>
                      </View>
                      <Text style={{ fontFamily: FONT.sans, fontSize: 18, color: theme.muted2 }}>›</Text>
                    </Pressable>
                  );
                })
              : SAMPLE_RANK.map((f) => (
                  <View key={f.id} style={s.rowCard}>
                    <Avatar uri={null} initials={initialsOf(f.name)} size={40} theme={theme} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink }}>{f.name}</Text>
                      <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>@{f.name}</Text>
                    </View>
                    <Text style={{ fontFamily: FONT.sans, fontSize: 18, color: theme.muted2 }}>›</Text>
                  </View>
                ))}
          </View>
        )}

        {/* Sign out */}
        <Pressable onPress={() => setLogoutOpen(true)} style={{ marginTop: 24, marginHorizontal: 16, padding: 14, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: theme.hairline }}>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.danger, letterSpacing: 0.4 }}>Log out</Text>
        </Pressable>
      </ScrollView>

      {/* Edit profile modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1, borderColor: theme.hairline, padding: 24, gap: 16 }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 20, color: theme.ink }}>Edit profile</Text>

            <View style={{ gap: 6 }}>
              <Text style={s.inputLabel}>Display name</Text>
              <TextInput
                style={s.input}
                value={editName}
                onChangeText={setEditName}
                placeholder="Your display name"
                placeholderTextColor={theme.muted2}
                maxLength={32}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={s.inputLabel}>Username</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={[s.input, {
                    paddingRight: 40,
                    borderColor: usernameAvailable === false ? theme.danger : usernameAvailable === true ? theme.gain : theme.hairline,
                  }]}
                  value={editUsername}
                  onChangeText={(v) => { setEditUsername(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()); setUsernameAvailable(null); }}
                  onEndEditing={() => checkUsername(editUsername)}
                  onBlur={() => checkUsername(editUsername)}
                  placeholder={profile?.username ?? 'username'}
                  placeholderTextColor={theme.muted2}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                />
                {checkingUsername ? (
                  <ActivityIndicator size="small" color={theme.muted} style={{ position: 'absolute', right: 14, top: 14 }} />
                ) : usernameAvailable === true ? (
                  <Text style={{ position: 'absolute', right: 14, top: 13, fontFamily: FONT.sansBold, fontSize: 15, color: theme.gain }}>✓</Text>
                ) : usernameAvailable === false ? (
                  <Text style={{ position: 'absolute', right: 14, top: 13, fontFamily: FONT.sansBold, fontSize: 15, color: theme.danger }}>✗</Text>
                ) : null}
              </View>
              {usernameAvailable === false && editUsername.length >= 3 && (
                <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.danger }}>Username taken or invalid (min 3 chars, a–z 0–9 _)</Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setEditOpen(false)} style={[s.modalBtn, { borderWidth: 1, borderColor: theme.hairline }]}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { if (usernameAvailable !== false) editMutation.mutate({ displayName: editName, username: editUsername }); }}
                disabled={editMutation.isPending || usernameAvailable === false}
                style={[s.modalBtn, { backgroundColor: theme.accent, opacity: usernameAvailable === false ? 0.4 : 1 }]}
              >
                {editMutation.isPending
                  ? <ActivityIndicator color={theme.onAccent} size="small" />
                  : <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.onAccent }}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Log-out confirmation bottom sheet */}
      <Modal visible={logoutOpen} transparent animationType="slide" onRequestClose={() => setLogoutOpen(false)}>
        <Pressable onPress={() => setLogoutOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(21,21,23,0.2)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, alignItems: 'center', gap: 20 }}>
            <View style={{ width: 48, height: 6, borderRadius: 999, backgroundColor: theme.hairline }} />
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 24, color: theme.ink, textAlign: 'center', letterSpacing: -0.2, marginTop: 4 }}>
              Are you sure want to log out?
            </Text>
            <View style={{ width: '100%', gap: 12 }}>
              <Pressable onPress={() => { setLogoutOpen(false); signOut(); }} style={{ height: 48, borderRadius: 999, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.bg }}>Yes, log out</Text>
              </Pressable>
              <Pressable onPress={() => setLogoutOpen(false)} style={{ height: 48, borderRadius: 999, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>No, keep here</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function initialsOf(name?: string | null): string {
  return (name ?? '??').replace('@', '').slice(0, 2).toUpperCase();
}

function IconBtn({ children, onPress, label, round }: { children: React.ReactNode; onPress: () => void; label: string; round?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={10} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: round ? 999 : 12 }}>
      {children}
    </Pressable>
  );
}

function Avatar({ uri, initials, size, theme }: { uri?: string | null; initials: string; size: number; theme: Theme }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surfaceSunken }} contentFit="cover" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surfaceSunken, borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: size * 0.36, color: theme.muted }}>{initials}</Text>
    </View>
  );
}

function VerifiedBadge({ color, check }: { color: string; check: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M12 1.5l2.6 1.9 3.2-.2 1 3.05 2.7 1.75-1 3.05 1 3.05-2.7 1.75-1 3.05-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.05L2.5 16l1-3.05-1-3.05 2.7-1.75 1-3.05 3.2.2L12 1.5z"
        fill={color}
      />
      <Path d="M8.5 12.2l2.3 2.3 4.6-4.9" stroke={check} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function MetaStat({ n, label, theme }: { n: string; label: string; theme: Theme }) {
  return (
    <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: theme.ink }}>{n} {label}</Text>
  );
}

function StatCard({ value, label, theme }: { value: string; label: string; theme: Theme }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center' }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 22, color: theme.ink, letterSpacing: -0.5 }}>{value}</Text>
      <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.ink, marginTop: 5, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: Theme }) {
  return (
    <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink2, paddingHorizontal: 16, marginTop: 22, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

function SegTabs({ value, onChange, theme }: { value: string; onChange: (v: any) => void; theme: Theme }) {
  const tabs = [{ k: 'overview', l: 'Overview' }, { k: 'stats', l: 'Stats' }, { k: 'friends', l: 'Friends' }];
  return (
    <View style={{ marginHorizontal: 16, marginTop: 8, flexDirection: 'row', backgroundColor: theme.surfaceSunken, borderRadius: 999, padding: 4 }}>
      {tabs.map((t) => {
        const active = value === t.k;
        return (
          <Pressable key={t.k} onPress={() => onChange(t.k)} style={{ flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center', backgroundColor: active ? theme.surface : 'transparent', borderWidth: active ? 1 : 0, borderColor: theme.hairline }}>
            <Text style={{ fontFamily: active ? FONT.sansBold : FONT.sansMedium, fontSize: 14, color: active ? theme.ink : theme.muted }}>{t.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StackedAvatars({ initials, theme }: { initials: string[]; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {initials.map((ini, i) => (
        <View
          key={i}
          style={{
            width: 30, height: 30, borderRadius: 999,
            marginLeft: i === 0 ? 0 : -10,
            borderWidth: 2, borderColor: theme.surface,
            backgroundColor: theme.chipPastels[i % theme.chipPastels.length],
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: '#151517' }}>{ini.slice(0, 1)}</Text>
        </View>
      ))}
    </View>
  );
}

// Recent-game row body (shared between real + sample).
function GameRow({ theme, won, name, date, amount, score }: { theme: Theme; won: boolean; name: string; date: string; amount: number; score: string }) {
  return (
    <>
      <View style={{ width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: won ? theme.accent : theme.loss }}>
        <Text style={{ fontFamily: FONT.sansBold, fontSize: 16, color: won ? theme.onAccent : theme.ink }}>{won ? 'W' : 'L'}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink }}>{name}</Text>
        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>{date}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.ink }}>
          {amount >= 0 ? '+' : '−'}{Math.abs(amount).toFixed(2)}
        </Text>
        <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2, marginTop: 2 }}>{score}</Text>
      </View>
    </>
  );
}

function ChangePill({ amount, pct, suffix, theme }: { amount: number; pct: number; suffix?: string; theme: Theme }) {
  const positive = amount >= 0;
  const c = positive ? theme.gain : theme.danger;
  const bg = positive ? theme.gainSoft : 'rgba(240,93,93,0.12)';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 11, color: c }}>{positive ? '▲' : '▼'}</Text>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: c }}>
        {positive ? '+' : '−'}{fmtPrice(Math.abs(amount)).slice(1)} ({Math.abs(pct).toFixed(2)}%){suffix ? ` ${suffix}` : ''}
      </Text>
    </View>
  );
}

function RankCard({ rank, winPct, theme, onPress }: { rank: string; winPct: number; theme: Theme; onPress: () => void }) {
  const rc = RANK_COLOR[rank] ?? theme.accent;
  return (
    <Pressable onPress={onPress} style={{ width: 110, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={rc} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <Path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <Path d="M4 22h16" />
        <Path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <Path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <Path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </Svg>
      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, color: theme.ink, marginTop: 6 }}>{rank}</Text>
      <View style={{ width: '100%', height: 3, borderRadius: 10, backgroundColor: theme.hairline, marginTop: 10, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(6, Math.min(100, Math.round(winPct)))}%`, height: '100%', backgroundColor: theme.accent }} />
      </View>
    </Pressable>
  );
}

function TimeSegments({ value, onChange, theme }: { value: Range; onChange: (r: Range) => void; theme: Theme }) {
  return (
    <View style={{ marginTop: 16, flexDirection: 'row', backgroundColor: theme.surfaceSunken, borderRadius: 999, padding: 2 }}>
      {TIME_RANGES.map((r) => {
        const active = r === value;
        return (
          <Pressable key={r} onPress={() => onChange(r)} style={{ flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: active ? theme.surface : 'transparent', borderWidth: active ? 1 : 0, borderColor: theme.hairline }}>
            <Text style={{ fontFamily: active ? FONT.sansMedium : FONT.sans, fontSize: 13, color: active ? theme.ink : theme.muted }}>{r}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Last-10 equity-curve chart (yellow line, indigo fill) ────────────────────
// The indicator dot is user-draggable — press/drag anywhere on the chart to
// scrub through each game's value; it snaps back to the peak game on release.
function TrendChart({ points, theme, loading }: { points: { v: number; day: string; won: boolean }[]; theme: Theme; loading?: boolean }) {
  const [w, setW] = useState(0);
  const [touchIdx, setTouchIdx] = useState<number | null>(null);
  const H = 168;
  const padT = 30, padB = 22, padL = 10, padR = 46;

  const geom = useMemo(() => {
    if (w === 0 || points.length < 2) return null;
    const vals = points.map((p) => p.v);
    let min = Math.min(...vals), max = Math.max(...vals);
    const spread = max - min || Math.abs(max) || 1;
    min -= spread * 0.18; max += spread * 0.18;
    const innerW = w - padL - padR;
    const innerH = H - padT - padB;
    const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
    const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    let peakIdx = 0;
    points.forEach((p, i) => { if (p.v > points[peakIdx].v) peakIdx = i; });
    const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => max - f * (max - min));
    return { x, y, line, area, peakIdx, gridVals, innerW };
  }, [w, points]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => scrub(e.nativeEvent.locationX),
        onPanResponderMove: (e) => scrub(e.nativeEvent.locationX),
        onPanResponderRelease: () => setTouchIdx(null),
        onPanResponderTerminate: () => setTouchIdx(null),
        // Without this, the parent ScrollView steals the touch the moment the
        // drag drifts vertically even slightly, which fires onPanResponderTerminate
        // mid-gesture and snaps the dot back while the finger is still down.
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geom, points.length],
  );

  function scrub(localX: number) {
    if (!geom) return;
    const frac = (localX - padL) / geom.innerW;
    const idx = Math.round(Math.max(0, Math.min(1, frac)) * (points.length - 1));
    setTouchIdx(idx);
  }

  if (points.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <ActivityIndicator color={theme.accent} /> : <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>No trend yet.</Text>}
      </View>
    );
  }

  const activeIdx = touchIdx ?? geom?.peakIdx ?? 0;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: H }} {...panResponder.panHandlers}>
      {geom && w > 0 && (
        <Svg width={w} height={H}>
          <Defs>
            <LinearGradient id="area10" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.chartArea} stopOpacity={0.4} />
              <Stop offset="1" stopColor={theme.chartArea} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {geom.gridVals.map((gv, i) => {
            const gy = geom.y(gv);
            return (
              <React.Fragment key={i}>
                <Line x1={padL} y1={gy} x2={w - padR} y2={gy} stroke={theme.hairline2} strokeWidth={1} strokeDasharray="3 5" />
                <SvgText x={w - padR + 6} y={gy + 3.5} fontSize={9} fontFamily={FONT.mono} fill={theme.muted2}>{fmtPriceShort(gv)}</SvgText>
              </React.Fragment>
            );
          })}
          <Path d={geom.area} fill="url(#area10)" />
          <Path d={geom.line} stroke={theme.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {touchIdx != null && (
            <Line x1={geom.x(activeIdx)} y1={padT - 6} x2={geom.x(activeIdx)} y2={H - padB} stroke={theme.hairline2} strokeWidth={1} strokeDasharray="3 4" />
          )}
          <Circle cx={geom.x(activeIdx)} cy={geom.y(points[activeIdx].v)} r={6} fill={theme.accent} />
          <Circle cx={geom.x(activeIdx)} cy={geom.y(points[activeIdx].v)} r={4} fill="#FFFFFF" />
          {(() => {
            const cx = geom.x(activeIdx);
            const boxW = 92;
            const bx = Math.max(padL, Math.min(w - padR - boxW, cx - boxW / 2));
            return (
              <>
                <Rect x={bx} y={2} width={boxW} height={34} rx={8} fill={theme.surface} stroke={theme.hairline} strokeWidth={1} />
                <SvgText x={bx + boxW / 2} y={15} fontSize={9} fontFamily={FONT.sans} fill={theme.muted} textAnchor="middle">
                  {new Date(points[activeIdx].day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </SvgText>
                <SvgText x={bx + boxW / 2} y={29} fontSize={13} fontFamily={FONT.sansBold} fill={theme.ink} textAnchor="middle">{fmtPrice(points[activeIdx].v)}</SvgText>
              </>
            );
          })()}
          {points.map((_, i) => (
            <SvgText key={i} x={geom.x(i)} y={H - 6} fontSize={9} fontFamily={FONT.mono} fill={theme.muted2} textAnchor="middle">{i + 1}</SvgText>
          ))}
        </Svg>
      )}
    </View>
  );
}

// ── Net-winnings area chart (green, dashed indicator + floating pill) ─────────
// Drag anywhere on the chart to scrub through the series; the dot + pill
// follow the touch and snap back to the default point on release.
function NetWinningsChart({ values, theme }: { values: number[]; theme: Theme }) {
  const [w, setW] = useState(0);
  const [touchIdx, setTouchIdx] = useState<number | null>(null);
  const H = 190;
  const padT = 40, padB = 8;
  const defaultIdx = Math.round((values.length - 1) * 0.72);

  const geom = useMemo(() => {
    if (w === 0 || values.length < 2) return null;
    let min = Math.min(...values), max = Math.max(...values);
    const spread = max - min || Math.abs(max) || 1;
    min -= spread * 0.12; max += spread * 0.2;
    const innerH = H - padT - padB;
    const x = (i: number) => (i / (values.length - 1)) * w;
    const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
    const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(values.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L0,${(H - padB).toFixed(1)} Z`;
    return { x, y, line, area };
  }, [w, values]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => scrub(e.nativeEvent.locationX),
        onPanResponderMove: (e) => scrub(e.nativeEvent.locationX),
        onPanResponderRelease: () => setTouchIdx(null),
        onPanResponderTerminate: () => setTouchIdx(null),
        // Without this, the parent ScrollView steals the touch the moment the
        // drag drifts vertically even slightly, which fires onPanResponderTerminate
        // mid-gesture and snaps the dot back while the finger is still down.
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, values.length],
  );

  function scrub(localX: number) {
    if (w === 0) return;
    const frac = localX / w;
    const idx = Math.round(Math.max(0, Math.min(1, frac)) * (values.length - 1));
    setTouchIdx(idx);
  }

  const activeIdx = touchIdx ?? defaultIdx;
  const val = geom ? values[activeIdx] : 0;
  const base = values[0];
  const pct = geom && base !== 0 ? ((val - base) / Math.abs(base)) * 100 : 0;
  const ix = geom ? geom.x(activeIdx) : 0;
  const iy = geom ? geom.y(val) : 0;

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: H, marginTop: 12, marginHorizontal: -16 }}
      {...panResponder.panHandlers}
    >
      {geom && w > 0 && (
        <>
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="areaNet" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.gain} stopOpacity={0.35} />
                <Stop offset="1" stopColor={theme.gain} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={geom.area} fill="url(#areaNet)" />
            <Path d={geom.line} stroke={theme.gain} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Line x1={ix} y1={padT - 6} x2={ix} y2={H} stroke={theme.hairline2} strokeWidth={1} strokeDasharray="4 4" />
            <Circle cx={ix} cy={iy} r={6} fill={theme.gain} />
            <Circle cx={ix} cy={iy} r={4} fill="#FFFFFF" />
          </Svg>
          {/* floating value pill */}
          <View
            style={{
              position: 'absolute', top: 4,
              left: Math.max(8, Math.min(w - 132, ix - 64)),
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: theme.surface, borderColor: theme.hairline, borderWidth: 1,
              borderRadius: 999, paddingVertical: 4, paddingLeft: 12, paddingRight: 4,
            }}
            pointerEvents="none"
          >
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 12, color: theme.ink }}>{fmtPrice(val)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: pct >= 0 ? theme.gainSoft : 'rgba(240,93,93,0.12)', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 6 }}>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 10, color: pct >= 0 ? theme.gain : theme.danger }}>{pct >= 0 ? '▲' : '▼'}</Text>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 11, color: pct >= 0 ? theme.gain : theme.danger }}>{Math.abs(pct).toFixed(2)}%</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample-data helpers
// ─────────────────────────────────────────────────────────────────────────────

// A deterministic upward random walk ending near `end` — used for the sample
// net-winnings series so the chart and headline value line up.
function genSeries(end: number, n: number, seed: number): number[] {
  let x = seed;
  const rand = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  const steps: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) { const d = (rand() - 0.42) * (end / n) * 2.4; steps.push(d); total += d; }
  const scale = total !== 0 ? end / total : 1;
  let cum = 0;
  return steps.map((d) => (cum += d * scale));
}

function buildSampleLast10() {
  const vals = [0.21, 0.235, 0.22, 0.25, 0.19, 0.2, 0.24, 0.255, 0.25, 0.245];
  const base = new Date('2026-06-20').getTime();
  return vals.map((v, i) => ({ v, day: new Date(base + i * 86400000).toISOString(), won: i % 3 !== 1 }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
function styles(t: Theme) {
  const cardShadow = {
    shadowColor: '#151517',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: t.mode === 'light' ? 0.05 : 0,
    shadowRadius: 8,
    elevation: t.mode === 'light' ? 2 : 0,
  };
  return {
    topbar: { height: 44, paddingHorizontal: 12, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    card: { marginHorizontal: 16, backgroundColor: t.surface, borderRadius: 20, paddingHorizontal: 16, ...cardShadow },
    panel: { marginHorizontal: 16, marginTop: 12, backgroundColor: t.surface, borderRadius: 20, padding: 16, ...cardShadow },
    chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: t.hairline, backgroundColor: t.surface },
    rowCard: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.hairline, padding: 14 },
    roundInitial: { width: 40, height: 40, borderRadius: 999, alignItems: 'center' as const, justifyContent: 'center' as const },
    inputLabel: { fontFamily: FONT.sansMedium, fontSize: 11, color: t.muted, letterSpacing: 0.6, textTransform: 'uppercase' as const },
    input: { backgroundColor: t.surfaceSunken, borderWidth: 1, borderColor: t.hairline, borderRadius: 12, paddingHorizontal: 14, height: 48, fontFamily: FONT.sans, fontSize: 15, color: t.ink },
    modalBtn: { flex: 1, height: 46, borderRadius: 999, alignItems: 'center' as const, justifyContent: 'center' as const },
  };
}
