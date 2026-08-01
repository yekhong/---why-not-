-- ==============================================================================
-- Supabase Combined Migration: All Required Tables & Columns for Decision Engine
-- (Execute this script in Supabase Dashboard -> SQL Editor)
-- ==============================================================================

-- 1. Add decision_mode column to rooms table
ALTER TABLE public.rooms 
  ADD COLUMN IF NOT EXISTS decision_mode TEXT DEFAULT 'STRUCTURED';

-- 2. Create room_phase_participants table
CREATE TABLE IF NOT EXISTS public.room_phase_participants (
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, phase, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_phase_participants_room_phase
  ON public.room_phase_participants(room_id, phase);

ALTER TABLE public.room_phase_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can select room_phase_participants" ON public.room_phase_participants;
CREATE POLICY "Anyone can select room_phase_participants" ON public.room_phase_participants FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert room_phase_participants" ON public.room_phase_participants;
CREATE POLICY "Anyone can insert room_phase_participants" ON public.room_phase_participants FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update room_phase_participants" ON public.room_phase_participants;
CREATE POLICY "Anyone can update room_phase_participants" ON public.room_phase_participants FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Anyone can delete room_phase_participants" ON public.room_phase_participants;
CREATE POLICY "Anyone can delete room_phase_participants" ON public.room_phase_participants FOR DELETE USING (true);

-- 3. Create phase_completions table
CREATE TABLE IF NOT EXISTS public.phase_completions (
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, phase, user_id)
);

CREATE INDEX IF NOT EXISTS idx_phase_completions_room_phase
  ON public.phase_completions(room_id, phase);

ALTER TABLE public.phase_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can select phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can select phase_completions" ON public.phase_completions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can insert phase_completions" ON public.phase_completions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can update phase_completions" ON public.phase_completions FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Anyone can delete phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can delete phase_completions" ON public.phase_completions FOR DELETE USING (true);
