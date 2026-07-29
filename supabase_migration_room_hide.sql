-- ==============================================================================
-- Supabase Migration: Add hidden_at column to participants table
-- ==============================================================================

-- Add hidden_at column to public.participants to support room hiding per user
ALTER TABLE public.participants 
ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ NULL;

-- Index for performance when querying non-hidden rooms
CREATE INDEX IF NOT EXISTS idx_participants_user_hidden 
ON public.participants(user_id, hidden_at);
