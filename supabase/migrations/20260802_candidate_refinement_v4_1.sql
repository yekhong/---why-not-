-- =============================================================================
-- WhyNot 후보 보완 라운드 + AI 표현 표준화 V4.1 (ERD 호환 추가형 마이그레이션)
--
-- 목적
--   1) 기존 UI/색상/레이아웃을 바꾸지 않고 기능에 필요한 DB 구조만 추가한다.
--   2) 기존 아이디어, 기존 평가, 완료된 방의 결과를 덮어쓰거나 재계산하지 않는다.
--   3) AI 표현 표준화안과 논리 보완안은 반드시 작성자 승인 후에만 공개본이 된다.
--   4) 후보가 많이 남은 경우 팀이 선택적으로 1회만 보완·재평가할 수 있게 한다.
--   5) 재평가 기준은 최초 평가와 동일한 criteria_set_version을 사용한다.
--   6) 필요한 핵심 테이블이 없으면 현재 마스터 ERD 호환 구조로 생성한다.
--   7) 기존 구조가 호환되지 않으면 추측 보정하지 않고 전체 실행을 롤백한다.
--
-- 실행 전 주의
--   - Supabase SQL Editor에서 먼저 백업 후 실행한다.
--   - 이 파일은 ADDITIVE migration이다. DROP TABLE, 기존 결과 UPDATE는 하지 않는다.
--   - 신규 테이블은 BFF/백엔드(service_role) 전용이다.
--   - 현재 마스터 SQL의 기존 "Public access on ..." 정책은 별도 P0 보안 문제다.
--     이 파일은 기존 정책을 강제로 제거하지 않는다. BFF 전환 검증 없이 제거하면
--     현재 앱이 중단될 수 있기 때문이다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- -1. 선행 스키마 부트스트랩 및 호환성 검사
--
-- 원칙
--   - 테이블 자체가 없으면 현재 마스터 ERD와 같은 핵심 구조로 생성한다.
--   - 기존 테이블에 안전하게 추가할 수 있는 선택/상태 컬럼은 자동 추가한다.
--   - ID/FK 컬럼의 타입이 다르거나 작성자 식별 컬럼이 빠진 기존 데이터는
--     임의 값으로 보정하지 않고 예외를 발생시켜 전체 트랜잭션을 롤백한다.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '기획',
  is_public BOOLEAN DEFAULT FALSE,
  max_participants INT DEFAULT 6,
  target_winner_count INT DEFAULT 1,
  is_pinned BOOLEAN DEFAULT FALSE,
  host_id TEXT NOT NULL,
  status TEXT DEFAULT 'IDEA_SUBMISSION',
  min_response_threshold INT DEFAULT 1,
  elimination_config JSONB DEFAULT '{"countPerRound": 1, "tieBreak": "random"}'::jsonb,
  deadlines JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  engine_version INT NOT NULL DEFAULT 3,
  decision_mode TEXT NOT NULL DEFAULT 'STRUCTURED',
  final_vote_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  tie_candidate_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tie_slots INT NOT NULL DEFAULT 0,
  current_round_id TEXT NULL,
  criteria_set_version INT NOT NULL DEFAULT 1
);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS engine_version INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS decision_mode TEXT NOT NULL DEFAULT 'STRUCTURED',
  ADD COLUMN IF NOT EXISTS current_round_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS criteria_set_version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.participants (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  hidden_at TIMESTAMPTZ NULL,
  PRIMARY KEY (room_id, user_id)
);

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS public.ideas (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  submitter_id TEXT NOT NULL,
  submitter_name TEXT DEFAULT '익명 아이디어',
  attachment_url TEXT NULL,
  pdf_attachment_url TEXT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT DEFAULT 'ACTIVE',
  eliminated_round INT NULL,
  revealed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.criteria (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  weight NUMERIC DEFAULT 1.0,
  confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.criteria
  ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.evaluation_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number >= 1),
  decision_mode TEXT NOT NULL CHECK (decision_mode IN ('STRUCTURED', 'QUICK')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  result_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (room_id, round_number),
  UNIQUE (id, room_id)
);

ALTER TABLE public.evaluation_rounds
  ADD COLUMN IF NOT EXISTS decision_mode TEXT NOT NULL DEFAULT 'STRUCTURED',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS result_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.evaluations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL,
  idea_id TEXT NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  excluded_criterion_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  criteria_evaluations JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_text TEXT DEFAULT '',
  reason_type TEXT DEFAULT 'PREFERENCE',
  round INT DEFAULT 1,
  round_id TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS criteria_evaluations JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS round INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS round_id TEXT NULL;

CREATE TABLE IF NOT EXISTS public.round_candidates (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
    outcome IN ('ACTIVE', 'ELIMINATED', 'WINNER')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, idea_id),
  CONSTRAINT round_candidates_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.decision_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  selected_idea_ids TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, user_id),
  CONSTRAINT decision_votes_nonempty_selection_check
    CHECK (cardinality(selected_idea_ids) >= 1),
  CONSTRAINT decision_votes_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.ai_reports (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id TEXT NULL,
  report_text TEXT NOT NULL,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_reports_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE
);

