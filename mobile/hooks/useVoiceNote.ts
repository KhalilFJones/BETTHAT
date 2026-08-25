import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

// =============================================================================
// Voice notes, modelled on iMessage: record → review → send.
//
// Recording and sending are deliberately separate steps. The recorder stops
// into a `review` stage holding the local file, so the sender can play it back,
// discard it, or send it. Nothing is uploaded until they choose to send, which
// means an abandoned recording never costs a round trip or leaves an orphan in
// the bucket.
//
// Two iOS details this hook exists to hide:
//   • Recording mode must be switched on before capture and OFF afterwards.
//     Leaving it on routes later playback to the earpiece at low volume, which
//     reads as "the voice note is broken".
//   • The recorder's `uri` is only populated after stop() resolves.
//
// The DB caps a note at 2 minutes; recording stops itself at the same ceiling
// so an over-long note can't be rejected after the user has already spoken it.
// =============================================================================

export const MAX_VOICE_MS = 120_000;

// iOS audio-session modes. Recording needs the session switched to
// play-and-record and taken exclusively; playback has to switch it back, or
// the next play() fails with "Session activation failed" because the session
// is still configured for capture.
const RECORD_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
  interruptionMode: 'doNotMix',
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
} as const;

const PLAYBACK_MODE = {
  ...RECORD_MODE,
  allowsRecording: false,
  interruptionMode: 'duckOthers',
} as const;

/**
 * Puts the session into playback mode. Exported because every player has to
 * call it before play(): a failed or half-finished recording can leave the
 * session in capture mode, and playback then throws.
 */
export async function ensurePlaybackSession(): Promise<void> {
  try {
    await setAudioModeAsync(PLAYBACK_MODE);
  } catch {
    // Not fatal on its own — play() reports the real failure if there is one.
  }
}

/** How often the meter is polled — fast enough for a waveform that tracks the voice. */
const METER_INTERVAL_MS = 90;

/**
 * Safety valve on retained amplitude samples. Deliberately above what the
 * 2-minute ceiling can produce (120_000 / 90 = ~1334), so a normal recording
 * never loses its head — the review waveform draws the WHOLE take, and a
 * tighter cap would silently show only its tail.
 */
const MAX_LEVELS = 1600;

export type VoiceStage = 'idle' | 'recording' | 'review';

export interface RecordedVoiceNote {
  url: string;
  durationMs: number;
}

export function useVoiceNote() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const state = useAudioRecorderState(recorder, METER_INTERVAL_MS);

  const [stage, setStage] = useState<VoiceStage>('idle');
  const [uploading, setUploading] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedMs, setRecordedMs] = useState(0);
  /** Amplitudes captured while recording, 0..1, oldest first. */
  const [levels, setLevels] = useState<number[]>([]);

  const { profile } = useAuthStore();
  const stoppingRef = useRef(false);
  const lastSampleRef = useRef(0);

  const isRecording = state.isRecording;
  const durationMs = Math.round(state.durationMillis ?? 0);

  // expo-audio reports metering in dBFS: roughly -160 (silence) to 0 (peak).
  // Speech mostly lives in the top 50 dB, so that's the band we map onto the
  // bar height — using the full 160 would leave every bar a flat stub.
  //
  // In an effect, not the render body: this fires every 90ms while recording,
  // and queueing a state update mid-render is exactly the kind of work that
  // makes the surrounding list janky.
  useEffect(() => {
    if (!isRecording || state.metering == null) return;
    if (durationMs === lastSampleRef.current) return;
    lastSampleRef.current = durationMs;
    const amp = Math.max(0, Math.min(1, (state.metering + 50) / 50));
    setLevels((prev) => (
      // Only trims if something has gone wrong and recording overran the
      // ceiling; a normal take stays whole. See MAX_LEVELS.
      prev.length >= MAX_LEVELS ? [...prev.slice(1), amp] : [...prev, amp]
    ));
  }, [isRecording, state.metering, durationMs]);

  const start = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Microphone access needed',
        'BETTHAT needs microphone access to record a voice note. You can turn it on in Settings.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return false;
    }

    stoppingRef.current = false;
    lastSampleRef.current = 0;
    setLevels([]);
    setRecordedUri(null);
    setRecordedMs(0);

    try {
      await setAudioModeAsync(RECORD_MODE);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStage('recording');
      return true;
    } catch (e: any) {
      // Leaving the session in capture mode would break every player on the
      // screen, so hand it back before surfacing anything.
      await ensurePlaybackSession();
      setStage('idle');
      Alert.alert(
        'Could not start recording',
        'Another app may be using the microphone. Close it and try again.',
      );
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ends capture and moves to review. Nothing is uploaded yet. */
  const stop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    const captured = Math.min(Math.round(recorder.currentTime * 1000), MAX_VOICE_MS);
    try {
      await recorder.stop();
    } catch {
      // Already stopped, or never started cleanly — the session still has to
      // be handed back either way.
    }
    await ensurePlaybackSession();

    const uri = recorder.uri;
    // Under a second is almost always a mis-tap, not a message.
    if (!uri || captured < 700) {
      setStage('idle');
      setLevels([]);
      return;
    }

    setRecordedUri(uri);
    setRecordedMs(captured);
    setStage('review');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Uploads the reviewed take and resets. Returns null if it failed. */
  const upload = useCallback(async (): Promise<RecordedVoiceNote | null> => {
    if (!recordedUri || !profile?.id) return null;

    setUploading(true);
    try {
      const bytes = await (await fetch(recordedUri)).arrayBuffer();
      if (bytes.byteLength === 0) throw new Error('The recording came back empty.');

      const path = `${profile.id}/${Date.now()}.m4a`;
      const { error: uploadError } = await supabase.storage
        .from('voice-notes')
        .upload(path, bytes, { contentType: 'audio/m4a', upsert: false });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('voice-notes').getPublicUrl(path);
      const note = { url: data.publicUrl, durationMs: recordedMs };
      reset();
      return note;
    } catch (e: any) {
      Alert.alert('Could not send voice note', e?.message ?? 'The upload failed.');
      return null;
    } finally {
      setUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordedUri, recordedMs, profile?.id]);

  const reset = useCallback(() => {
    stoppingRef.current = false;
    lastSampleRef.current = 0;
    setStage('idle');
    setLevels([]);
    setRecordedUri(null);
    setRecordedMs(0);
  }, []);

  /** Abandons a take from either stage without uploading. */
  const discard = useCallback(async () => {
    if (stage === 'recording' && !stoppingRef.current) {
      stoppingRef.current = true;
      try {
        await recorder.stop();
      } catch {
        // Already stopped — nothing to unwind.
      }
      await ensurePlaybackSession();
    }
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, reset]);

  return {
    stage,
    start,
    stop,
    upload,
    discard,
    isRecording,
    /** Live while recording, frozen at the take's length in review. */
    durationMs: stage === 'review' ? recordedMs : durationMs,
    levels,
    recordedUri,
    uploading,
  };
}

/** 7400 -> "0:07" */
export function formatVoiceDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
