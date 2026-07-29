-- ----------------------------------------------------------------
-- Migration: user_accounts Table for Secure Authentication & Recovery
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    login_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    recovery_code_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
    failed_recovery_attempts INT DEFAULT 0
);

-- Index for fast login lookups
CREATE INDEX IF NOT EXISTS idx_user_accounts_login_id ON public.user_accounts(login_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON public.user_accounts(status);

-- Enable RLS for user_accounts (Strict server-side access only)
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- Deny public direct access via Client SDK (only server-side service role or RPC allowed)
DROP POLICY IF EXISTS "No direct public read on user_accounts" ON public.user_accounts;
CREATE POLICY "No direct public read on user_accounts" ON public.user_accounts
    FOR ALL
    USING (false);