-- 식별/관계 컬럼 누락이나 타입 불일치는 데이터 의미를 추측하지 않고 중단한다.
DO $$
DECLARE
  mismatch TEXT;
BEGIN
  SELECT string_agg(format('%s.%s expected %s but found %s', t.table_name, t.column_name, t.expected_type, COALESCE(c.data_type, 'MISSING')), '; ')
    INTO mismatch
  FROM (
    VALUES
      ('rooms', 'id', 'text'),
      ('rooms', 'host_id', 'text'),
      ('participants', 'room_id', 'text'),
      ('participants', 'user_id', 'text'),
      ('participants', 'nickname', 'text'),
      ('ideas', 'id', 'text'),
      ('ideas', 'room_id', 'text'),
      ('ideas', 'title', 'text'),
      ('ideas', 'submitter_id', 'text'),
      ('criteria', 'id', 'text'),
      ('criteria', 'room_id', 'text'),
      ('criteria', 'name', 'text'),
      ('evaluation_rounds', 'id', 'text'),
      ('evaluation_rounds', 'room_id', 'text'),
      ('evaluation_rounds', 'round_number', 'integer'),
      ('evaluations', 'id', 'text'),
      ('evaluations', 'room_id', 'text'),
      ('evaluations', 'evaluator_id', 'text'),
      ('evaluations', 'idea_id', 'text'),
      ('evaluations', 'decision', 'text'),
      ('round_candidates', 'id', 'text'),
      ('round_candidates', 'room_id', 'text'),
      ('round_candidates', 'round_id', 'text'),
      ('round_candidates', 'idea_id', 'text'),
      ('decision_votes', 'id', 'text'),
      ('decision_votes', 'room_id', 'text'),
      ('decision_votes', 'round_id', 'text'),
      ('decision_votes', 'user_id', 'text'),
      ('ai_reports', 'id', 'text'),
      ('ai_reports', 'room_id', 'text'),
      ('ai_reports', 'round_id', 'text'),
      ('ai_reports', 'report_text', 'text'),
      ('ai_reports', 'model_name', 'text'),
      ('ai_reports', 'prompt_version', 'text')
  ) AS t(table_name, column_name, expected_type)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = t.table_name
   AND c.column_name = t.column_name
  WHERE c.column_name IS NULL OR c.data_type <> t.expected_type;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'WhyNot V4.1 prerequisite mismatch: %', mismatch;
  END IF;
END $$;

