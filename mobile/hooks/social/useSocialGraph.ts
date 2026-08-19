import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';

// =============================================================================
// Social graph — follows and friends.
//
// These are two different relationships and the feed treats them differently:
//   • follows — one-way. You follow them; they need not follow back.
//   • friends — DERIVED: you follow each other. No request, no approval.
//
// `user_follows` is the single source of truth; the old friends request table
// was backfilled into it in both directions. Everything below reads from it,
// so "friends" can never drift out of sync with "mutual follow".
// =============================================================================

/** Everyone the given user follows. */
export function useFollowing(userId: string | undefined) {
  return useQuery({
    queryKey: ['following', userId],
    queryFn: async () => {
      if (!userId) return new Set<string>();
      const { data, error } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', userId);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.following_id as string));
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/** Everyone who follows the given user. */
export function useFollowers(userId: string | undefined) {
  return useQuery({
    queryKey: ['followers', userId],
    queryFn: async () => {
      if (!userId) return new Set<string>();
      const { data, error } = await supabase
        .from('user_follows')
        .select('follower_id')
        .eq('following_id', userId);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.follower_id as string));
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/**
 * Friends = mutual follow. Derived from the two sets rather than queried, so
 * it is always exactly "people I follow who follow me back".
 */
export function useFriendIds(userId: string | undefined) {
  const { data: following } = useFollowing(userId);
  const { data: followers } = useFollowers(userId);
  const ids = new Set<string>();
  if (following && followers) {
    for (const id of following) if (followers.has(id)) ids.add(id);
  }
  return { data: ids };
}

/** Follower / following counts for a profile. */
export function useFollowCounts(profileId: string | undefined) {
  return useQuery({
    queryKey: ['follow-counts', profileId],
    queryFn: async () => {
      if (!profileId) return { followers: 0, following: 0 };
      const [followers, following] = await Promise.all([
        supabase.from('user_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', profileId),
        supabase.from('user_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', profileId),
      ]);
      return { followers: followers.count ?? 0, following: following.count ?? 0 };
    },
    enabled: !!profileId,
  });
}

export function useFollowMutation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetId, following }: { targetId: string; following: boolean }) => {
      if (!userId) throw new Error('Not signed in');
      if (userId === targetId) throw new Error("You can't follow yourself");
      if (following) {
        const { error } = await supabase.from('user_follows')
          .delete().eq('follower_id', userId).eq('following_id', targetId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_follows')
          .insert({ follower_id: userId, following_id: targetId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['following'] });
      qc.invalidateQueries({ queryKey: ['follow-counts'] });
      qc.invalidateQueries({ queryKey: ['social-feed'] });
    },
    onError: (err: any) => Alert.alert('Could not update follow', err?.message ?? 'Try again.'),
  });
}
