-- ==============================================================================
-- Supabase Migration: Create phase_completions table
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.phase_completions (
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, phase, user_id)
);

-- Index for fast lookup by room and phase
CREATE INDEX IF NOT EXISTS idx_phase_completions_room_phase
  ON public.phase_completions(room_id, phase);

-- Enable RLS and permissive policies
ALTER TABLE public.phase_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can select phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can select phase_completions" ON public.phase_completions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can insert phase_completions" ON public.phase_completions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can update phase_completions" ON public.phase_completions FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Anyone can delete phase_completions" ON public.phase_completions;
CREATE POLICY "Anyone can delete phase_completions" ON public.phase_completions FOR DELETE USING (true);
