-- WhyNot phase 3: immutable decision rounds, quick decisions and final reports.
-- REVIEW ONLY. Run phase 2 first. Do not run against a remote project without
-- a verified backup, explicit approval, preflight review and a maintenance plan.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preserve old rooms while selecting the new engine only for future rooms.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS engine_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS decision_mode text NOT NULL DEFAULT 'STRUCTURED',
  ADD COLUMN IF NOT EXISTS final_vote_status text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS tie_candidate_idea_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS tie_slots integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_round_id text NULL,
  ADD COLUMN IF NOT EXISTS criteria_set_version integer NOT NULL DEFAULT 1;

-- A room that was already completed before phase 3 must continue to use its
-- historic result. Do not recalculate or overwrite it.
UPDATE public.rooms
SET final_vote_status = 'FINALIZED'
WHERE status = 'CLOSED'
  AND final_vote_status = 'NOT_STARTED';

ALTER TABLE public.rooms ALTER COLUMN engine_version SET DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_engine_version_supported_check'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_engine_version_supported_check
      CHECK (engine_version IN (1, 2, 3)) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_decision_mode_check'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_decision_mode_check
      CHECK (decision_mode IN ('STRUCTURED', 'QUICK')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_final_vote_status_check'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_final_vote_status_check
      CHECK (final_vote_status IN ('NOT_STARTED', 'VOTING', 'TIE_PENDING', 'FINALIZED')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_tie_slots_nonnegative_check'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_tie_slots_nonnegative_check
      CHECK (tie_slots >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_criteria_set_version_positive_check'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_criteria_set_version_positive_check
      CHECK (criteria_set_version >= 1) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.rooms VALIDATE CONSTRAINT rooms_engine_version_supported_check;
ALTER TABLE public.rooms VALIDATE CONSTRAINT rooms_decision_mode_check;
ALTER TABLE public.rooms VALIDATE CONSTRAINT rooms_final_vote_status_check;
ALTER TABLE public.rooms VALIDATE CONSTRAINT rooms_tie_slots_nonnegative_check;
ALTER TABLE public.rooms VALIDATE CONSTRAINT rooms_criteria_set_version_positive_check;

-- ---------------------------------------------------------------------------
-- 2. A result/review is a round. Ideas remain the original records.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_rounds (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number >= 1),
  decision_mode text NOT NULL CHECK (decision_mode IN ('STRUCTURED', 'QUICK')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (room_id, round_number),
  UNIQUE (id, room_id)
);

CREATE TABLE IF NOT EXISTS public.round_candidates (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id text NOT NULL,
  idea_id text NOT NULL,
  outcome text NOT NULL DEFAULT 'ACTIVE'
    CHECK (outcome IN ('ACTIVE', 'ELIMINATED', 'WINNER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, idea_id),
  CONSTRAINT round_candidates_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE
);

-- A composite identity prevents an idea from another room being inserted into
-- this room's round, even if a caller guesses a valid idea id.
CREATE UNIQUE INDEX IF NOT EXISTS ideas_id_room_id_unique
  ON public.ideas(id, room_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'round_candidates_idea_room_fk'
      AND conrelid = 'public.round_candidates'::regclass
  ) THEN
    ALTER TABLE public.round_candidates
      ADD CONSTRAINT round_candidates_idea_room_fk
      FOREIGN KEY (idea_id, room_id)
      REFERENCES public.ideas(id, room_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_current_round_room_fk'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_current_round_room_fk
      FOREIGN KEY (current_round_id, id)
      REFERENCES public.evaluation_rounds(id, room_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Immutable anonymous final ballots. Aggregates are calculated only after
-- every participant in the frozen FINAL_VOTE:<round_id> snapshot has submitted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.decision_votes (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id text NOT NULL,
  user_id text NOT NULL,
  selected_idea_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id),
  CONSTRAINT decision_votes_nonempty_selection_check
    CHECK (cardinality(selected_idea_ids) >= 1),
  CONSTRAINT decision_votes_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE
);

-- Existing evaluations remain readable as legacy records. New engine-v3
-- evaluations always include round_id and are validated by the BFF.
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS round_id text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluations_round_room_fk'
      AND conrelid = 'public.evaluations'::regclass
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT evaluations_round_room_fk
      FOREIGN KEY (round_id, room_id)
      REFERENCES public.evaluation_rounds(id, room_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Persist the exact AI report and the evidence snapshot used to create it.
-- AI is an organizer, not the authority that chooses the winner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_reports (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id text NULL,
  report_text text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_reports_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_one_per_round_unique
  ON public.ai_reports(room_id, round_id)
  WHERE round_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evaluation_rounds_room_order_idx
  ON public.evaluation_rounds(room_id, round_number DESC);
CREATE INDEX IF NOT EXISTS round_candidates_round_idx
  ON public.round_candidates(round_id);
CREATE INDEX IF NOT EXISTS decision_votes_round_idx
  ON public.decision_votes(round_id);
CREATE INDEX IF NOT EXISTS evaluations_round_idx
  ON public.evaluations(round_id);
CREATE INDEX IF NOT EXISTS ai_reports_room_created_idx
  ON public.ai_reports(room_id, created_at DESC);

-- Browser clients do not access phase-3 decision data directly. Only the
-- authenticated BFF service role performs reads/writes and filters responses.
ALTER TABLE public.evaluation_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.evaluation_rounds FROM anon, authenticated;
REVOKE ALL ON TABLE public.round_candidates FROM anon, authenticated;
REVOKE ALL ON TABLE public.decision_votes FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_reports FROM anon, authenticated;

COMMIT;
