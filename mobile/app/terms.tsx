// =============================================================================
// BETTHAT — Terms of Service
// =============================================================================

import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { HG, FONT } from '@/lib/holygrail';

export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: HG.jet }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, gap: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HG.ink2} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
        <Text style={{ fontFamily: FONT.serif, fontSize: 24, color: HG.ink, letterSpacing: -0.3 }}>Terms of Service</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 60, gap: 22 }}>
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, color: HG.muted, letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 8 }}>
          Last updated: January 1, 2025 · Version 1.0
        </Text>

        <Section title="1. Eligibility">
          You must be at least 18 years of age and located in an eligible state to use BETTHAT. By creating an account you represent that you meet these requirements. We reserve the right to verify your identity and age at any time.
        </Section>

        <Section title="2. Skill-Based Game">
          BETTHAT is a skill-based fantasy sports game. Outcomes are determined by real-world NBA player performance, not chance. You are competing against other users on the basis of your knowledge and judgment.
        </Section>

        <Section title="3. Real-Money Play">
          BETTHAT involves real money. You can win or lose money. Deposit only what you can afford to lose. We are not responsible for losses incurred during normal gameplay.
        </Section>

        <Section title="4. Responsible Gaming">
          We offer deposit limits, loss limits, and self-exclusion tools. If you believe you have a gambling problem, please use these tools or contact the National Problem Gambling Helpline at 1-800-522-4700.
        </Section>

        <Section title="5. Account Security">
          You are responsible for maintaining the confidentiality of your account credentials. Notify us immediately at support@betthat.com if you suspect unauthorized use of your account.
        </Section>

        <Section title="6. Prohibited Conduct">
          You may not use bots, scripts, or automated tools. You may not share accounts. You may not attempt to manipulate game outcomes or engage in collusion with other users.
        </Section>

        <Section title="7. Fees and Rake">
          BETTHAT charges a 3.5% rake on the winning pot of each matchup. All fees are disclosed prior to submission.
        </Section>

        <Section title="8. Withdrawals">
          Withdrawals are processed within 1–3 business days. A minimum withdrawal of $10 applies. Funds held in escrow during active matchups are not available for withdrawal until the matchup concludes.
        </Section>

        <Section title="9. Intellectual Property">
          All content, design, and technology in BETTHAT is the property of BETTHAT Inc. and may not be reproduced without permission.
        </Section>

        <Section title="10. Dispute Resolution">
          Any disputes shall be resolved by binding arbitration in accordance with the rules of the American Arbitration Association. You waive any right to a jury trial.
        </Section>

        <Section title="11. Limitation of Liability">
          BETTHAT shall not be liable for indirect, incidental, or consequential damages. Our total liability to you shall not exceed the amount deposited by you in the 30 days preceding the claim.
        </Section>

        <Section title="12. Changes to Terms">
          We may update these Terms at any time. Continued use of BETTHAT after changes constitutes acceptance. We will notify you of material changes via in-app notification.
        </Section>

        <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: HG.muted2, textAlign: 'center', marginTop: 16, lineHeight: 18 }}>
          Questions? Contact us at support@betthat.com
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: FONT.sansBold, fontSize: 14, color: HG.ink, letterSpacing: 0.2 }}>{title}</Text>
      <Text style={{ fontFamily: FONT.sans, fontSize: 14, color: HG.ink2, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}
