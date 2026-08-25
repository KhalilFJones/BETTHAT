import { useEffect, useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import {
  formatVoiceDuration, ensurePlaybackSession, MAX_VOICE_MS, type VoiceStage,
} from '@/hooks/useVoiceNote';

// =============================================================================
// Voice capture, following iMessage's three stages:
//
//   idle       a mic button beside the text field
//   recording  a pill whose waveform is driven by the live microphone level,
//              in red, with the elapsed time and a square stop button
//   review     an X to discard, then a pill with play/pause, the take's own
//              waveform, its length, and the send button
//
// The waveform is real: bars come from expo-audio's metering, sampled every
// ~90ms while recording, so the shape tracks how loudly the person is actually
// speaking. The same captured samples are reused in review, which is why the
// reviewed shape matches what was drawn live.
// =============================================================================

const REC_RED = '#D6453C';
const BAR_W = 2.5;
const BAR_GAP = 2;
/** Bars visible at once. Live capture scrolls; review downsamples to fit. */
const BARS = 38;

export function VoiceRecorderBar({
  theme,
  stage,
  durationMs,
  levels,
  recordedUri,
  uploading,
  onStart,
  onStop,
  onSend,
  onDiscard,
  disabled,
}: {
  theme: Theme;
  stage: VoiceStage;
  durationMs: number;
  levels: number[];
  recordedUri: string | null;
  uploading: boolean;
  onStart: () => void;
  onStop: () => void;
  onSend: () => void;
  onDiscard: () => void;
  disabled?: boolean;
}) {
  // The DB rejects anything past the ceiling, so stop before we get there
  // rather than losing the recording on insert.
  useEffect(() => {
    if (stage === 'recording' && durationMs >= MAX_VOICE_MS) onStop();
  }, [stage, durationMs, onStop]);

  if (uploading) {
    return (
      <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="small" />
      </View>
    );
  }

  if (stage === 'idle') {
    return (
      <Pressable
        onPress={onStart}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Record a voice note"
        style={{
          width: 40, height: 40, borderRadius: 100,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: theme.surfaceSunken,
          borderWidth: 1, borderColor: theme.hairline,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <MicIcon color={theme.ink} />
      </Pressable>
    );
  }

  if (stage === 'recording') {
    // Newest samples only, so the trace scrolls like a tape head.
    const visible = levels.slice(-BARS);
    return (
      <View
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
          height: 48, paddingLeft: 16, paddingRight: 6, borderRadius: 24,
          backgroundColor: theme.surfaceRaised,
        }}
      >
        <Waveform bars={visible} color={REC_RED} height={26} align="right" />

        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 13, color: theme.ink, minWidth: 34, textAlign: 'right' }}>
          {formatVoiceDuration(durationMs)}
        </Text>

        <Pressable
          onPress={onStop}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
          style={{
            width: 36, height: 36, borderRadius: 100,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(214, 69, 60, 0.22)',
          }}
        >
          <View style={{ width: 13, height: 13, borderRadius: 3, backgroundColor: REC_RED }} />
        </Pressable>
      </View>
    );
  }

  // ── review ────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable
        onPress={onDiscard}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Discard voice note"
        style={{
          width: 36, height: 36, borderRadius: 100,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: theme.surfaceRaised,
        }}
      >
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round">
          <Path d="M18 6 6 18M6 6l12 12" />
        </Svg>
      </Pressable>

      <ReviewPill
        theme={theme}
        uri={recordedUri}
        levels={levels}
        durationMs={durationMs}
        onSend={onSend}
      />
    </View>
  );
}

// =============================================================================

function ReviewPill({
  theme, uri, levels, durationMs, onSend,
}: {
  theme: Theme; uri: string | null; levels: number[]; durationMs: number; onSend: () => void;
}) {
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);

  // The whole take squeezed into the pill, so the reviewed shape is the shape
  // that was drawn live rather than a fresh decoration.
  const bars = useMemo(() => downsample(levels, BARS), [levels]);

  const total = status.duration > 0 ? status.duration : durationMs / 1000;
  const played = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  // In review the number counts UP as it plays, matching iMessage.
  const shown = status.playing ? status.currentTime * 1000 : durationMs;

  const toggle = async () => {
    try {
      if (status.playing) { player.pause(); return; }
      // The session was in capture mode a moment ago; claim it for playback.
      await ensurePlaybackSession();
      if (status.didJustFinish || (total > 0 && status.currentTime >= total - 0.05)) player.seekTo(0);
      player.play();
    } catch {
      // Preview is optional — a failure here must not block sending.
    }
  };

  return (
    <View
      style={{
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
        height: 48, paddingLeft: 6, paddingRight: 6, borderRadius: 24,
        backgroundColor: theme.surfaceRaised,
      }}
    >
      <Pressable
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause preview' : 'Play preview'}
        style={{
          width: 36, height: 36, borderRadius: 100,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: theme.hairline2,
        }}
      >
        {status.playing ? (
          <Svg width={13} height={13} viewBox="0 0 24 24" fill={theme.ink}>
            <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </Svg>
        ) : (
          <Svg width={13} height={13} viewBox="0 0 24 24" fill={theme.ink}>
            <Path d="M7 4v16l13-8z" />
          </Svg>
        )}
      </Pressable>

      <Waveform bars={bars} color={theme.ink2} height={26} progress={played} playedColor={theme.accent} />

      <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: theme.muted, minWidth: 34, textAlign: 'right' }}>
        {formatVoiceDuration(shown)}
      </Text>

      <Pressable
        onPress={onSend}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Send voice note"
        style={{
          width: 36, height: 36, borderRadius: 100,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: theme.accent,
        }}
      >
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={theme.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M12 19V5M5 12l7-7 7 7" />
        </Svg>
      </Pressable>
    </View>
  );
}

/** Bar trace. `progress` tints the played portion; omit it for live capture. */
function Waveform({
  bars, color, height, progress, playedColor, align = 'left',
}: {
  bars: number[];
  color: string;
  height: number;
  progress?: number;
  playedColor?: string;
  /** Live capture pins the newest bar to the right edge. */
  align?: 'left' | 'right';
}) {
  // Always occupy the full slot so the pill doesn't resize as bars accumulate.
  const padded = bars.length >= BARS
    ? bars
    : align === 'right'
      ? [...Array(BARS - bars.length).fill(0), ...bars]
      : [...bars, ...Array(BARS - bars.length).fill(0)];

  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: BAR_GAP, height }}>
      {padded.map((amp, i) => {
        const isPlayed = progress != null && i / BARS <= progress;
        return (
          <View
            key={i}
            style={{
              width: BAR_W,
              // A floor keeps silence as a dotted baseline rather than a gap,
              // which is what iMessage shows between words.
              height: Math.max(2, amp * height),
              borderRadius: BAR_W,
              backgroundColor: isPlayed ? (playedColor ?? color) : color,
              opacity: amp === 0 ? 0.35 : 1,
            }}
          />
        );
      })}
    </View>
  );
}

/** Average-pool an arbitrary sample count down to `n` bars. */
function downsample(values: number[], n: number): number[] {
  if (values.length === 0) return [];
  if (values.length <= n) return values;
  const out: number[] = [];
  const bucket = values.length / n;
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * bucket);
    const to = Math.max(from + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    for (let j = from; j < to; j++) sum += values[j];
    out.push(sum / (to - from));
  }
  return out;
}

function MicIcon({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </Svg>
  );
}
