// =============================================================================
// BETTHAT — Wallet (Holy Grail V2, Screen 11)
// Modal sheet. Balance, BETTHAT card, deposit/withdraw, transaction history.
// =============================================================================

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT, fmtPrice, fmtRelative } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { SectionHead } from '@/components/holygrail/SectionHead';

export default function WalletScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, wallet } = useAuthStore();
  const [cardFlipped, setCardFlipped] = useState(false);

  const { data: transactions, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['wallet-transactions', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select('id, type, amount, balance_after, description, status, created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.id,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 }}>
          <Text style={{ fontFamily: FONT.serif, fontSize: 28, color: theme.ink, letterSpacing: -0.4 }}>Wallet</Text>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M18 6 6 18M6 6l12 12" />
            </Svg>
          </Pressable>
        </View>

        <ScrollView
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.accent} />}
          contentContainerStyle={{ paddingBottom: 80 }}
        >
          {/* Balance */}
          <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 26 }}>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
              Buying power
            </Text>
            <Text style={{ fontFamily: FONT.monoMedium, fontSize: 56, color: theme.ink, marginTop: 6, letterSpacing: -1.2 }}>
              {fmtPrice(wallet?.balance)}
            </Text>
            {Number(wallet?.escrow_balance ?? 0) > 0 ? (
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted, marginTop: 6 }}>
                {fmtPrice(wallet?.escrow_balance)} held in escrow
              </Text>
            ) : null}
          </View>

          {/* BETTHAT card */}
          <Pressable onPress={() => setCardFlipped((f) => !f)} style={{ marginHorizontal: 18, marginBottom: 22 }}>
            <View
              style={{
                aspectRatio: 1.586,
                borderRadius: 18,
                backgroundColor: '#0c0c0e',
                borderWidth: 1,
                borderColor: theme.accentEdge,
                padding: 22,
                justifyContent: 'space-between',
                shadowColor: theme.accent,
                shadowOpacity: 0.18,
                shadowRadius: 22,
                shadowOffset: { width: 0, height: 8 },
              }}
            >
              {!cardFlipped ? (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: FONT.monoBold, fontSize: 13, color: theme.ink, letterSpacing: 2.6 }}>
                      BETTHAT
                    </Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.accent, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                      Member
                    </Text>
                  </View>
                  <View>
                    <Text
                      style={{
                        fontFamily: FONT.monoMedium,
                        fontSize: 19,
                        color: 'rgba(232, 237, 242, 0.45)',
                        letterSpacing: 2,
                        textShadowColor: 'rgba(0,0,0,0.5)',
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 1,
                      }}
                    >
                      {(profile?.display_name ?? profile?.username ?? '').toUpperCase()}
                    </Text>
                    <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2, marginTop: 8, letterSpacing: 1 }}>
                      Tap to flip
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 1.6, textTransform: 'uppercase' }}>
                    Card detail
                  </Text>
                  <View style={{ gap: 8 }}>
                    <CardStat theme={theme} label="Member since" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'} />
                    <CardStat theme={theme} label="Lifetime returns" value={fmtPrice(profile?.total_earnings)} />
                    <CardStat theme={theme} label="Matchups" value={String((profile?.total_wins ?? 0) + (profile?.total_losses ?? 0))} />
                  </View>
                </>
              )}
            </View>
          </Pressable>

          {/* Deposit / Withdraw */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 18 }}>
            <Pressable
              onPress={() => router.push('/wallet/deposit' as any)}
              style={{ flex: 1, height: 48, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.onAccent, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                Deposit
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/wallet/withdraw' as any)}
              style={{ flex: 1, height: 48, borderRadius: 999, backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 12, color: theme.accent, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                Withdraw
              </Text>
            </Pressable>
          </View>

          {/* History */}
          <SectionHead word="Transaction" emphasis="history" label={String(transactions?.length ?? 0)} />
          <View style={{ paddingHorizontal: 18 }}>
            {isLoading ? (
              <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
            ) : (transactions ?? []).length === 0 ? (
              <View style={{ padding: 24, backgroundColor: theme.surface, borderRadius: 12, borderColor: theme.hairline, borderWidth: 1 }}>
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center' }}>
                  No transactions yet.
                </Text>
              </View>
            ) : (
              (transactions ?? []).map((t: any) => {
                const inflow = Number(t.amount) > 0;
                return (
                  <View key={t.id} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: theme.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontFamily: FONT.sans, fontSize: 14, color: theme.ink }}>
                        {t.description ?? prettyType(t.type)}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 3 }}>
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted, letterSpacing: 0.6 }}>
                          {prettyType(t.type)}
                        </Text>
                        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2 }}>
                          · {fmtRelative(t.created_at)}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 14, color: inflow ? theme.accent : theme.ink }}>
                        {inflow ? '+' : ''}{fmtPrice(t.amount)}
                      </Text>
                      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2, marginTop: 2 }}>
                        bal {fmtPrice(t.balance_after)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function CardStat({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: theme.muted2, letterSpacing: 1 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: theme.ink2 }}>{value}</Text>
    </View>
  );
}

function prettyType(t: string): string {
  switch (t) {
    case 'deposit': return 'Deposit';
    case 'withdrawal': return 'Withdrawal';
    case 'entry_fee': return 'Order';
    case 'payout': return 'Payout';
    case 'winnings': return 'Winnings';
    case 'refund': return 'Refund';
    case 'rake': return 'Rake';
    case 'escrow_hold': return 'Escrow hold';
    case 'escrow_release': return 'Escrow release';
    default: return t;
  }
}
