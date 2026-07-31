-- WhyNot phase 2 rollback.
-- REVIEW ONLY. This removes phase-2 data, so approve explicitly before use.

BEGIN;

DROP TABLE IF EXISTS public.criterion_approvals;
DROP TABLE IF EXISTS public.room_phase_participants;

ALTER TABLE public.criterion_proposals DROP COLUMN IF EXISTS revealed_at;
ALTER TABLE public.ideas DROP COLUMN IF EXISTS revealed_at;
ALTER TABLE public.evaluations DROP COLUMN IF EXISTS criteria_evaluations;
ALTER TABLE public.rooms DROP COLUMN IF EXISTS engine_version;

COMMIT;
