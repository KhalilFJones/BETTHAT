// =============================================================================
// BETTHAT — Push Notifications
// Handles Expo push token registration, notification channels, and routing
// taps to the correct in-app screen.
// =============================================================================

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

// Expo Go (store client) does not support remote push notifications in SDK 53+.
// Detect it and skip push registration silently.
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  (Constants.executionEnvironment as string) === 'storeClient';

import { supabase } from './supabase';

// Show alerts + play sound + set badge when app is in foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Android channels
// ---------------------------------------------------------------------------
export async function setupAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('matchup', {
    name: 'Matchup Updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#00BFFF',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('chat', {
    name: 'Matchup Chat',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200],
    lightColor: '#00BFFF',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

// ---------------------------------------------------------------------------
// Permission + token registration
// ---------------------------------------------------------------------------
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push tokens are not supported in Expo Go — silently skip.
  if (isExpoGo) return null;

  await setupAndroidChannels();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[notifications] Permission denied');
    return null;
  }

  try {
    // projectId is required for standalone builds; in Expo Go it is inferred.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    return tokenData.data;
  } catch (err) {
    console.warn('[notifications] Could not get push token:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Save token to Supabase (upsert by user + token)
// ---------------------------------------------------------------------------
export async function savePushToken(userId: string, token: string) {
  const { error } = await supabase
    .from('push_notification_tokens')
    .upsert(
      {
        user_id: userId,
        token,
        platform: Platform.OS as 'ios' | 'android' | 'web',
        device_id: `${Platform.OS}-${token.slice(-8)}`,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );
  if (error) console.warn('[notifications] savePushToken error:', error.message);
}

// ---------------------------------------------------------------------------
// Deactivate token on logout
// ---------------------------------------------------------------------------
export async function deactivatePushToken(userId: string) {
  await supabase
    .from('push_notification_tokens')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

// ---------------------------------------------------------------------------
// Notification response routing hook
// Call once from RootLayout to handle taps on any notification.
// ---------------------------------------------------------------------------
export function useNotificationRouting() {
  const router = useRouter();
  const notifListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // When notification received while app is in foreground — just let the
    // built-in handler show the alert (already configured above).
    notifListener.current = Notifications.addNotificationReceivedListener(() => {
      // No-op: setNotificationHandler handles display.
    });

    // When user taps a notification (foreground, background, or killed).
    // Kept in sync with app/notifications.tsx's in-app-list handlePress() —
    // that switch covers every type in the `notifications_type_check`
    // constraint; this one only handled matchup_*/friend_request/wallet and
    // silently no-opped on friend_challenge, price_alert, and
    // achievement_earned taps that arrived while the app was backgrounded
    // or killed (the in-app list route worked; only the OS-tap path didn't).
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const type = data?.type as string | undefined;
      const matchupId = data?.matchup_id as string | undefined;
      const challengeId = data?.challenge_id as string | undefined;
      const fromUserId = data?.from_user_id as string | undefined;
      const playerId = data?.player_id as string | undefined;

      if (type === 'friend_challenge' && challengeId) {
        router.push(`/matchup/challenge/${challengeId}` as any);
      } else if (matchupId && (type === 'matchup_chat' || type === 'matchup_score' || type === 'matchup_found' || type === 'game_starting' || type === 'game_final')) {
        router.push(`/matchup/${matchupId}` as any);
      } else if (type === 'friend_request') {
        router.push(fromUserId ? (`/user/${fromUserId}` as any) : ('/friends' as any));
      } else if (type === 'deposit_confirmed' || type === 'withdrawal_processed') {
        router.push('/wallet' as any);
      } else if (type === 'price_alert' && playerId) {
        router.push(`/player/${playerId}` as any);
      } else if (type === 'achievement_earned') {
        router.push('/achievements' as any);
      }
    });

    return () => {
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);
}