-- 복합 FK가 참조할 수 있도록 기존 PK를 훼손하지 않는 유니크 인덱스를 보장한다.
-- 중복 데이터가 있다면 인덱스 생성이 실패하고 트랜잭션 전체가 롤백된다.
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_user_compat_unique
  ON public.participants(room_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ideas_id_room_compat_unique
  ON public.ideas(id, room_id);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_rounds_id_room_compat_unique
  ON public.evaluation_rounds(id, room_id);

-- 새 round_candidates는 같은 방의 실제 아이디어만 참조하도록 강제한다.
-- NOT VALID이므로 기존 고아 데이터 때문에 배포가 막히지는 않지만 신규 행에는 적용된다.
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
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 0. 신규 방만 V4 엔진 사용. 기존 방의 engine_version 값은 변경하지 않는다.
-- -----------------------------------------------------------------------------

ALTER TABLE public.rooms
  ALTER COLUMN engine_version SET DEFAULT 4;

-- 기존 방은 비활성/0회로 보존하고, 이후 생성되는 방만 기본 1회 허용한다.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS refinement_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS max_refinement_rounds SMALLINT;

UPDATE public.rooms
SET refinement_enabled = FALSE
WHERE refinement_enabled IS NULL;

UPDATE public.rooms
SET max_refinement_rounds = 0
WHERE max_refinement_rounds IS NULL;

ALTER TABLE public.rooms
  ALTER COLUMN refinement_enabled SET NOT NULL,
  ALTER COLUMN refinement_enabled SET DEFAULT TRUE,
  ALTER COLUMN max_refinement_rounds SET NOT NULL,
  ALTER COLUMN max_refinement_rounds SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_max_refinement_rounds_check'
      AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_max_refinement_rounds_check
      CHECK (max_refinement_rounds BETWEEN 0 AND 1);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 평가 라운드 확장
-- -----------------------------------------------------------------------------

ALTER TABLE public.evaluation_rounds
  ADD COLUMN IF NOT EXISTS round_kind TEXT NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN IF NOT EXISTS parent_round_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS criteria_set_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'EVALUATION',
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS minimum_response_ratio NUMERIC(5,4) NULL,
  ADD COLUMN IF NOT EXISTS minimum_response_count INT NULL,
  ADD COLUMN IF NOT EXISTS allow_early_completion BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS results_revealed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS closure_reason TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_rounds_round_kind_check'
      AND conrelid = 'public.evaluation_rounds'::regclass
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_round_kind_check
      CHECK (round_kind IN ('INITIAL', 'REFINEMENT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_rounds_stage_check'
      AND conrelid = 'public.evaluation_rounds'::regclass
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_stage_check
      CHECK (stage IN ('FEEDBACK', 'REVISION', 'EVALUATION', 'FINAL_VOTE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_rounds_response_ratio_check'
      AND conrelid = 'public.evaluation_rounds'::regclass
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_response_ratio_check
      CHECK (
        minimum_response_ratio IS NULL
        OR (minimum_response_ratio > 0 AND minimum_response_ratio <= 1)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_rounds_response_count_check'
      AND conrelid = 'public.evaluation_rounds'::regclass
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_response_count_check
      CHECK (minimum_response_count IS NULL OR minimum_response_count > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_rounds_closure_reason_check'
      AND conrelid = 'public.evaluation_rounds'::regclass
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_closure_reason_check
      CHECK (
        closure_reason IS NULL
        OR closure_reason IN (
          'ALL_SUBMITTED',
          'DEADLINE_REACHED',
          'INSUFFICIENT_RESPONSES',
          'CANCELLED'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_rounds_parent_room_fk'
      AND conrelid = 'public.evaluation_rounds'::regclass
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_parent_room_fk
      FOREIGN KEY (parent_round_id, room_id)
      REFERENCES public.evaluation_rounds (id, room_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- MVP에서는 방마다 보완 라운드를 최대 1개만 허용한다.
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_rounds_one_refinement_per_room_idx
  ON public.evaluation_rounds (room_id)
  WHERE round_kind = 'REFINEMENT';

CREATE INDEX IF NOT EXISTS evaluation_rounds_parent_idx
  ON public.evaluation_rounds (parent_round_id);

-- 보완 라운드는 원본 라운드와 같은 기준 세트만 사용할 수 있다.
CREATE OR REPLACE FUNCTION public.guard_refinement_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_version INT;
  parent_kind TEXT;
BEGIN
  IF NEW.round_kind = 'REFINEMENT' THEN
    IF NEW.parent_round_id IS NULL THEN
      RAISE EXCEPTION 'REFINEMENT round requires parent_round_id';
    END IF;

    SELECT criteria_set_version, round_kind
      INTO parent_version, parent_kind
    FROM public.evaluation_rounds
    WHERE id = NEW.parent_round_id
      AND room_id = NEW.room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent round does not exist in the same room';
    END IF;

    IF parent_kind <> 'INITIAL' THEN
      RAISE EXCEPTION 'A refinement round can only follow an initial round';
    END IF;

    IF NEW.criteria_set_version <> parent_version THEN
      RAISE EXCEPTION 'Refinement must reuse the parent criteria set version';
    END IF;
  ELSIF NEW.parent_round_id IS NOT NULL THEN
    RAISE EXCEPTION 'INITIAL round cannot have parent_round_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evaluation_rounds_refinement_guard_trg
  ON public.evaluation_rounds;

CREATE TRIGGER evaluation_rounds_refinement_guard_trg
BEFORE INSERT OR UPDATE OF round_kind, parent_round_id, criteria_set_version, room_id
ON public.evaluation_rounds
FOR EACH ROW
EXECUTE FUNCTION public.guard_refinement_round();

-- 마감은 최초 설정 또는 연장만 가능하고 단축/삭제는 금지한다.
CREATE OR REPLACE FUNCTION public.guard_round_deadline_extension()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.deadline_at IS NOT NULL
     AND NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     AND (NEW.deadline_at IS NULL OR NEW.deadline_at < OLD.deadline_at) THEN
    RAISE EXCEPTION 'Round deadline can only be extended, not shortened or removed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evaluation_rounds_deadline_guard_trg
  ON public.evaluation_rounds;

CREATE TRIGGER evaluation_rounds_deadline_guard_trg
BEFORE UPDATE OF deadline_at
ON public.evaluation_rounds
FOR EACH ROW
EXECUTE FUNCTION public.guard_round_deadline_extension();

-- -----------------------------------------------------------------------------
-- 2. 아이디어 원문/AI 표현 표준화/논리 보완/보완안 버전 관리
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.idea_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  idea_id TEXT NOT NULL,
  round_id TEXT NULL,
  version_number INT NOT NULL CHECK (version_number >= 1),
  version_type TEXT NOT NULL CHECK (
    version_type IN ('ORIGINAL', 'ANONYMIZED', 'LOGIC_ENHANCED', 'REFINED')
  ),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_model TEXT NULL,
  prompt_version TEXT NULL,
  approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    approval_status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')
  ),
  anonymity_risk_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_by TEXT NOT NULL,
  approved_by TEXT NULL,
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idea_id, version_number),
  UNIQUE (id, room_id),
  CONSTRAINT idea_versions_idea_room_fk
    FOREIGN KEY (idea_id, room_id)
    REFERENCES public.ideas(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT idea_versions_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE RESTRICT,
  CONSTRAINT idea_versions_approval_actor_check
    CHECK (
      (approval_status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR approval_status <> 'APPROVED'
    )
);

CREATE INDEX IF NOT EXISTS idea_versions_idea_order_idx
  ON public.idea_versions (idea_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idea_versions_round_idx
  ON public.idea_versions (round_id);

-- 승인된 공개본은 이력 보존을 위해 수정/삭제하지 않는다.
CREATE OR REPLACE FUNCTION public.guard_approved_idea_version_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.approval_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved idea version is immutable; create a new version instead';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       NEW.id <> OLD.id
       OR NEW.room_id <> OLD.room_id
       OR NEW.idea_id <> OLD.idea_id
       OR NEW.version_number <> OLD.version_number
       OR NEW.version_type <> OLD.version_type
       OR NEW.created_by <> OLD.created_by
     ) THEN
    RAISE EXCEPTION 'Idea version identity fields are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS idea_versions_history_guard_trg
  ON public.idea_versions;

CREATE TRIGGER idea_versions_history_guard_trg
BEFORE UPDATE OR DELETE
ON public.idea_versions
FOR EACH ROW
EXECUTE FUNCTION public.guard_approved_idea_version_history();

-- 기존 아이디어는 현재 문장을 ORIGINAL/APPROVED 버전 1로만 복사한다.
-- 기존 ideas.title/description은 수정하지 않는다.
INSERT INTO public.idea_versions (
  room_id,
  idea_id,
  round_id,
  version_number,
  version_type,
  title,
  description,
  source_snapshot,
  approval_status,
  created_by,
  approved_by,
  approved_at
)
SELECT
  i.room_id,
  i.id,
  NULL,
  1,
  'ORIGINAL',
  i.title,
  COALESCE(i.description, ''),
  jsonb_build_object('migrated_from_ideas', TRUE, 'migrated_at', NOW()),
  'APPROVED',
  i.submitter_id,
  i.submitter_id,
  COALESCE(i.created_at, NOW())
FROM public.ideas i
WHERE NOT EXISTS (
  SELECT 1
  FROM public.idea_versions iv
  WHERE iv.idea_id = i.id
    AND iv.version_number = 1
);

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS current_version_id UUID NULL;

UPDATE public.ideas i
SET current_version_id = iv.id
FROM public.idea_versions iv
WHERE i.current_version_id IS NULL
  AND iv.idea_id = i.id
  AND iv.room_id = i.room_id
  AND iv.version_number = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ideas_current_version_room_fk'
      AND conrelid = 'public.ideas'::regclass
  ) THEN
    ALTER TABLE public.ideas
      ADD CONSTRAINT ideas_current_version_room_fk
      FOREIGN KEY (current_version_id)
      REFERENCES public.idea_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 승인되지 않은 AI 문안을 공개본(current_version_id)으로 지정하지 못하게 한다.
CREATE OR REPLACE FUNCTION public.guard_approved_idea_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_status TEXT;
  selected_idea_id TEXT;
BEGIN
  IF NEW.current_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT approval_status, idea_id
    INTO selected_status, selected_idea_id
  FROM public.idea_versions
  WHERE id = NEW.current_version_id
    AND room_id = NEW.room_id;

  IF NOT FOUND OR selected_idea_id <> NEW.id THEN
    RAISE EXCEPTION 'Selected version does not belong to this idea';
  END IF;

  IF selected_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only an author-approved idea version can be published';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ideas_approved_version_guard_trg ON public.ideas;

CREATE TRIGGER ideas_approved_version_guard_trg
BEFORE INSERT OR UPDATE OF current_version_id
ON public.ideas
FOR EACH ROW
EXECUTE FUNCTION public.guard_approved_idea_version();

-- -----------------------------------------------------------------------------
-- 3. 라운드 시작 시 활성 참여자 스냅샷 및 제출 상태
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.evaluation_round_participants (
  round_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  submission_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (
    submission_status IN ('NOT_STARTED', 'DRAFT', 'FINAL')
  ),
  finalized_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (round_id, user_id),
  CONSTRAINT evaluation_round_participants_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT evaluation_round_participants_member_fk
    FOREIGN KEY (room_id, user_id)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT evaluation_round_participants_finalized_check
    CHECK (
      (submission_status = 'FINAL' AND finalized_at IS NOT NULL)
      OR submission_status <> 'FINAL'
    )
);

CREATE INDEX IF NOT EXISTS evaluation_round_participants_room_idx
  ON public.evaluation_round_participants (room_id, round_id);

-- 스냅샷의 구성원/필수 여부는 라운드 시작 후 바꿀 수 없다.
-- 제출 상태만 NOT_STARTED -> DRAFT -> FINAL 방향으로 갱신한다.
CREATE OR REPLACE FUNCTION public.guard_round_participant_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  round_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO round_status
    FROM public.evaluation_rounds
    WHERE id = OLD.round_id AND room_id = OLD.room_id;

    IF round_status = 'ACTIVE' THEN
      RAISE EXCEPTION 'Active round participant snapshot cannot be deleted';
    END IF;

    RETURN OLD;
  END IF;

  IF NEW.round_id <> OLD.round_id
     OR NEW.room_id <> OLD.room_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.is_required <> OLD.is_required THEN
    RAISE EXCEPTION 'Round participant snapshot identity is immutable';
  END IF;

  IF OLD.submission_status = 'FINAL'
     AND NEW.submission_status <> 'FINAL' THEN
    RAISE EXCEPTION 'Final submission cannot return to draft';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evaluation_round_participants_snapshot_guard_trg
  ON public.evaluation_round_participants;

CREATE TRIGGER evaluation_round_participants_snapshot_guard_trg
BEFORE UPDATE OR DELETE
ON public.evaluation_round_participants
FOR EACH ROW
EXECUTE FUNCTION public.guard_round_participant_snapshot();

-- -----------------------------------------------------------------------------
-- 4. 구조화된 익명 피드백
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.candidate_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  evaluator_id TEXT NOT NULL,
  response_type TEXT NOT NULL CHECK (
    response_type IN ('FEEDBACK', 'NO_COMMENT', 'UNSURE')
  ),
  question_text TEXT NULL,
  concern_text TEXT NULL,
  suggestion_text TEXT NULL,
  published_summary TEXT NULL,
  summary_approval_status TEXT NOT NULL DEFAULT 'NOT_GENERATED' CHECK (
    summary_approval_status IN (
      'NOT_GENERATED',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED'
    )
  ),
  summary_approved_at TIMESTAMPTZ NULL,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, idea_id, evaluator_id),
  CONSTRAINT candidate_feedback_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT candidate_feedback_idea_room_fk
    FOREIGN KEY (idea_id, room_id)
    REFERENCES public.ideas(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT candidate_feedback_evaluator_snapshot_fk
    FOREIGN KEY (round_id, evaluator_id)
    REFERENCES public.evaluation_round_participants(round_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT candidate_feedback_content_check
    CHECK (
      response_type <> 'FEEDBACK'
      OR NULLIF(BTRIM(COALESCE(question_text, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(concern_text, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(suggestion_text, '')), '') IS NOT NULL
    ),
  CONSTRAINT candidate_feedback_finalized_check
    CHECK (
      (is_final = TRUE AND finalized_at IS NOT NULL)
      OR is_final = FALSE
    ),
  CONSTRAINT candidate_feedback_summary_approval_check
    CHECK (
      summary_approval_status <> 'APPROVED'
      OR (
        NULLIF(BTRIM(COALESCE(published_summary, '')), '') IS NOT NULL
        AND summary_approved_at IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS candidate_feedback_round_idea_idx
  ON public.candidate_feedback (round_id, idea_id);

-- 최종 제출한 피드백은 다시 수정/삭제하지 않고 새 라운드에서 새로 작성한다.
CREATE OR REPLACE FUNCTION public.guard_final_candidate_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_final = TRUE THEN
    RAISE EXCEPTION 'Final candidate feedback is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidate_feedback_final_guard_trg
  ON public.candidate_feedback;

CREATE TRIGGER candidate_feedback_final_guard_trg
BEFORE UPDATE OR DELETE
ON public.candidate_feedback
FOR EACH ROW
EXECUTE FUNCTION public.guard_final_candidate_feedback();

-- -----------------------------------------------------------------------------
-- 5. 보완 라운드 제안/동의
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.refinement_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  source_round_id TEXT NOT NULL,
  refinement_round_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (
    status IN ('PROPOSED', 'APPROVED', 'DECLINED', 'ACTIVE', 'COMPLETED', 'CANCELLED')
  ),
  vote_deadline_at TIMESTAMPTZ NULL,
  eligible_voter_count INT NOT NULL CHECK (eligible_voter_count > 0),
  required_yes_count INT NOT NULL CHECK (
    required_yes_count > 0 AND required_yes_count <= eligible_voter_count
  ),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id),
  UNIQUE (id, room_id),
  UNIQUE (id, room_id, source_round_id),
  CONSTRAINT refinement_cycles_source_round_fk
    FOREIGN KEY (source_round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE RESTRICT,
  CONSTRAINT refinement_cycles_refinement_round_fk
    FOREIGN KEY (refinement_round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE RESTRICT,
  CONSTRAINT refinement_cycles_creator_fk
    FOREIGN KEY (room_id, created_by)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.refinement_cycle_votes (
  cycle_id UUID NOT NULL,
  room_id TEXT NOT NULL,
  source_round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('YES', 'NO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, user_id),
  CONSTRAINT refinement_cycle_votes_cycle_round_fk
    FOREIGN KEY (cycle_id, room_id, source_round_id)
    REFERENCES public.refinement_cycles(id, room_id, source_round_id)
    ON DELETE CASCADE,
  CONSTRAINT refinement_cycle_votes_snapshot_member_fk
    FOREIGN KEY (source_round_id, user_id)
    REFERENCES public.evaluation_round_participants(round_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS refinement_cycle_votes_room_idx
  ON public.refinement_cycle_votes (room_id, cycle_id);

-- -----------------------------------------------------------------------------
-- 6. 마감 변경 이력 (마감 단축은 위 trigger에서 이미 차단)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.round_deadline_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  old_deadline_at TIMESTAMPTZ NULL,
  new_deadline_at TIMESTAMPTZ NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT round_deadline_audit_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT round_deadline_audit_member_fk
    FOREIGN KEY (room_id, changed_by)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT round_deadline_audit_extension_check
    CHECK (old_deadline_at IS NULL OR new_deadline_at > old_deadline_at)
);

CREATE INDEX IF NOT EXISTS round_deadline_audit_round_idx
  ON public.round_deadline_audit (round_id, created_at DESC);

-- 기존 ai_reports 테이블을 그대로 재사용하되 엔진/리포트 종류를 스냅샷으로 남긴다.
-- 기존 리포트의 본문과 결과는 변경하지 않는다.
ALTER TABLE public.ai_reports
  ADD COLUMN IF NOT EXISTS report_type TEXT,
  ADD COLUMN IF NOT EXISTS engine_version INT;

UPDATE public.ai_reports
SET report_type = 'FINAL_DECISION'
WHERE report_type IS NULL;

UPDATE public.ai_reports
SET engine_version = 3
WHERE engine_version IS NULL;

ALTER TABLE public.ai_reports
  ALTER COLUMN report_type SET NOT NULL,
  ALTER COLUMN report_type SET DEFAULT 'FINAL_DECISION',
  ALTER COLUMN engine_version SET NOT NULL,
  ALTER COLUMN engine_version SET DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_reports_report_type_check'
      AND conrelid = 'public.ai_reports'::regclass
  ) THEN
    ALTER TABLE public.ai_reports
      ADD CONSTRAINT ai_reports_report_type_check
      CHECK (report_type IN ('FINAL_DECISION', 'REFINEMENT_SUMMARY'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. 신규 기능 테이블은 BFF/service_role 전용으로 잠근다.
--    custom cookie 인증은 auth.uid()로 표현되지 않으므로 잘못된 RLS를 만들지 않는다.
-- -----------------------------------------------------------------------------

-- 선행 단계에서 핵심 테이블이 새로 생성된 경우에도 RLS가 빠지지 않게 한다.
-- 기존 테이블의 정책은 여기서 삭제하지 않는다. 기존 프론트엔드 직접 접근을
-- BFF로 완전히 전환하기 전에 정책을 제거하면 현재 서비스가 중단될 수 있다.
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.idea_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_round_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refinement_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refinement_cycle_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_deadline_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.idea_versions FROM anon, authenticated;
REVOKE ALL ON TABLE public.evaluation_round_participants FROM anon, authenticated;
REVOKE ALL ON TABLE public.candidate_feedback FROM anon, authenticated;
REVOKE ALL ON TABLE public.refinement_cycles FROM anon, authenticated;
REVOKE ALL ON TABLE public.refinement_cycle_votes FROM anon, authenticated;
REVOKE ALL ON TABLE public.round_deadline_audit FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.idea_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evaluation_round_participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidate_feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refinement_cycles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refinement_cycle_votes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.round_deadline_audit TO service_role;

REVOKE ALL ON FUNCTION public.guard_refinement_round() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_round_deadline_extension() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_approved_idea_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_approved_idea_version_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_round_participant_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_final_candidate_feedback() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_refinement_round() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_round_deadline_extension() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_approved_idea_version() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_approved_idea_version_history() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_round_participant_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_final_candidate_feedback() TO service_role;

COMMIT;

-- =============================================================================
-- 백엔드 구현 규칙 (SQL 실행문이 아니라 필수 애플리케이션 계약)
-- =============================================================================
-- 1) engine_version < 4인 기존 방은 기존 계산식/기존 결과를 그대로 조회한다.
-- 2) engine_version >= 4인 신규 방만 이 기능을 사용한다.
-- 3) 라운드 시작 시 participants를 evaluation_round_participants에 한 번 복사하고
--    라운드 종료까지 명단/분모를 바꾸지 않는다.
-- 4) minimum_response_count는 시작 시점에 확정한다.
--    권장 초기값은 CEIL(snapshot_count * 0.8)이지만, 이는 검증 전 가설이다.
-- 5) 모든 필수 참여자가 FINAL 제출하면 마감 전이라도 종료할 수 있다.
-- 6) 마감 시 최소 응답 미달이면 결과를 만들지 말고 INSUFFICIENT_RESPONSES로 종료한다.
-- 7) 미응답과 UNSURE는 0점/반대가 아니다. 충족도 분모에서 제외하고 별도 표시한다.
-- 8) 화면에는 충족도와 함께 유효 응답 수 및 UNSURE 수/비율을 표시한다.
-- 9) 중간 집계는 results_revealed_at 전까지 누구에게도 반환하지 않는다.
-- 10) candidate_feedback.evaluator_id는 동료에게 절대 반환하지 않는다.
-- 11) AI가 피드백을 중립화한 published_summary도 작성자의 APPROVED 후에만 공개한다.
-- 12) AI ANONYMIZED 버전은 의미를 추가/삭제하지 않고 말투와 문서 형식만 통일한다.
-- 13) LOGIC_ENHANCED 버전은 AI 질문에 사용자가 답한 내용만 반영한다.
-- 14) 어떤 AI 버전도 APPROVED 전에는 ideas.current_version_id로 지정하지 않는다.
-- 15) AI 장애 시 구조화 템플릿을 제공하고 기존 원문으로 계속 진행할 수 있어야 한다.
-- 16) 보완 라운드 동의자는 source_round 스냅샷 참여자로 한정한다.
--     required_yes_count는 시작 전에 고정한다. 초기 제품 가설은 CEIL(N * 2/3)이며
--     사용성 검증 전에는 이를 객관적 정답이라고 홍보하지 않는다.
-- 17) 보완 라운드는 동의 후 1회만 만들고 부모와 같은 기준 세트를 쓴다.
-- 18) 기존 헤더/사이드바/카드/색상은 수정하지 않는다. 새 UI는 기존 컴포넌트와
--     purple/yellow/navy/gray 토큰을 재사용한 최소 영역으로만 추가한다.

