-- ==============================================================================
-- Supabase Migration: Create room_invites table
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.room_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    invite_token TEXT UNIQUE NULL,
    invite_token_hash TEXT UNIQUE NULL,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast token lookup
CREATE INDEX IF NOT EXISTS idx_room_invites_token ON public.room_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_room_invites_token_hash ON public.room_invites(invite_token_hash);
CREATE INDEX IF NOT EXISTS idx_room_invites_room_id ON public.room_invites(room_id);

-- Enable RLS and permissive policies
ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can select room_invites" ON public.room_invites;
CREATE POLICY "Anyone can select room_invites" ON public.room_invites FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert room_invites" ON public.room_invites;
CREATE POLICY "Anyone can insert room_invites" ON public.room_invites FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update room_invites" ON public.room_invites;
CREATE POLICY "Anyone can update room_invites" ON public.room_invites FOR UPDATE USING (true);
