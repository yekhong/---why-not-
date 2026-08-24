-- =============================================================================
-- WHYNOT V15 RELEASE STABILITY
-- 1) Reassert BFF-only table access for core application tables.
-- 2) Add voter lookup index used by lobby/access checks.
--
-- Production rule:
-- - Run this forward migration only after code validation.
-- - Do NOT run the full master migration on an existing production database.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Public access on rooms" ON public.rooms;
DROP POLICY IF EXISTS "Public access on participants" ON public.participants;
DROP POLICY IF EXISTS "Public access on ideas" ON public.ideas;
DROP POLICY IF EXISTS "Public access on criteria" ON public.criteria;
DROP POLICY IF EXISTS "Public access on criterion_proposals" ON public.criterion_proposals;
DROP POLICY IF EXISTS "Public access on evaluations" ON public.evaluations;
DROP POLICY IF EXISTS "Public access on room_invites" ON public.room_invites;
DROP POLICY IF EXISTS "Public access on phase_completions" ON public.phase_completions;
DROP POLICY IF EXISTS "Public access on room_phase_participants" ON public.room_phase_participants;

REVOKE ALL ON public.rooms FROM anon, authenticated;
REVOKE ALL ON public.participants FROM anon, authenticated;
REVOKE ALL ON public.ideas FROM anon, authenticated;
REVOKE ALL ON public.criteria FROM anon, authenticated;
REVOKE ALL ON public.criterion_proposals FROM anon, authenticated;
REVOKE ALL ON public.evaluations FROM anon, authenticated;
REVOKE ALL ON public.room_invites FROM anon, authenticated;
REVOKE ALL ON public.phase_completions FROM anon, authenticated;
REVOKE ALL ON public.room_phase_participants FROM anon, authenticated;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criterion_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_phase_participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE public.participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ideas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.criteria FORCE ROW LEVEL SECURITY;
ALTER TABLE public.criterion_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.room_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.phase_completions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.room_phase_participants FORCE ROW LEVEL SECURITY;

GRANT ALL ON public.rooms TO service_role;
GRANT ALL ON public.participants TO service_role;
GRANT ALL ON public.ideas TO service_role;
GRANT ALL ON public.criteria TO service_role;
GRANT ALL ON public.criterion_proposals TO service_role;
GRANT ALL ON public.evaluations TO service_role;
GRANT ALL ON public.room_invites TO service_role;
GRANT ALL ON public.phase_completions TO service_role;
GRANT ALL ON public.room_phase_participants TO service_role;

CREATE INDEX IF NOT EXISTS room_voter_registrations_user_status_idx
  ON public.room_voter_registrations(user_id, status, room_id);

COMMIT;
