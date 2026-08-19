// =============================================================================
// BETTHAT — Post feed / composer (Figma "Insight – Create" frame)
// Full-screen page pushed from the Social Feed's "+ Post" button. Three
// stacked cards on the Greyscale/50 page, 8px apart:
//   1. Top Bar — back / "Post feed" / help round buttons.
//   2. Composer — 48px avatar, name + verified tick, live "n/5000" counter,
//      an audience selector pill, and a flex-filling text area.
//   3. Footer — the dark full-width Post button.
//
// The verified tick is driven by profiles.kyc_status ('verified'), which is
// the only real verification signal the schema carries.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, Image, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { FONT } from '@/lib/holygrail';
import { useTheme, type Theme } from '@/lib/theme';
import { SharedMatchupCard, type MatchupSnapshot } from '@/components/social/SharedMatchupCard';
import { GifPicker, type GifResult } from '@/components/social/GifPicker';
import { buildMatchupSnapshot, matchupPhaseLabel, useShareableMatchups, type ShareableMatchup } from '@/hooks/social/useShareableMatchups';

const MAX_BODY = 5000; // matches the social_posts_body_check constraint

const AUDIENCES = [
  { key: 'everyone', label: 'Everyone', blurb: 'Anyone on BETTHAT can see this post.' },
  { key: 'friends', label: 'Friends', blurb: 'Only people you’re friends with can see it.' },
] as const;
type Audience = (typeof AUDIENCES)[number]['key'];

