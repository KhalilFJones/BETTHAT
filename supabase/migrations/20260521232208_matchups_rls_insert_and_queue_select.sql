-- Allow authenticated users to insert matchups (as user1)
CREATE POLICY matchups_insert_own
  ON public.matchups
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user1_id);

-- Allow all authenticated users to read matchmaking queue for opponent discovery
-- (existing queue_select_own is OR-d with this; together they cover all cases)
CREATE POLICY queue_select_all_authenticated
  ON public.matchmaking_queue
  FOR SELECT
  TO authenticated
  USING (true);
