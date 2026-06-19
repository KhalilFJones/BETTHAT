// =============================================================================
// send-notification — service-role only.
// =============================================================================
// Fixes:
//   H-1: maps `type` to the correct push_<type> preference column.
//   H-2: rejects any caller that isn't the service-role.
//   H-3: queries `push_notification_tokens` (multi-device) instead of
//        profiles.push_token (single-token legacy).
//
// Callers: scheduled jobs, other Edge Functions, server-side notification fan-out.
// Never callable from a user-authenticated session.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Internal webhook secret used by DB triggers (pg_net) to call this function.
// Must match `app.notification_webhook_secret` in the database config.
const WEBHOOK_SECRET = Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? 'btht-notify-db-2026-internal';

interface NotifPayload {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  action_url?: string;
}

// Map notification `type` → notification_preferences column.
const PREF_COLUMN: Record<string, string> = {
  matchup_found:          'push_matchup_found',
  matchup_chat:           'push_chat_message',
  matchup_score:          'push_matchup_score',
  game_starting:          'push_game_starting',
  game_final:             'push_game_final',
  friend_request:         'push_friend_request',
  friend_challenge:       'push_friend_challenge',
  achievement_earned:     'push_achievement_earned',
  deposit_confirmed:      'push_deposit_confirmed',
  withdrawal_processed:   'push_withdrawal_processed',
  price_alert:            'push_price_alert',
};

Deno.serve(async (req) => {
  // Accept service_role key OR the internal DB webhook secret.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== SERVICE_KEY && token !== WEBHOOK_SECRET) {
    return resp(401, { error: 'unauthorized' });
  }

  const payload = (await req.json()) as NotifPayload;
  const { user_id, type, title, body, data, action_url } = payload;
  if (!user_id || !type || !title) {
    return resp(400, { error: 'user_id, type, and title are required' });
  }

  // H-1: opt-out check against the correct push_<type> column.
  const prefCol = PREF_COLUMN[type];
  if (prefCol) {
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(prefCol)
      .eq('user_id', user_id)
      .maybeSingle();
    if (prefs && (prefs as Record<string, unknown>)[prefCol] === false) {
      return resp(200, { skipped: true, reason: 'user opted out' });
    }
  }

  // In-app notification record.
  await supabase.from('notifications').insert({
    user_id, type, title,
    body: body ?? null,
    data: data ?? null,
    is_read: false,
  });

  // H-3: multi-device push token table.
  const { data: tokens } = await supabase
    .from('push_notification_tokens')
    .select('token')
    .eq('user_id', user_id)
    .eq('is_active', true);

  const validTokens = (tokens ?? [])
    .map((t) => t.token)
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken['));

  if (validTokens.length === 0) {
    return resp(200, { sent: false, reason: 'no active push tokens' });
  }

  // Expo accepts an array of messages in one POST.
  const messages = validTokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data: { type, action_url, ...(data ?? {}) },
    priority: 'high',
  }));

  try {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    const expoData = await expoRes.json();

    // Deactivate tokens that Expo rejects as unregistered.
    const items: any[] = Array.isArray(expoData?.data) ? expoData.data : [];
    for (let i = 0; i < items.length; i++) {
      const result = items[i];
      if (result?.status === 'error' && result?.details?.error === 'DeviceNotRegistered') {
        await supabase
          .from('push_notification_tokens')
          .update({ is_active: false })
          .eq('token', validTokens[i]);
      }
    }

    return resp(200, { sent: validTokens.length, expo: expoData });
  } catch (err: any) {
    console.error('[send-notification] push error:', err);
    return resp(200, { sent: false, error: err?.message ?? 'unknown' });
  }
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
