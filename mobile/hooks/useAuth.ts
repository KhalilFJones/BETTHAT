import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

export function useAuth() {
  const { session, user, profile, wallet, isLoading, isInitialized,
          setSession, setProfile, setWallet, setLoading, setInitialized, reset } = useAuthStore();

  useEffect(() => {
    // Restore session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchUserData(session.user.id);
      } else {
        setLoading(false);
        setInitialized(true);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          await fetchUserData(session.user.id);
        } else {
          reset();
          setInitialized(true);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserData(userId: string) {
    setLoading(true);
    try {
      const [profileRes, walletRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('wallets').select('*').eq('user_id', userId).single(),
      ]);
      setProfile(profileRes.data ?? null);
      setWallet(walletRes.data ?? null);
    } catch (e) {
      console.error('fetchUserData error:', e);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    reset();
  };

  return { session, user, profile, wallet, isLoading, isInitialized, signOut };
}