-- =============================================================================
-- 실행 후 확인용 읽기 전용 쿼리
-- =============================================================================

SELECT
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'idea_versions',
    'evaluation_round_participants',
    'candidate_feedback',
    'refinement_cycles',
    'refinement_cycle_votes',
    'round_deadline_audit'
  )
ORDER BY table_name;

SELECT
  column_name,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rooms'
  AND column_name IN ('engine_version', 'refinement_enabled', 'max_refinement_rounds')
ORDER BY column_name;

SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'idea_versions',
    'evaluation_round_participants',
    'candidate_feedback',
    'refinement_cycles',
    'refinement_cycle_votes',
    'round_deadline_audit'
  )
ORDER BY tablename, policyname;

-- 위 pg_policies 결과는 0행이어야 정상이다.
-- 신규 테이블은 anon/authenticated 정책 없이 service_role BFF만 접근한다.

-- =============================================================================
-- 별도 P0 보안 전환 안내 (이 파일에서는 실행하지 않음)
-- =============================================================================
-- 현재 마스터 SQL에는 기존 핵심 테이블에 USING(true)인 Public access 정책이 있다.
-- 따라서 기존 ideas/criteria/evaluations의 완전한 비공개는 아직 보장되지 않는다.
-- 프론트의 supabase.from()/rpc()/Realtime 직접 접근이 모두 BFF로 바뀌고,
-- 익명 사용자·참여자·방장 회귀 테스트가 통과한 뒤에만 별도 마이그레이션으로
-- 해당 Public access 정책과 공개 투표/공개 초대 경로를 제거해야 한다.