export default function ComposeScreen() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuthStore();
  const { matchup: presetMatchupId } = useLocalSearchParams<{ matchup?: string }>();

  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [matchupOpen, setMatchupOpen] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [gif, setGif] = useState<GifResult | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [attached, setAttached] = useState<{ id: string; snapshot: MatchupSnapshot } | null>(null);

  const { data: me } = useQuery({
    queryKey: ['compose-profile', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, kyc_status')
        .eq('id', profile.id)
        .maybeSingle();
      return data;
    },
    enabled: !!profile?.id,
  });

  // Arriving from "Share Result" — preload that matchup as the attachment.
  const { data: preset } = useShareableMatchups(presetMatchupId ? profile?.id : undefined);
  useEffect(() => {
    if (!presetMatchupId || attached || !preset || !profile?.id) return;
    const m = preset.find((x) => x.id === presetMatchupId);
    if (!m) return;
    const snap = buildMatchupSnapshot(m, profile.id);
    if (snap) setAttached({ id: m.id, snapshot: snap });
  }, [presetMatchupId, preset, attached, profile?.id]);

  const trimmed = body.trim();
  // An attached matchup is postable on its own — the body is optional then.
  const canPost = (trimmed.length > 0 || !!attached || !!gif) && trimmed.length <= MAX_BODY;

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error('Not signed in');
      const { error } = await supabase.from('social_posts').insert({
        user_id: profile.id,
        // body is nullable now — a GIF-only or matchup-only post is valid.
        body: trimmed || null,
        gif_url: gif?.url ?? null,
        audience,
        allow_comments: allowComments,
        matchup_id: attached?.id ?? null,
        matchup_snapshot: (attached?.snapshot ?? null) as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-feed'] });
      router.back();
    },
    onError: (err: any) => Alert.alert('Could not post', err?.message ?? 'Try again.'),
  });

  const name = me?.display_name || me?.username || 'You';
  const verified = me?.kyc_status === 'verified';
  const audienceLabel = AUDIENCES.find((a) => a.key === audience)?.label ?? 'Everyone';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ═══ Top Bar card ═══════════════════════════════════════════════ */}
        <View style={s.card}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <RoundIconBtn theme={theme} label="Discard and go back" onPress={() => confirmDiscard(trimmed.length > 0 || !!attached || !!gif, () => router.back())}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m15 18-6-6 6-6" />
              </Svg>
            </RoundIconBtn>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 18, lineHeight: 23.4, color: theme.ink, letterSpacing: -0.18 }}>
              Post feed
            </Text>
            <RoundIconBtn theme={theme} label="Posting guidelines" onPress={() => setHelpOpen(true)}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                <Path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.6" />
                <Path d="M12 17h.01" />
              </Svg>
            </RoundIconBtn>
          </View>
        </View>

        <View style={{ height: 8 }} />

        {/* ═══ Composer card ══════════════════════════════════════════════ */}
        <View style={[s.card, { flex: 1, padding: 16, gap: 16 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {me?.avatar_url ? (
                <Image source={{ uri: me.avatar_url }} style={{ width: 48, height: 48, borderRadius: 9999 }} />
              ) : (
                <View style={{ width: 48, height: 48, borderRadius: 9999, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: FONT.sansBold, fontSize: 20, color: theme.ink }}>
                    {name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24, color: theme.ink }}>
                    {name}
                  </Text>
                  {verified ? <VerifiedTick theme={theme} /> : null}
                </View>
                <Text style={{ fontFamily: FONT.sans, fontSize: 14, lineHeight: 21, color: body.length > MAX_BODY ? theme.danger : theme.muted }}>
                  {body.length}/{MAX_BODY}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => setAudienceOpen(true)}
              accessibilityLabel={`Audience: ${audienceLabel}. Change who can see this post`}
              style={{
                height: 36, paddingLeft: 12, paddingRight: 16, borderRadius: 100,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
              }}
            >
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21.7, color: theme.ink }}>
                {audienceLabel}
              </Text>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m6 9 6 6 6-6" />
              </Svg>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 16, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Comment permission — enforced in RLS, so switching this off
                actually rejects comment inserts rather than hiding a button. */}
            <Pressable
              onPress={() => setAllowComments((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: allowComments }}
              accessibilityLabel={allowComments ? 'Comments allowed. Tap to turn off.' : 'Comments off. Tap to allow.'}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, marginBottom: 14,
                backgroundColor: theme.surfaceSunken,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, lineHeight: 21, color: theme.ink }}>
                  {allowComments ? 'Allow Comments' : "Don't Allow Comments"}
                </Text>
                <Text style={{ fontFamily: FONT.sans, fontSize: 12, lineHeight: 18, color: theme.muted }}>
                  {allowComments ? 'Anyone who can see this post can reply.' : 'Nobody can reply to this post.'}
                </Text>
              </View>
              <View style={{
                width: 46, height: 28, borderRadius: 100, padding: 3,
                backgroundColor: allowComments ? theme.accent : theme.hairline2,
                alignItems: allowComments ? 'flex-end' : 'flex-start', justifyContent: 'center',
              }}>
                <View style={{ width: 22, height: 22, borderRadius: 100, backgroundColor: theme.surface }} />
              </View>
            </Pressable>

            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Write your ideas here"
              placeholderTextColor={theme.muted}
              multiline
              autoFocus
              maxLength={MAX_BODY}
              textAlignVertical="top"
              accessibilityLabel="Post body"
              style={{
                minHeight: attached ? 72 : 180, padding: 0,
                fontFamily: FONT.sans, fontSize: 16, lineHeight: 24, color: theme.ink,
              }}
            />

            {/* GIF sits inline under the text, independent of any matchup —
                both can be on the same post. */}
            {gif ? (
              <View style={{ position: 'relative', alignSelf: 'flex-start', marginBottom: 4 }}>
                <Image
                  source={{ uri: gif.preview }}
                  style={{ width: 200, height: 200, borderRadius: 14, backgroundColor: theme.surfaceSunken }}
                  resizeMode="cover"
                  accessibilityLabel="Attached GIF"
                />
                <Pressable
                  onPress={() => setGif(null)}
                  accessibilityLabel="Remove GIF"
                  hitSlop={6}
                  style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 100, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.8} strokeLinecap="round">
                    <Path d="M18 6 6 18M6 6l12 12" />
                  </Svg>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setGifOpen(true)}
                accessibilityLabel="Search for and add a GIF"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
                  height: 40, paddingLeft: 12, paddingRight: 16, borderRadius: 100,
                  backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
                }}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M3 5h18v14H3z" />
                  <Path d="M8.5 10.5a2.5 2.5 0 1 0 0 3h.5v-1.5" />
                  <Path d="M13 9.5v5M16 9.5v5M16 12h2.5M16 9.5h3" />
                </Svg>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>Add a GIF</Text>
              </Pressable>
            )}

            {attached ? (
              <View style={{ gap: 8 }}>
                <SharedMatchupCard snapshot={attached.snapshot} theme={theme} />
                <Pressable
                  onPress={() => setAttached(null)}
                  accessibilityLabel="Remove attached matchup"
                  style={{ alignSelf: 'flex-start', height: 36, paddingHorizontal: 14, borderRadius: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceSunken }}
                >
                  <Text style={{ fontFamily: FONT.sansMedium, fontSize: 13, color: theme.muted }}>Remove matchup</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setMatchupOpen(true)}
                accessibilityLabel="Attach one of your matchups"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
                  height: 40, paddingLeft: 12, paddingRight: 16, borderRadius: 100,
                  backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline,
                }}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M4 5h16v14H4zM4 10h16M12 10v9" />
                </Svg>
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>Share a matchup</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>

        <View style={{ height: 8 }} />

        {/* ═══ Footer card ════════════════════════════════════════════════ */}
        <View style={[s.card, { paddingHorizontal: 16, paddingTop: 16 }]}>
          <SafeAreaView edges={['bottom']}>
            <Pressable
              onPress={() => postMutation.mutate()}
              disabled={!canPost || postMutation.isPending}
              accessibilityLabel="Publish post"
              style={{
                height: 48, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
                backgroundColor: theme.ink,
                // The export keeps the dark fill in its Disabled state; dimming
                // it is the only cue that an empty post can't be published.
                opacity: canPost ? 1 : 0.45,
                marginBottom: 16,
              }}
            >
              {postMutation.isPending ? (
                <ActivityIndicator color={theme.surface} />
              ) : (
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, lineHeight: 24.8, color: theme.surface }}>
                  Post
                </Text>
              )}
            </Pressable>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>

      <AudienceSheet
        theme={theme}
        visible={audienceOpen}
        value={audience}
        onSelect={(a) => { setAudience(a); setAudienceOpen(false); }}
        onClose={() => setAudienceOpen(false)}
      />
      <MatchupPicker
        theme={theme}
        visible={matchupOpen}
        meId={profile?.id}
        onClose={() => setMatchupOpen(false)}
        onSelect={(m) => {
          const snap = buildMatchupSnapshot(m, profile!.id);
          if (snap) setAttached({ id: m.id, snapshot: snap });
          setMatchupOpen(false);
        }}
      />
      <GifPicker theme={theme} visible={gifOpen} onClose={() => setGifOpen(false)} onSelect={setGif} />
      <HelpSheet theme={theme} visible={helpOpen} onClose={() => setHelpOpen(false)} />
    </SafeAreaView>
  );
}

