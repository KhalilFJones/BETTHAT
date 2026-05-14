import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface NotifPayload {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, string>;
  action_url?: string;
}

/**
 * Stores a notification in user_notifications and sends
 * an Expo push notification if the user has a push token.
 */
Deno.serve(async (req) => {
  const payload: NotifPayload = await req.json();
  const { user_id, type, title, body, data, action_url } = payload;

  if (!user_id || !type || !title) {
    return resp(400, { error: 'user_id, type, and title are required.' });
  }

  // Check notification preferences
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user_id)
    .single();

  const prefKey = type as keyof typeof prefs;
  if (prefs && prefs[prefKey] === false) {
    return resp(200, { skipped: true, reason: 'User opted out of this notification type' });
  }

  // Insert in-app notification
  await supabase.from('notifications').insert({
    user_id,
    type,
    title,
    body: body ?? null,
    data: data ?? null,
    is_read: false,
  });

  // Get user's push token
  const { data: profile } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', user_id)
    .single();

  const pushToken = profile?.push_token;
  if (!pushToken || !pushToken.startsWith('ExponentPushToken[')) {
    return resp(200, { sent: false, reason: 'No valid push token' });
  }

  // Send via Expo Push Notifications API
  const expoPayload = {
    to: pushToken,
    sound: 'default',
    title,
    body,
    data: { type, action_url, ...(data ?? {}) },
    priority: 'high',
  };

  try {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expoPayload),
    });

    const expoData = await expoRes.json();

    if (expoData?.data?.status === 'error') {
      // If invalid token, clear it
      if (expoData.data.details?.error === 'DeviceNotRegistered') {
        await supabase.from('profiles').update({ push_token: null }).eq('id', user_id);
      }
      console.error('Expo push error:', expoData.data.details);
    }

    return resp(200, { sent: true, expo_status: expoData?.data?.status });
  } catch (err: any) {
    console.error('Push send error:', err);
    return resp(200, { sent: false, error: err.message });
  }
});

function resp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
