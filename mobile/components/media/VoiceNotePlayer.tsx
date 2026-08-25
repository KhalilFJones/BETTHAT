import { useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { formatVoiceDuration, ensurePlaybackSession } from '@/hooks/useVoiceNote';

// =============================================================================
// Voice note playback bubble — play/pause, a static waveform that fills as it
// plays, and the remaining time.
//
// The waveform is decorative: expo-audio only exposes real amplitude samples
// while a clip is playing, so drawing a true waveform would mean the bar
// heights changed on every play. A stable pseudo-random shape derived from the
// URL keeps each note visually distinct and consistent across renders.
//
// The native player is created EMPTY and only given its source on first play.
// A thread with twenty voice notes would otherwise stand up twenty native
// players at once, all holding the iOS audio session — which is what made
// starting a recording fail with "Session activation failed".
// =============================================================================

const BAR_COUNT = 27;

function barsFor(seed: string): number[] {
  // Cheap deterministic hash — same URL always yields the same silhouette.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    h = (h * 1664525 + 1013904223) >>> 0;
    // Bias toward mid heights so it reads as speech rather than noise.
    return 0.28 + ((h >>> 16) % 1000) / 1000 * 0.72;
  });
}

export function VoiceNotePlayer({
  url,
  durationMs,
  theme,
  tint,
  onTint,
  compact,
}: {
  url: string;
  /** Recorded length from the DB — shown before the file has loaded. */
  durationMs?: number | null;
  theme: Theme;
  /** Accent for the played portion and the play button. */
  tint?: string;
  /** Ink used on top of `tint`. */
  onTint?: string;
  compact?: boolean;
}) {
  // No source until the first tap — see the note above.
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const loadedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const accent = tint ?? theme.accent;
  const onAccent = onTint ?? theme.onAccent;

  const total = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  const remaining = Math.max(0, total - status.currentTime);

  const bars = barsFor(url);
  const size = compact ? 30 : 36;
  const barH = compact ? 18 : 22;

  const toggle = async () => {
    try {
      if (status.playing) {
        player.pause();
        return;
      }

      // Recording leaves the session in capture mode; playback has to claim it
      // back or play() throws.
      await ensurePlaybackSession();

      if (!loadedRef.current) {
        player.replace({ uri: url });
        loadedRef.current = true;
      } else if (status.didJustFinish || (total > 0 && status.currentTime >= total - 0.05)) {
        // didJustFinish leaves the head at the end; rewind so a second tap replays.
        player.seekTo(0);
      }

      player.play();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 8, paddingHorizontal: 10,
        borderRadius: 100, backgroundColor: theme.surfaceSunken,
        alignSelf: 'flex-start', maxWidth: 260,
      }}
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
        hitSlop={8}
        style={{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: accent, alignItems: 'center', justifyContent: 'center',
        }}
      >
        {status.playing ? (
          <Svg width={13} height={13} viewBox="0 0 24 24" fill={onAccent}>
            <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </Svg>
        ) : (
          <Svg width={13} height={13} viewBox="0 0 24 24" fill={onAccent}>
            <Path d="M7 4v16l13-8z" />
          </Svg>
        )}
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: barH }}>
        {bars.map((h, i) => {
          const played = i / BAR_COUNT <= progress;
          return (
            <View
              key={i}
              style={{
                width: 2.5,
                height: Math.max(3, barH * h),
                borderRadius: 2,
                backgroundColor: played ? accent : theme.hairline2,
              }}
            />
          );
        })}
      </View>

      <Text
        style={{ fontFamily: FONT.monoMedium, fontSize: 11, color: failed ? theme.danger : theme.muted, minWidth: 30 }}
        accessibilityLabel={failed ? 'Voice note failed to play' : `${formatVoiceDuration(remaining * 1000)} remaining`}
      >
        {failed ? '--:--' : formatVoiceDuration(remaining * 1000)}
      </Text>
    </View>
  );
}