function confirmDiscard(dirty: boolean, onDiscard: () => void) {
  if (!dirty) return onDiscard();
  Alert.alert('Discard post?', "You'll lose what you've written.", [
    { text: 'Keep writing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onDiscard },
  ]);
}

/** Figma "Button/Secondary" — 40x40 pill with the Greyscale/100 hairline. */
function RoundIconBtn({ theme, label, onPress, children }: { theme: Theme; label: string; onPress: () => void; children: React.ReactNode }) {
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

function VerifiedTick({ theme }: { theme: Theme }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" accessibilityLabel="Verified account">
      <Circle cx={12} cy={12} r={11} fill={theme.accent} />
      <Path d="m7.5 12.4 3 3 6-6.4" fill="none" stroke={theme.onAccent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function MatchupPicker({
  theme, visible, meId, onClose, onSelect,
}: {
  theme: Theme; visible: boolean; meId?: string;
  onClose: () => void; onSelect: (m: ShareableMatchup) => void;
}) {
  const { data, isLoading } = useShareableMatchups(visible ? meId : undefined);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, maxHeight: '80%' }}
        >
          <View style={{ alignItems: 'center', marginBottom: 10 }}>
            <View style={{ width: 40, height: 5, borderRadius: 100, backgroundColor: theme.hairline2 }} />
          </View>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink, marginBottom: 4 }}>Share a matchup</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, marginBottom: 14 }}>
            Live and upcoming matchups keep scoring in the feed as the games play out.
          </Text>

          {isLoading ? (
            <ActivityIndicator color={theme.accent} />
          ) : (data ?? []).length === 0 ? (
            <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, paddingVertical: 20, textAlign: 'center' }}>
              You have no matchups to share yet — draft a lineup and place an order first.
            </Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(data ?? []).map((m) => {
                const iAmUser1 = m.user1_id === meId;
                const opp = iAmUser1 ? m.u2 : m.u1;
                const oppName = opp?.display_name || opp?.username || 'Waiting for opponent';
                const phase = matchupPhaseLabel(m.status, m.game_date);
                const live = m.status === 'live';
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => onSelect(m)}
                    accessibilityLabel={`Share matchup versus ${oppName}`}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
                      backgroundColor: theme.surfaceSunken, borderWidth: 1, borderColor: theme.hairline,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink }}>
                        vs. {oppName}
                      </Text>
                      <Text style={{ fontFamily: FONT.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>
                        {phase} · {new Date(m.game_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                      </Text>
                    </View>
                    {live ? (
                      <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 100, backgroundColor: '#FAEDED' }}>
                        <Text style={{ fontFamily: FONT.sansBold, fontSize: 11, color: theme.danger }}>LIVE</Text>
                      </View>
                    ) : null}
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <Path d="m9 6 6 6-6 6" />
                    </Svg>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AudienceSheet({
  theme, visible, value, onSelect, onClose,
}: {
  theme: Theme; visible: boolean; value: Audience; onSelect: (a: Audience) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 8 }}
        >
          <View style={{ alignItems: 'center', marginBottom: 6 }}>
            <View style={{ width: 40, height: 5, borderRadius: 100, backgroundColor: theme.hairline2 }} />
          </View>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink, marginBottom: 6 }}>Who can see this?</Text>
          {AUDIENCES.map((a) => {
            const active = a.key === value;
            return (
              <Pressable
                key={a.key}
                onPress={() => onSelect(a.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  padding: 14, borderRadius: 14,
                  backgroundColor: active ? theme.accentWash : theme.surfaceSunken,
                  borderWidth: 1, borderColor: active ? theme.accentEdge : theme.hairline,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.sansBold, fontSize: 15, color: theme.ink }}>{a.label}</Text>
                  <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, marginTop: 2 }}>{a.blurb}</Text>
                </View>
                {active ? (
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="m5 12.5 5 5 9-10" />
                  </Svg>
                ) : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

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
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink, marginBottom: 14 }}>Posting to the feed</Text>
          <HelpRow theme={theme} title="Who sees it" body="Everyone posts land in the public feed. Friends-only posts are visible to you and your accepted friends, and nobody else." />
          <HelpRow theme={theme} title="Mentions" body="Type a player's ticker in caps — LEBJ23 — or a dollar amount, and it renders highlighted in the feed." />
          <HelpRow theme={theme} title="Keep it clean" body="No abuse, no sharing other people's personal details, and nothing that misrepresents an official BETTHAT account." last />
          <Pressable onPress={onClose} style={{ height: 48, borderRadius: 100, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', marginTop: 20 }}>
            <Text style={{ fontFamily: FONT.sansMedium, fontSize: 16, color: theme.surface }}>Got it</Text>
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

function styles(t: Theme) {
  return {
    card: {
      backgroundColor: t.surface,
      borderRadius: 20,
      shadowColor: '#151517',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: t.mode === 'light' ? 0.05 : 0,
      shadowRadius: 8,
      elevation: t.mode === 'light' ? 2 : 0,
    },
  };
}
