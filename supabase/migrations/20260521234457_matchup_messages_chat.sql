-- matchup_messages: real-time in-game chat between matched opponents
CREATE TABLE IF NOT EXISTS public.matchup_messages (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  matchup_id  uuid REFERENCES public.matchups(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid REFERENCES public.profiles(id) NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT content_not_empty CHECK (char_length(content) >= 1 AND char_length(content) <= 500)
);

ALTER TABLE public.matchup_messages ENABLE ROW LEVEL SECURITY;

-- Only matchup participants can read messages
CREATE POLICY msg_select ON public.matchup_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matchups m
      WHERE m.id = matchup_id
        AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
    )
  );

-- Only participants can send messages as themselves
CREATE POLICY msg_insert ON public.matchup_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.matchups m
      WHERE m.id = matchup_id
        AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
    )
  );
