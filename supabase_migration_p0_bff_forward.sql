-- WhyNot P0 security containment (FOR REVIEW ONLY — do not auto-run)
-- The application uses its own authenticated Express BFF. Browser roles must
-- not read or mutate application tables directly.

BEGIN;

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

CREATE TABLE IF NOT EXISTS public.phase_completions (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, phase, user_id)
);

CREATE INDEX IF NOT EXISTS idx_phase_completions_room_phase
  ON public.phase_completions(room_id, phase);

ALTER TABLE public.criterion_proposals
  ADD COLUMN IF NOT EXISTS is_ai_suggested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.room_invites
  ADD COLUMN IF NOT EXISTS invite_token_hash TEXT;
ALTER TABLE public.room_invites
  ALTER COLUMN invite_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_invites_token_hash
  ON public.room_invites(invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

-- Previously issued plaintext/public invite links are invalidated deliberately.
UPDATE public.room_invites
SET is_active = FALSE
WHERE is_active = TRUE;

UPDATE public.rooms SET is_public = FALSE WHERE is_public IS DISTINCT FROM FALSE;
ALTER TABLE public.rooms ALTER COLUMN is_public SET DEFAULT FALSE;

-- Remove all browser-facing table grants and permissive policies. The Express
-- server uses the service-role credential, which bypasses RLS by design.
DO $$
DECLARE
  table_record RECORD;
  view_record RECORD;
  policy_record RECORD;
BEGIN
  FOR table_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      table_record.schemaname,
      table_record.tablename
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_record.schemaname,
      table_record.tablename
    );
    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      table_record.schemaname,
      table_record.tablename
    );
  END LOOP;

  -- Views can otherwise expose rows even when base-table grants were removed.
  FOR view_record IN
    SELECT schemaname, viewname AS relation_name
    FROM pg_views
    WHERE schemaname = 'public'
    UNION ALL
    SELECT schemaname, matviewname AS relation_name
    FROM pg_matviews
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      view_record.schemaname,
      view_record.relation_name
    );
  END LOOP;

  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;
