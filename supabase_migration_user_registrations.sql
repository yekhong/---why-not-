-- ----------------------------------------------------------------
-- Migration: user_registrations Table for Audit Record of Signups
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_registrations (
    user_id UUID PRIMARY KEY REFERENCES public.user_accounts(id) ON DELETE CASCADE,
    login_id TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    registration_status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (registration_status IN ('COMPLETED', 'CANCELLED')),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by date
CREATE INDEX IF NOT EXISTS idx_user_registrations_registered_at ON public.user_registrations(registered_at DESC);

-- Enable RLS for user_registrations (Server-side service-role access only)
ALTER TABLE public.user_registrations ENABLE ROW LEVEL SECURITY;

-- Deny public direct access via Client SDK
DROP POLICY IF EXISTS "No direct public access on user_registrations" ON public.user_registrations;
CREATE POLICY "No direct public access on user_registrations" ON public.user_registrations
    FOR ALL
    USING (false);
