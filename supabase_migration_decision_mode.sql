-- ==============================================================================
-- Supabase Migration: Add decision_mode column to rooms table
-- ==============================================================================

ALTER TABLE public.rooms 
  ADD COLUMN IF NOT EXISTS decision_mode TEXT DEFAULT 'STRUCTURED';

COMMENT ON COLUMN public.rooms.decision_mode IS 'Decision mode: STRUCTURED (default 4-step) or QUICK (fast-track anonymous vote)';
