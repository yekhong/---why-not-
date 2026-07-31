-- WhyNot phase 3 rollback.
-- REVIEW ONLY. This is destructive: round votes and saved reports are removed.
-- Take and verify a backup before running. This does not roll back phase 2.

BEGIN;

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_current_round_room_fk;

ALTER TABLE public.evaluations
  DROP CONSTRAINT IF EXISTS evaluations_round_room_fk,
  DROP COLUMN IF EXISTS round_id;

DROP TABLE IF EXISTS public.ai_reports;
DROP TABLE IF EXISTS public.decision_votes;
DROP TABLE IF EXISTS public.round_candidates;
DROP TABLE IF EXISTS public.evaluation_rounds;

DROP INDEX IF EXISTS public.ideas_id_room_id_unique;

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_engine_version_supported_check,
  DROP CONSTRAINT IF EXISTS rooms_decision_mode_check,
  DROP CONSTRAINT IF EXISTS rooms_final_vote_status_check,
  DROP CONSTRAINT IF EXISTS rooms_tie_slots_nonnegative_check,
  DROP CONSTRAINT IF EXISTS rooms_criteria_set_version_positive_check,
  DROP COLUMN IF EXISTS criteria_set_version,
  DROP COLUMN IF EXISTS current_round_id,
  DROP COLUMN IF EXISTS tie_slots,
  DROP COLUMN IF EXISTS tie_candidate_idea_ids,
  DROP COLUMN IF EXISTS final_vote_status,
  DROP COLUMN IF EXISTS decision_mode;

-- engine_version belongs to phase 2; return only its default.
ALTER TABLE public.rooms ALTER COLUMN engine_version SET DEFAULT 2;

COMMIT;
