-- WhyNot authentication hotfix
-- Apply only after reviewing supabase_auth_hotfix_preflight.sql.
-- This file creates only authentication storage required by the Phase 1 BFF.
-- It does not modify rooms, ideas, evaluations or existing account rows.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.rooms') IS NULL
     OR to_regclass('public.participants') IS NULL THEN
    RAISE EXCEPTION 'WhyNot rooms/participants are missing. Stop: wrong Supabase project.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  failed_recovery_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (failed_recovery_attempts >= 0)
);

DO $$
BEGIN
  IF (
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_accounts'
      AND column_name = 'id'
  ) <> 'uuid' THEN
    RAISE EXCEPTION 'public.user_accounts.id must be UUID. Stop and migrate existing IDs explicitly.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_accounts_login_id
  ON public.user_accounts(login_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status
  ON public.user_accounts(status);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
  ON public.user_sessions(expires_at);

-- The browser must never read password/recovery/session hashes. Only the
-- Express BFF using the server-only service-role key may access these tables.
REVOKE ALL PRIVILEGES ON TABLE public.user_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.user_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_sessions TO service_role;

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions FORCE ROW LEVEL SECURITY;

-- Ensure PostgREST notices newly-created tables immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;

