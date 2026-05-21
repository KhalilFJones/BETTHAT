// =============================================================================
// BETTHAT — Settings › Payout Methods
// View and manage withdrawal methods. Stripe payouts are handled server-side.
// This screen provides a clear UX for supported payout options and status.
// =============================================================================

import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { HG, FONT } from '@/lib/holygrail';

export default function PayoutMethodsScreen() {
  const router = useRouter();

  function onAddBankAccount() {
    Alert.alert(
      'Bank Account (ACH)',
      'To add a bank account for withdrawals, complete identity verification first. Go to Profile → Verify Identity.',
      [{ text: 'OK' }],
    );
  }

  function onAddDebitCard() {
    Alert.alert(
      'Debit Card',
      'Debit card payouts (Visa/Mastercard) will be available soon. Check back for updates.',
      [{ text: 'OK' }],
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, gap: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, letterSpacing: -0.3 }}>Payout Methods</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 60, gap: 24 }}>
        {/* Info */}
        <View style={{ backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, padding: 16, marginTop: 6, gap: 6 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: HG.ink }}>Withdrawals</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.ink2, lineHeight: 20 }}>
            Winnings are paid out to your linked method within 1–3 business days. Minimum withdrawal is $10. Funds in active matchups cannot be withdrawn until results are finalized.
          </Text>
        </View>

        {/* Section: Linked methods */}
        <View style={{ gap: 14 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Linked Methods
          </Text>

          {/* Empty state */}
          <View style={{ backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, borderStyle: 'dashed', padding: 28, alignItems: 'center', gap: 8 }}>
            <Svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={HG.muted2} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
              <Rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <Path d="M1 10h22" />
            </Svg>
            <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.muted, textAlign: 'center', lineHeight: 20 }}>
              No payout methods linked yet.{'\n'}Add a method below to withdraw winnings.
            </Text>
          </View>
        </View>

        {/* Section: Add method */}
        <View style={{ gap: 14 }}>
          <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Add Method
          </Text>

          <MethodRow
            icon={<BankIcon />}
            title="Bank Account (ACH)"
            subtitle="1–3 business days · No fee"
            badge="RECOMMENDED"
            badgeColor={HG.sky}
            onPress={onAddBankAccount}
          />

          <MethodRow
            icon={<CardIcon />}
            title="Debit Card"
            subtitle="Instant payout · Coming soon"
            badge="SOON"
            badgeColor={HG.muted}
            onPress={onAddDebitCard}
          />
        </View>

        {/* KYC note */}
        <View style={{ backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline, padding: 16, gap: 6 }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: HG.muted }}>Identity Verification Required</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: HG.muted2, lineHeight: 20 }}>
            You must verify your identity (KYC) before making your first withdrawal. This is required by US financial regulations.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MethodRow({
  icon,
  title,
  subtitle,
  badge,
  badgeColor,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: HG.surface, borderRadius: 14, borderWidth: 1, borderColor: HG.hairline,
        padding: 16, opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: HG.hairline, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: HG.ink }}>{title}</Text>
          {badge ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: badgeColor + '22', borderWidth: 1, borderColor: badgeColor + '44' }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 8, color: badgeColor, letterSpacing: 0.8 }}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted }}>{subtitle}</Text>
      </View>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={HG.muted2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="m9 18 6-6-6-6" />
      </Svg>
    </Pressable>
  );
}

function BankIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={HG.sky} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Path d="M9 22V12h6v10" />
    </Svg>
  );
}

function CardIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={HG.muted} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <Path d="M1 10h22" />
    </Svg>
  );
}
