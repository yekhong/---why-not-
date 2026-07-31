-- WhyNot phase 2: persona-first decision fields.
-- REVIEW ONLY. Do not run against a remote project without a backup and approval.

BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS engine_version integer NOT NULL DEFAULT 1;

-- Existing rooms retain their historic calculation. Only rooms created after
-- this migration receive engine v2.
ALTER TABLE public.rooms ALTER COLUMN engine_version SET DEFAULT 2;

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS criteria_evaluations jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS revealed_at timestamptz NULL;

ALTER TABLE public.criterion_proposals
  ADD COLUMN IF NOT EXISTS revealed_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.room_phase_participants (
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  phase text NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, phase, user_id)
);

CREATE TABLE IF NOT EXISTS public.criterion_approvals (
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  criteria_set_version integer NOT NULL DEFAULT 1,
  user_id text NOT NULL,
  vote text NOT NULL CHECK (vote IN ('APPROVE', 'REVISE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, criteria_set_version, user_id)
);

-- BFF-only data access: the browser must not query these tables directly.
ALTER TABLE public.room_phase_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criterion_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.room_phase_participants FROM anon, authenticated;
REVOKE ALL ON TABLE public.criterion_approvals FROM anon, authenticated;

COMMIT;
