-- =============================================================================
-- AUDIT FIX: LINEUP-BUILDING RLS (users couldn't build a lineup at all)
-- =============================================================================
-- lineups had no INSERT policy and lineup_players had no INSERT/DELETE policy,
-- yet the client creates a 'building' lineup and adds/removes players directly
-- (lineup.tsx, player/[id].tsx). Every such write was silently denied by RLS —
-- so no one could assemble a lineup, which blocks the entire play flow.
--
-- Also fixes a self-referential typo in lineups_select_matched (m.lineup1_id =
-- m.id instead of lineups.id) that prevented matchup participants from seeing
-- the opponent's lineup.
-- =============================================================================

-- Create a building lineup (own only).
DROP POLICY IF EXISTS lineups_insert_own ON public.lineups;
CREATE POLICY lineups_insert_own ON public.lineups
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Add/remove players while the lineup is still building and owned by the user.
DROP POLICY IF EXISTS lineup_players_insert_own ON public.lineup_players;
CREATE POLICY lineup_players_insert_own ON public.lineup_players
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.lineups l
             WHERE l.id = lineup_players.lineup_id
               AND l.user_id = auth.uid()
               AND l.status = 'building')
  );

DROP POLICY IF EXISTS lineup_players_delete_own ON public.lineup_players;
CREATE POLICY lineup_players_delete_own ON public.lineup_players
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.lineups l
             WHERE l.id = lineup_players.lineup_id
               AND l.user_id = auth.uid()
               AND l.status = 'building')
  );

-- Let matchup participants see BOTH lineups (fix the lineup1_id = m.id typo).
DROP POLICY IF EXISTS lineups_select_matched ON public.lineups;
CREATE POLICY lineups_select_matched ON public.lineups
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.matchups m
             WHERE (m.lineup1_id = lineups.id OR m.lineup2_id = lineups.id)
               AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
               AND m.status IN ('matched','live','completed'))
  );
