import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { setUserContext } from '@/lib/sentry';
import type { Profile, Wallet } from '@/lib/database.types';

export function useAuth() {
  const {
    session, user, profile, wallet, isLoading, isInitialized,
    setSession, setProfile, setWallet, setLoading, setInitialized, reset,
  } = useAuthStore();

  // Track active realtime subscriptions so we can tear down on signout / unmount.
  const channelsRef = useRef<{ wallet?: any; profile?: any }>({});
  // Guard against double-subscribe: getSession + onAuthStateChange both fire on mount.
  const subscribedUserRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchUserData(session.user.id);
        subscribeToUser(session.user.id);
        setUserContext(session.user.id);
      } else {
        setLoading(false);
        setInitialized(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          await fetchUserData(session.user.id);
          subscribeToUser(session.user.id);
          setUserContext(session.user.id);
        } else {
          tearDownSubs();
          setUserContext(null);
          reset();
          setInitialized(true);
        }
      },
    );

    return () => {
      subscription.unsubscribe();
      tearDownSubs();
    };
  }, []);

  async function fetchUserData(userId: string) {
    setLoading(true);
    try {
      // H-15: use maybeSingle so a missing row (signup race) doesn't throw.
      const [profileRes, walletRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      setProfile((profileRes.data as Profile | null) ?? null);
      setWallet((walletRes.data as Wallet | null) ?? null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('fetchUserData error:', e);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }

  // H-14: subscribe to wallet + profile updates so server-side changes (matchup
  // payouts, deposits via Stripe webhook, etc.) reflect on the client without
  // a manual refetch.
  function subscribeToUser(userId: string) {
    // Guard: set ref FIRST to block any concurrent/re-entrant calls for same user.
    // Both getSession() and onAuthStateChange fire on mount — the second call
    // sees the ref already set and exits before touching any channels.
    if (subscribedUserRef.current === userId) return;
    subscribedUserRef.current = userId;

    // Remove any stale channels without touching subscribedUserRef.
    if (channelsRef.current.wallet) {
      supabase.removeChannel(channelsRef.current.wallet);
      channelsRef.current.wallet = undefined;
    }
    if (channelsRef.current.profile) {
      supabase.removeChannel(channelsRef.current.profile);
      channelsRef.current.profile = undefined;
    }

    channelsRef.current.wallet = supabase
      .channel(`wallet:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${userId}` },
        (payload) => setWallet(payload.new as Wallet),
      )
      .subscribe();
    channelsRef.current.profile = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => setProfile(payload.new as Profile),
      )
      .subscribe();
  }

  function tearDownSubs() {
    subscribedUserRef.current = null;
    if (channelsRef.current.wallet) {
      supabase.removeChannel(channelsRef.current.wallet);
      channelsRef.current.wallet = undefined;
    }
    if (channelsRef.current.profile) {
      supabase.removeChannel(channelsRef.current.profile);
      channelsRef.current.profile = undefined;
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    tearDownSubs();
    reset();
  };

  return { session, user, profile, wallet, isLoading, isInitialized, signOut };
}
