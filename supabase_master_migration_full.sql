-- =============================================================================
-- WhyNot 통합 마스터 마이그레이션 (V1 ~ V9)
-- 생성 기준: 2026-08-21
--
-- 실행 순서와 의존성을 보존한 통합본이다.
-- 기존 운영 DB에는 migrations 폴더의 신규 파일만 순서대로 실행하고,
-- 신규/복구 환경에서는 이 파일 하나로 전체 스키마를 구성한다.
-- =============================================================================


-- =============================================================================
-- BASE SCHEMA (V1-V3)
-- =============================================================================

-- ==============================================================================
-- WhyNot Complete Master Database Migration (17 Tables & All Required Columns)
-- Execute this entire script in Supabase Dashboard -> SQL Editor
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. BASE TABLES & EXTENSION COLUMNS
-- ------------------------------------------------------------------------------

-- Rooms Table & Extension Columns
CREATE TABLE IF NOT EXISTS public.rooms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT '기획',
    is_public BOOLEAN DEFAULT false,
    max_participants INT DEFAULT 6,
    target_winner_count INT DEFAULT 1,
    is_pinned BOOLEAN DEFAULT false,
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
  ADD COLUMN IF NOT EXISTS final_vote_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS tie_candidate_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS tie_slots INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_round_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS criteria_set_version INT NOT NULL DEFAULT 1;

-- Participants Table & Extension Columns
CREATE TABLE IF NOT EXISTS public.participants (
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    hidden_at TIMESTAMPTZ NULL,
    PRIMARY KEY (room_id, user_id)
);

ALTER TABLE public.participants
ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ NULL;

-- Ideas Table & Extension Columns
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
ADD COLUMN IF NOT EXISTS pdf_attachment_url TEXT NULL,
ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ideas_id_room_id_unique ON public.ideas (id, room_id);

-- Criteria Table
CREATE TABLE IF NOT EXISTS public.criteria (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    weight NUMERIC DEFAULT 1.0,
    confirmed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.criteria
ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT 1.0;

-- Criterion Proposals Table
CREATE TABLE IF NOT EXISTS public.criterion_proposals (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    proposer_id TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    parsed_name TEXT NULL,
    status TEXT DEFAULT 'PENDING',
    is_ai_suggested BOOLEAN DEFAULT false,
    revealed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.criterion_proposals
ADD COLUMN IF NOT EXISTS is_ai_suggested BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ NULL;

-- Evaluations Table
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
  ADD COLUMN IF NOT EXISTS excluded_criterion_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS criteria_evaluations JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason_type TEXT DEFAULT 'PREFERENCE',
  ADD COLUMN IF NOT EXISTS round INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS round_id TEXT NULL;

-- ------------------------------------------------------------------------------
-- 2. USER AUTHENTICATION & REGISTRATION TABLES
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    login_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    recovery_code_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
        status IN (
            'ACTIVE',
            'SUSPENDED',
            'DELETED'
        )
    ),
    failed_recovery_attempts INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES public.user_accounts (id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_registrations (
    user_id UUID PRIMARY KEY REFERENCES public.user_accounts (id) ON DELETE CASCADE,
    login_id TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    registration_status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (
        registration_status IN ('COMPLETED', 'CANCELLED')
    ),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 3. PHASE TRACKING & DECISION ENGINE TABLES
-- ------------------------------------------------------------------------------

-- Room Invites Table
CREATE TABLE IF NOT EXISTS public.room_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    invite_token TEXT UNIQUE NULL,
    invite_token_hash TEXT UNIQUE NULL,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase Completions Table
CREATE TABLE IF NOT EXISTS public.phase_completions (
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, phase, user_id)
);

-- Room Phase Participants Table (Snapshot)
CREATE TABLE IF NOT EXISTS public.room_phase_participants (
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, phase, user_id)
);

-- Criterion Approvals Table
CREATE TABLE IF NOT EXISTS public.criterion_approvals (
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    criteria_set_version INT NOT NULL DEFAULT 1,
    user_id TEXT NOT NULL,
    vote TEXT NOT NULL CHECK (vote IN ('APPROVE', 'REVISE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (
        room_id,
        criteria_set_version,
        user_id
    )
);

-- Evaluation Rounds Table
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

-- Round Candidates Table
CREATE TABLE IF NOT EXISTS public.round_candidates (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    round_id TEXT NOT NULL,
    idea_id TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
        outcome IN (
            'ACTIVE',
            'ELIMINATED',
            'WINNER'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (round_id, idea_id),
    CONSTRAINT round_candidates_round_room_fk FOREIGN KEY (round_id, room_id) REFERENCES public.evaluation_rounds (id, room_id) ON DELETE CASCADE
);

-- Decision Votes Table
CREATE TABLE IF NOT EXISTS public.decision_votes (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    selected_idea_ids TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (round_id, user_id),
    CONSTRAINT decision_votes_nonempty_selection_check CHECK (cardinality(selected_idea_ids) >= 1),
    CONSTRAINT decision_votes_round_room_fk
      FOREIGN KEY (round_id, room_id) REFERENCES public.evaluation_rounds(id, room_id) ON DELETE CASCADE
);

-- AI Reports Table
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
      FOREIGN KEY (round_id, room_id) REFERENCES public.evaluation_rounds(id, room_id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- 4. INDEXES & RLS POLICIES
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON public.rooms (host_id);

CREATE INDEX IF NOT EXISTS idx_participants_user_id ON public.participants (user_id);

CREATE INDEX IF NOT EXISTS idx_ideas_room_id ON public.ideas (room_id);

CREATE INDEX IF NOT EXISTS idx_phase_completions_room_phase ON public.phase_completions (room_id, phase);

CREATE INDEX IF NOT EXISTS idx_room_phase_participants_room_phase ON public.room_phase_participants (room_id, phase);

CREATE INDEX IF NOT EXISTS idx_user_accounts_login_id ON public.user_accounts (login_id);

CREATE INDEX IF NOT EXISTS idx_room_invites_token ON public.room_invites (invite_token);

CREATE INDEX IF NOT EXISTS evaluation_rounds_room_order_idx ON public.evaluation_rounds (room_id, round_number DESC);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.criteria ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.criterion_proposals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_registrations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.phase_completions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.room_phase_participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.criterion_approvals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.evaluation_rounds ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.round_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.decision_votes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;

-- BFF-only security baseline.
-- Browser roles must not read/write application tables directly. The Express
-- server uses the service-role credential and performs authentication/authorization.
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

COMMIT;

-- =============================================================================
-- V4.1 CANDIDATE REFINEMENT
-- =============================================================================

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
--   - 현재 마스터 SQL은 BFF-only 보안 기준으로 anon/authenticated의 직접 테이블 접근을
--     허용하지 않는다. service_role을 사용하는 Express BFF만 데이터 접근을 수행한다.
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
-- P0 BFF 보안 기준 확인
-- =============================================================================
-- 마스터 SQL의 핵심 테이블은 anon/authenticated 직접 접근 권한과 permissive
-- Public access 정책을 두지 않는다. 브라우저는 Express BFF를 통해서만 접근한다.
-- 이후 추가되는 신규 테이블도 동일한 BFF-only 원칙을 유지해야 한다.

-- =============================================================================
-- V5 SCORE + FEEDBACK SCREENING
-- =============================================================================

-- =============================================================================
-- WhyNot 종합점수·필수 피드백 기반 1차 스크리닝 V5
--
-- 적용 원칙
--   - 기존 평가/보완/투표 테이블과 기존 행은 삭제하지 않는다.
--   - 기존 evaluations.decision 컬럼은 보존하되 점수제 제출을 위해 NULL을 허용한다.
--   - 구조화 회의실은 종합점수(1~10) + 필수 피드백 방식으로 전환한다.
--   - 계산과 40% 생존자 선정은 서버가 결정론적으로 수행하며 AI는 계산에 관여하지 않는다.
-- =============================================================================

BEGIN;

-- 1. 기존 평가 행을 보존하면서 점수제 입력 필드를 추가한다.
ALTER TABLE public.evaluations
  ALTER COLUMN decision DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS overall_score SMALLINT NULL,
  ADD COLUMN IF NOT EXISTS feedback_text TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.evaluations'::regclass
      AND conname = 'evaluations_overall_score_check'
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT evaluations_overall_score_check
      CHECK (overall_score IS NULL OR overall_score BETWEEN 1 AND 10);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.evaluations'::regclass
      AND conname = 'evaluations_score_feedback_check'
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT evaluations_score_feedback_check
      CHECK (
        overall_score IS NULL OR (
          NULLIF(BTRIM(COALESCE(feedback_text, '')), '') IS NOT NULL
          AND CHAR_LENGTH(feedback_text) <= 500
        )
      );
  END IF;
END $$;

-- 조회 경로를 고정한다. 신규 점수제 행은 서버가 결정론적 기본키로 upsert한다.
-- 기존 평가 행은 삭제·병합하지 않으므로 과거 중복 데이터가 있어도 마이그레이션을 막지 않는다.
CREATE INDEX IF NOT EXISTS evaluations_round_evaluator_idea_idx
  ON public.evaluations(round_id, evaluator_id, idea_id);

CREATE INDEX IF NOT EXISTS evaluations_round_score_idx
  ON public.evaluations(round_id, idea_id, overall_score)
  WHERE overall_score IS NOT NULL;

-- 2. 평가 회차에 점수제 방식과 집계 상태를 명시한다.
ALTER TABLE public.evaluation_rounds
  ADD COLUMN IF NOT EXISTS evaluation_method TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS survival_ratio NUMERIC(4, 3) NOT NULL DEFAULT 0.400,
  ADD COLUMN IF NOT EXISTS aggregation_status TEXT NOT NULL DEFAULT 'NOT_STARTED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.evaluation_rounds'::regclass
      AND conname = 'evaluation_rounds_method_check'
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_method_check
      CHECK (evaluation_method IN ('LEGACY', 'SCORE_FEEDBACK'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.evaluation_rounds'::regclass
      AND conname = 'evaluation_rounds_survival_ratio_check'
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_survival_ratio_check
      CHECK (survival_ratio > 0 AND survival_ratio <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.evaluation_rounds'::regclass
      AND conname = 'evaluation_rounds_aggregation_status_check'
  ) THEN
    ALTER TABLE public.evaluation_rounds
      ADD CONSTRAINT evaluation_rounds_aggregation_status_check
      CHECK (aggregation_status IN ('NOT_STARTED', 'PROCESSING', 'COMPLETED', 'FAILED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS evaluation_rounds_room_aggregation_idx
  ON public.evaluation_rounds(room_id, aggregation_status, status);

-- 점수제 회차는 자동 집계 전까지만 FINAL 제출을 DRAFT로 되돌려 수정할 수 있다.
-- 회차 행을 함께 잠가서 "수정 시작"과 "마지막 제출 자동 집계"가 동시에 실행되지 않게 한다.
CREATE OR REPLACE FUNCTION public.guard_round_participant_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_round_status TEXT;
  v_evaluation_method TEXT;
  v_aggregation_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status
    INTO v_round_status
    FROM public.evaluation_rounds
    WHERE id = OLD.round_id
      AND room_id = OLD.room_id
    FOR UPDATE;

    IF v_round_status = 'ACTIVE' THEN
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

  SELECT status, evaluation_method, aggregation_status
  INTO v_round_status, v_evaluation_method, v_aggregation_status
  FROM public.evaluation_rounds
  WHERE id = OLD.round_id
    AND room_id = OLD.room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation round does not exist';
  END IF;

  IF OLD.submission_status = 'FINAL'
     AND NEW.submission_status <> 'FINAL' THEN
    IF NOT (
      v_evaluation_method = 'SCORE_FEEDBACK'
      AND v_round_status = 'ACTIVE'
      AND v_aggregation_status = 'NOT_STARTED'
      AND NEW.submission_status = 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Final submission cannot return to draft';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. AI는 표준화 카드와 평가 요약만 저장한다. 계산/생존자 결정 결과는 넣지 않는다.
ALTER TABLE public.ai_reports
  DROP CONSTRAINT IF EXISTS ai_reports_report_type_check;

ALTER TABLE public.ai_reports
  ADD CONSTRAINT ai_reports_report_type_check
  CHECK (report_type IN (
    'FINAL_DECISION',
    'REFINEMENT_SUMMARY',
    'EVALUATION_CARDS',
    'SCREENING_SUMMARY'
  ));

CREATE INDEX IF NOT EXISTS ai_reports_round_type_idx
  ON public.ai_reports(round_id, report_type);

-- 4. 기존 행은 보존한 채 구조화 회의실의 기본 엔진만 V5로 전환한다.
ALTER TABLE public.rooms
  ALTER COLUMN engine_version SET DEFAULT 5,
  ALTER COLUMN refinement_enabled SET DEFAULT FALSE,
  ALTER COLUMN max_refinement_rounds SET DEFAULT 0;

UPDATE public.rooms
SET
  engine_version = GREATEST(engine_version, 5),
  refinement_enabled = FALSE,
  max_refinement_rounds = 0
WHERE COALESCE(decision_mode, 'STRUCTURED') = 'STRUCTURED';

-- 5. 마지막 제출이 동시에 들어와도 집계·소거를 정확히 한 번만 수행한다.
--    브라우저에서 직접 실행할 수 없고 service_role 서버만 호출할 수 있다.
CREATE OR REPLACE FUNCTION public.finalize_score_evaluation_round(
  p_room_id TEXT,
  p_round_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_target_winner_count INT;
  v_required_count INT;
  v_candidate_count INT;
  v_missing_count INT;
  v_base_survivor_count INT;
  v_cutoff_score BIGINT;
  v_survivor_ids TEXT[] := ARRAY[]::TEXT[];
  v_eliminated_ids TEXT[] := ARRAY[]::TEXT[];
  v_score_stats JSONB := '{}'::JSONB;
  v_snapshot JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.';
  END IF;

  IF v_round.status = 'COMPLETED' THEN
    RETURN COALESCE(v_round.result_snapshot, '{}'::JSONB)
      || jsonb_build_object('aggregationStatus', 'COMPLETED', 'alreadyCompleted', TRUE);
  END IF;

  IF v_round.evaluation_method <> 'SCORE_FEEDBACK' OR v_round.stage <> 'EVALUATION' THEN
    RAISE EXCEPTION '종합점수 평가 회차가 아닙니다.';
  END IF;

  SELECT GREATEST(1, COALESCE(target_winner_count, 1))
  INTO v_target_winner_count
  FROM public.rooms
  WHERE id = p_room_id;

  SELECT COUNT(*)
  INTO v_required_count
  FROM public.evaluation_round_participants
  WHERE round_id = p_round_id
    AND room_id = p_room_id
    AND is_required = TRUE;

  SELECT COUNT(*)
  INTO v_candidate_count
  FROM public.round_candidates
  WHERE round_id = p_round_id
    AND room_id = p_room_id
    AND outcome = 'ACTIVE';

  IF v_required_count < 2 OR v_candidate_count < 2 THEN
    RAISE EXCEPTION '종합점수 평가에는 참여자와 후보가 각각 2개 이상 필요합니다.';
  END IF;

  IF v_candidate_count <= v_target_winner_count THEN
    RAISE EXCEPTION '최종 선정 수보다 후보가 최소 한 개 더 필요합니다.';
  END IF;

  -- 각 참여자는 자기 아이디어를 제외한 모든 후보를 점수+피드백으로 평가해야 한다.
  SELECT COUNT(*)
  INTO v_missing_count
  FROM public.evaluation_round_participants participant
  CROSS JOIN public.round_candidates candidate
  JOIN public.ideas idea
    ON idea.id = candidate.idea_id
   AND idea.room_id = candidate.room_id
  WHERE participant.round_id = p_round_id
    AND participant.room_id = p_room_id
    AND participant.is_required = TRUE
    AND participant.submission_status = 'FINAL'
    AND candidate.round_id = p_round_id
    AND candidate.room_id = p_room_id
    AND candidate.outcome = 'ACTIVE'
    AND idea.submitter_id <> participant.user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.evaluations evaluation
      WHERE evaluation.round_id = p_round_id
        AND evaluation.room_id = p_room_id
        AND evaluation.evaluator_id = participant.user_id
        AND evaluation.idea_id = candidate.idea_id
        AND evaluation.overall_score BETWEEN 1 AND 10
        AND NULLIF(BTRIM(COALESCE(evaluation.feedback_text, '')), '') IS NOT NULL
    );

  -- FINAL이 아닌 필수 참여자도 미완료로 센다.
  v_missing_count := v_missing_count + (
    SELECT COUNT(*)
    FROM public.evaluation_round_participants
    WHERE round_id = p_round_id
      AND room_id = p_room_id
      AND is_required = TRUE
      AND submission_status <> 'FINAL'
  );

  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object(
      'aggregationStatus', 'WAITING',
      'missingCount', v_missing_count,
      'requiredParticipantCount', v_required_count
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.evaluations evaluation
    JOIN public.ideas idea
      ON idea.id = evaluation.idea_id
     AND idea.room_id = evaluation.room_id
    WHERE evaluation.round_id = p_round_id
      AND evaluation.room_id = p_room_id
      AND evaluation.overall_score IS NOT NULL
      AND evaluation.evaluator_id = idea.submitter_id
  ) THEN
    RAISE EXCEPTION '본인 아이디어에 대한 점수 행이 포함되어 있습니다.';
  END IF;

  v_base_survivor_count := LEAST(
    v_candidate_count,
    GREATEST(
      CEIL(v_candidate_count * 0.4)::INT,
      v_target_winner_count + 1
    )
  );

  SELECT ranked.total_score
  INTO v_cutoff_score
  FROM (
    SELECT
      candidate.idea_id,
      COALESCE(SUM(evaluation.overall_score), 0)::BIGINT AS total_score
    FROM public.round_candidates candidate
    LEFT JOIN public.evaluations evaluation
      ON evaluation.round_id = candidate.round_id
     AND evaluation.room_id = candidate.room_id
     AND evaluation.idea_id = candidate.idea_id
     AND evaluation.overall_score IS NOT NULL
    WHERE candidate.round_id = p_round_id
      AND candidate.room_id = p_room_id
      AND candidate.outcome = 'ACTIVE'
    GROUP BY candidate.idea_id
    ORDER BY total_score DESC, candidate.idea_id ASC
    OFFSET GREATEST(0, v_base_survivor_count - 1)
    LIMIT 1
  ) ranked;

  WITH scores AS (
    SELECT
      candidate.idea_id,
      COALESCE(SUM(evaluation.overall_score), 0)::BIGINT AS total_score,
      COUNT(evaluation.overall_score)::INT AS response_count
    FROM public.round_candidates candidate
    LEFT JOIN public.evaluations evaluation
      ON evaluation.round_id = candidate.round_id
     AND evaluation.room_id = candidate.room_id
     AND evaluation.idea_id = candidate.idea_id
     AND evaluation.overall_score IS NOT NULL
    WHERE candidate.round_id = p_round_id
      AND candidate.room_id = p_room_id
      AND candidate.outcome = 'ACTIVE'
    GROUP BY candidate.idea_id
  )
  SELECT
    COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id) FILTER (WHERE total_score >= v_cutoff_score), ARRAY[]::TEXT[]),
    COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id) FILTER (WHERE total_score < v_cutoff_score), ARRAY[]::TEXT[]),
    COALESCE(JSONB_OBJECT_AGG(
      idea_id,
      jsonb_build_object(
        'totalScore', total_score,
        'averageScore', CASE WHEN response_count > 0 THEN ROUND(total_score::NUMERIC / response_count, 2) ELSE 0 END,
        'responseCount', response_count,
        'survived', total_score >= v_cutoff_score,
        'cutoffScore', v_cutoff_score
      )
    ), '{}'::JSONB)
  INTO v_survivor_ids, v_eliminated_ids, v_score_stats
  FROM scores;

  UPDATE public.ideas
  SET
    status = CASE WHEN id = ANY(v_survivor_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
    eliminated_round = CASE WHEN id = ANY(v_eliminated_ids) THEN v_round.round_number ELSE NULL END
  WHERE room_id = p_room_id
    AND id = ANY(v_survivor_ids || v_eliminated_ids);

  UPDATE public.round_candidates
  SET outcome = CASE WHEN idea_id = ANY(v_survivor_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
  WHERE round_id = p_round_id
    AND room_id = p_room_id;

  v_snapshot := jsonb_build_object(
    'aggregationStatus', 'COMPLETED',
    'evaluationMethod', 'SCORE_FEEDBACK',
    'survivalRatio', 0.4,
    'baseSurvivorCount', v_base_survivor_count,
    'actualSurvivorCount', CARDINALITY(v_survivor_ids),
    'cutoffScore', v_cutoff_score,
    'tieExpanded', CARDINALITY(v_survivor_ids) > v_base_survivor_count,
    'survivorIdeaIds', v_survivor_ids,
    'eliminatedIdeaIds', v_eliminated_ids,
    'scoreStats', v_score_stats,
    'completedAt', v_now
  );

  UPDATE public.evaluation_rounds
  SET
    status = 'COMPLETED',
    completed_at = v_now,
    result_snapshot = v_snapshot,
    aggregation_status = 'COMPLETED',
    closure_reason = 'ALL_SUBMITTED',
    locked_at = v_now,
    results_revealed_at = v_now
  WHERE id = p_round_id
    AND room_id = p_room_id;

  UPDATE public.rooms
  SET
    status = 'ELIMINATION',
    final_vote_status = 'NOT_STARTED',
    tie_candidate_idea_ids = ARRAY[]::TEXT[],
    tie_slots = 0
  WHERE id = p_room_id
    AND status = 'EVALUATION';

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) TO service_role;

COMMIT;

-- 실행 후 확인용(모두 0이면 정상)
SELECT 'invalid_score_rows' AS check_name, COUNT(*) AS issue_count
FROM public.evaluations
WHERE overall_score IS NOT NULL
  AND (overall_score < 1 OR overall_score > 10 OR NULLIF(BTRIM(COALESCE(feedback_text, '')), '') IS NULL)
UNION ALL
SELECT 'structured_rooms_with_refinement', COUNT(*)
FROM public.rooms
WHERE COALESCE(decision_mode, 'STRUCTURED') = 'STRUCTURED'
  AND (engine_version < 5 OR refinement_enabled OR max_refinement_rounds <> 0);

-- =============================================================================
-- V6 AI BOUNDARY TIEBREAK (HISTORICAL; V8 OVERRIDES FIRST ROUND POLICY)
-- =============================================================================

-- =============================================================================
-- WhyNot V6: 1차 점수 상위 40% + 4위 경계 동률 전용 AI 판정
--
-- 원칙
--   - 사용자 종합점수 합계와 상위 40% 계산은 DB가 수행한다.
--   - 2차 투표 후보는 최대 4개다.
--   - 4번째 자리를 가르는 총점 동률이 있을 때만 AI 결과를 허용한다.
--   - AI는 경계 동률 후보와 방 내부 근거만 비교한다.
--   - 기존 V5 회의실과 기존 평가 데이터는 변경하지 않는다.
-- =============================================================================

BEGIN;

-- 기존 보고서는 그대로 보존한다. V6 경계 동률 판정만 회차당 하나로 제한한다.
DROP INDEX IF EXISTS public.ai_reports_one_per_round_unique;
DROP INDEX IF EXISTS public.ai_reports_round_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_boundary_tiebreak_round_unique
  ON public.ai_reports(room_id, round_id)
  WHERE round_id IS NOT NULL
    AND report_type = 'AI_BOUNDARY_TIEBREAK';

ALTER TABLE public.ai_reports
  DROP CONSTRAINT IF EXISTS ai_reports_report_type_check;

ALTER TABLE public.ai_reports
  ADD CONSTRAINT ai_reports_report_type_check
  CHECK (report_type IN (
    'FINAL_DECISION',
    'REFINEMENT_SUMMARY',
    'EVALUATION_CARDS',
    'SCREENING_SUMMARY',
    'AI_BOUNDARY_TIEBREAK'
  ));

-- 새 구조화 회의실에만 V6가 적용된다. 기존 방의 engine_version은 바꾸지 않는다.
ALTER TABLE public.rooms
  ALTER COLUMN engine_version SET DEFAULT 6;

-- 점수 집계 결과를 준비한다. V6는 후보 상태를 아직 바꾸지 않고 서버 판정을 기다린다.
-- 기존 V5 방은 이전과 동일하게 상위 40% 경계 동률을 모두 살리고 즉시 완료한다.
CREATE OR REPLACE FUNCTION public.finalize_score_evaluation_round(
  p_room_id TEXT,
  p_round_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_engine_version INT;
  v_target_winner_count INT;
  v_required_count INT;
  v_candidate_count INT;
  v_missing_count INT;
  v_base_survivor_count INT;
  v_cutoff_score BIGINT;
  v_fourth_boundary_score BIGINT;
  v_remaining_slots INT := 0;
  v_ai_required BOOLEAN := FALSE;
  v_top40_ids TEXT[] := ARRAY[]::TEXT[];
  v_initial_eliminated_ids TEXT[] := ARRAY[]::TEXT[];
  v_guaranteed_ids TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_server_selected_ids TEXT[] := ARRAY[]::TEXT[];
  v_score_stats JSONB := '{}'::JSONB;
  v_snapshot JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.';
  END IF;

  IF v_round.status = 'COMPLETED' THEN
    RETURN COALESCE(v_round.result_snapshot, '{}'::JSONB)
      || jsonb_build_object('aggregationStatus', 'COMPLETED', 'alreadyCompleted', TRUE);
  END IF;

  IF v_round.evaluation_method <> 'SCORE_FEEDBACK' OR v_round.stage <> 'EVALUATION' THEN
    RAISE EXCEPTION '종합점수 평가 회차가 아닙니다.';
  END IF;

  IF v_round.aggregation_status = 'PROCESSING'
     AND COALESCE(v_round.result_snapshot->>'aggregationStatus', '') IN ('AWAITING_AI', 'READY_TO_FINALIZE') THEN
    RETURN v_round.result_snapshot;
  END IF;

  SELECT
    GREATEST(1, COALESCE(target_winner_count, 1)),
    GREATEST(1, COALESCE(engine_version, 1))
  INTO v_target_winner_count, v_engine_version
  FROM public.rooms
  WHERE id = p_room_id;

  SELECT COUNT(*)
  INTO v_required_count
  FROM public.evaluation_round_participants
  WHERE round_id = p_round_id
    AND room_id = p_room_id
    AND is_required = TRUE;

  SELECT COUNT(*)
  INTO v_candidate_count
  FROM public.round_candidates
  WHERE round_id = p_round_id
    AND room_id = p_room_id
    AND outcome = 'ACTIVE';

  IF v_required_count < 2 OR v_candidate_count < 2 THEN
    RAISE EXCEPTION '종합점수 평가에는 참여자와 후보가 각각 2개 이상 필요합니다.';
  END IF;

  IF v_candidate_count <= v_target_winner_count THEN
    RAISE EXCEPTION '최종 선정 수보다 후보가 최소 한 개 더 필요합니다.';
  END IF;

  SELECT COUNT(*)
  INTO v_missing_count
  FROM public.evaluation_round_participants participant
  CROSS JOIN public.round_candidates candidate
  JOIN public.ideas idea
    ON idea.id = candidate.idea_id
   AND idea.room_id = candidate.room_id
  WHERE participant.round_id = p_round_id
    AND participant.room_id = p_room_id
    AND participant.is_required = TRUE
    AND participant.submission_status = 'FINAL'
    AND candidate.round_id = p_round_id
    AND candidate.room_id = p_room_id
    AND candidate.outcome = 'ACTIVE'
    AND idea.submitter_id <> participant.user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.evaluations evaluation
      WHERE evaluation.round_id = p_round_id
        AND evaluation.room_id = p_room_id
        AND evaluation.evaluator_id = participant.user_id
        AND evaluation.idea_id = candidate.idea_id
        AND evaluation.overall_score BETWEEN 1 AND 10
        AND NULLIF(BTRIM(COALESCE(evaluation.feedback_text, '')), '') IS NOT NULL
    );

  v_missing_count := v_missing_count + (
    SELECT COUNT(*)
    FROM public.evaluation_round_participants
    WHERE round_id = p_round_id
      AND room_id = p_room_id
      AND is_required = TRUE
      AND submission_status <> 'FINAL'
  );

  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object(
      'aggregationStatus', 'WAITING',
      'missingCount', v_missing_count,
      'requiredParticipantCount', v_required_count
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.evaluations evaluation
    JOIN public.ideas idea
      ON idea.id = evaluation.idea_id
     AND idea.room_id = evaluation.room_id
    WHERE evaluation.round_id = p_round_id
      AND evaluation.room_id = p_room_id
      AND evaluation.overall_score IS NOT NULL
      AND evaluation.evaluator_id = idea.submitter_id
  ) THEN
    RAISE EXCEPTION '본인 아이디어에 대한 점수 행이 포함되어 있습니다.';
  END IF;

  v_base_survivor_count := LEAST(
    v_candidate_count,
    GREATEST(CEIL(v_candidate_count * 0.4)::INT, v_target_winner_count + 1)
  );

  SELECT ranked.total_score
  INTO v_cutoff_score
  FROM (
    SELECT
      candidate.idea_id,
      COALESCE(SUM(evaluation.overall_score), 0)::BIGINT AS total_score
    FROM public.round_candidates candidate
    LEFT JOIN public.evaluations evaluation
      ON evaluation.round_id = candidate.round_id
     AND evaluation.room_id = candidate.room_id
     AND evaluation.idea_id = candidate.idea_id
     AND evaluation.overall_score IS NOT NULL
    WHERE candidate.round_id = p_round_id
      AND candidate.room_id = p_room_id
      AND candidate.outcome = 'ACTIVE'
    GROUP BY candidate.idea_id
    ORDER BY total_score DESC, candidate.idea_id ASC
    OFFSET GREATEST(0, v_base_survivor_count - 1)
    LIMIT 1
  ) ranked;

  WITH scores AS (
    SELECT
      candidate.idea_id,
      COALESCE(SUM(evaluation.overall_score), 0)::BIGINT AS total_score,
      COUNT(evaluation.overall_score)::INT AS response_count
    FROM public.round_candidates candidate
    LEFT JOIN public.evaluations evaluation
      ON evaluation.round_id = candidate.round_id
     AND evaluation.room_id = candidate.room_id
     AND evaluation.idea_id = candidate.idea_id
     AND evaluation.overall_score IS NOT NULL
    WHERE candidate.round_id = p_round_id
      AND candidate.room_id = p_room_id
      AND candidate.outcome = 'ACTIVE'
    GROUP BY candidate.idea_id
  )
  SELECT
    COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id)
      FILTER (WHERE total_score >= v_cutoff_score), ARRAY[]::TEXT[]),
    COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id)
      FILTER (WHERE total_score < v_cutoff_score), ARRAY[]::TEXT[]),
    COALESCE(JSONB_OBJECT_AGG(
      idea_id,
      jsonb_build_object(
        'totalScore', total_score,
        'averageScore', CASE WHEN response_count > 0 THEN ROUND(total_score::NUMERIC / response_count, 2) ELSE 0 END,
        'responseCount', response_count,
        'cutoffScore', v_cutoff_score
      )
    ), '{}'::JSONB)
  INTO v_top40_ids, v_initial_eliminated_ids, v_score_stats
  FROM scores;

  -- V5 이하 회의실은 기존 정책을 보존한다.
  IF v_engine_version < 6 THEN
    UPDATE public.ideas
    SET
      status = CASE WHEN id = ANY(v_top40_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
      eliminated_round = CASE WHEN id = ANY(v_initial_eliminated_ids) THEN v_round.round_number ELSE NULL END
    WHERE room_id = p_room_id
      AND id = ANY(v_top40_ids || v_initial_eliminated_ids);

    UPDATE public.round_candidates
    SET outcome = CASE WHEN idea_id = ANY(v_top40_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
    WHERE round_id = p_round_id
      AND room_id = p_room_id;

    SELECT COALESCE(JSONB_OBJECT_AGG(
      entry.key,
      entry.value || jsonb_build_object('survived', entry.key = ANY(v_top40_ids))
    ), '{}'::JSONB)
    INTO v_score_stats
    FROM JSONB_EACH(v_score_stats) entry;

    v_snapshot := jsonb_build_object(
      'aggregationStatus', 'COMPLETED',
      'evaluationMethod', 'SCORE_FEEDBACK',
      'survivalRatio', 0.4,
      'requiredParticipantCount', v_required_count,
      'baseSurvivorCount', v_base_survivor_count,
      'actualSurvivorCount', CARDINALITY(v_top40_ids),
      'cutoffScore', v_cutoff_score,
      'tieExpanded', CARDINALITY(v_top40_ids) > v_base_survivor_count,
      'survivorIdeaIds', v_top40_ids,
      'eliminatedIdeaIds', v_initial_eliminated_ids,
      'scoreStats', v_score_stats,
      'completedAt', v_now
    );

    UPDATE public.evaluation_rounds
    SET status = 'COMPLETED', completed_at = v_now, result_snapshot = v_snapshot,
        aggregation_status = 'COMPLETED', closure_reason = 'ALL_SUBMITTED',
        locked_at = v_now, results_revealed_at = v_now
    WHERE id = p_round_id AND room_id = p_room_id;

    UPDATE public.rooms
    SET status = 'ELIMINATION', final_vote_status = 'NOT_STARTED',
        tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
    WHERE id = p_room_id AND status = 'EVALUATION';

    RETURN v_snapshot;
  END IF;

  IF CARDINALITY(v_top40_ids) > 4 THEN
    SELECT (v_score_stats->idea_id->>'totalScore')::BIGINT
    INTO v_fourth_boundary_score
    FROM UNNEST(v_top40_ids) WITH ORDINALITY AS ranked(idea_id, position)
    WHERE position = 4;

    SELECT
      COALESCE(ARRAY_AGG(idea_id ORDER BY position)
        FILTER (WHERE (v_score_stats->idea_id->>'totalScore')::BIGINT > v_fourth_boundary_score), ARRAY[]::TEXT[]),
      COALESCE(ARRAY_AGG(idea_id ORDER BY position)
        FILTER (WHERE (v_score_stats->idea_id->>'totalScore')::BIGINT = v_fourth_boundary_score), ARRAY[]::TEXT[])
    INTO v_guaranteed_ids, v_boundary_ids
    FROM UNNEST(v_top40_ids) WITH ORDINALITY AS ranked(idea_id, position);

    v_remaining_slots := 4 - CARDINALITY(v_guaranteed_ids);
    v_ai_required := CARDINALITY(v_boundary_ids) > v_remaining_slots AND v_remaining_slots > 0;
    IF NOT v_ai_required THEN
      v_server_selected_ids := v_top40_ids[1:4];
    ELSE
      v_server_selected_ids := v_guaranteed_ids;
    END IF;
  ELSE
    v_guaranteed_ids := v_top40_ids;
    v_boundary_ids := ARRAY[]::TEXT[];
    v_server_selected_ids := v_top40_ids;
  END IF;

  v_snapshot := jsonb_build_object(
    'aggregationStatus', CASE WHEN v_ai_required THEN 'AWAITING_AI' ELSE 'READY_TO_FINALIZE' END,
    'evaluationMethod', 'SCORE_FEEDBACK',
    'survivalRatio', 0.4,
    'requiredParticipantCount', v_required_count,
    'baseSurvivorCount', v_base_survivor_count,
    'top40ActualSurvivorCount', CARDINALITY(v_top40_ids),
    'cutoffScore', v_cutoff_score,
    'tieExpanded', CARDINALITY(v_top40_ids) > v_base_survivor_count,
    'top40SurvivorIdeaIds', v_top40_ids,
    'initialEliminatedIdeaIds', v_initial_eliminated_ids,
    'fourthBoundaryScore', v_fourth_boundary_score,
    'guaranteedSurvivorIdeaIds', v_guaranteed_ids,
    'boundaryTieIdeaIds', v_boundary_ids,
    'remainingSlots', v_remaining_slots,
    'aiTiebreakRequired', v_ai_required,
    'serverSelectedIdeaIds', v_server_selected_ids,
    'maxSecondVoteCandidates', 4,
    'scoreStats', v_score_stats,
    'preparedAt', v_now
  );

  UPDATE public.evaluation_rounds
  SET aggregation_status = 'PROCESSING', result_snapshot = v_snapshot, locked_at = v_now
  WHERE id = p_round_id AND room_id = p_room_id AND status = 'ACTIVE';

  RETURN v_snapshot;
END;
$$;

-- 준비된 스냅샷과 AI 리포트(필요한 경우)를 검증한 뒤 후보 상태를 한 번만 확정한다.
CREATE OR REPLACE FUNCTION public.apply_score_screening_result(
  p_room_id TEXT,
  p_round_id TEXT,
  p_survivor_idea_ids TEXT[],
  p_ai_report_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_snapshot JSONB;
  v_state TEXT;
  v_required_count INT;
  v_target_winner_count INT;
  v_guaranteed_ids TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_server_selected_ids TEXT[] := ARRAY[]::TEXT[];
  v_report_selected_ids TEXT[] := ARRAY[]::TEXT[];
  v_all_candidate_ids TEXT[] := ARRAY[]::TEXT[];
  v_eliminated_ids TEXT[] := ARRAY[]::TEXT[];
  v_score_stats JSONB := '{}'::JSONB;
  v_ai_result JSONB;
  v_idea_id TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN
    RETURN COALESCE(v_round.result_snapshot, '{}'::JSONB)
      || jsonb_build_object('aggregationStatus', 'COMPLETED', 'alreadyCompleted', TRUE);
  END IF;
  IF v_round.aggregation_status <> 'PROCESSING' THEN
    RAISE EXCEPTION '점수 집계 준비가 완료되지 않았습니다.';
  END IF;

  v_snapshot := COALESCE(v_round.result_snapshot, '{}'::JSONB);
  v_state := COALESCE(v_snapshot->>'aggregationStatus', '');
  v_required_count := COALESCE((v_snapshot->>'requiredParticipantCount')::INT, 0);
  v_score_stats := COALESCE(v_snapshot->'scoreStats', '{}'::JSONB);

  SELECT GREATEST(1, COALESCE(target_winner_count, 1))
  INTO v_target_winner_count
  FROM public.rooms WHERE id = p_room_id;

  SELECT COALESCE(ARRAY_AGG(idea_id ORDER BY idea_id), ARRAY[]::TEXT[])
  INTO v_all_candidate_ids
  FROM public.round_candidates
  WHERE round_id = p_round_id AND room_id = p_room_id AND outcome = 'ACTIVE';

  IF p_survivor_idea_ids IS NULL
     OR CARDINALITY(p_survivor_idea_ids) < v_target_winner_count + 1
     OR CARDINALITY(p_survivor_idea_ids) > 4
     OR CARDINALITY(p_survivor_idea_ids) <> (
       SELECT COUNT(DISTINCT candidate_id) FROM UNNEST(p_survivor_idea_ids) candidate_id
     )
     OR EXISTS (
       SELECT 1 FROM UNNEST(p_survivor_idea_ids) candidate_id
       WHERE NOT candidate_id = ANY(v_all_candidate_ids)
     ) THEN
    RAISE EXCEPTION '2차 투표 진출 후보 목록이 정책과 일치하지 않습니다.';
  END IF;

  IF v_state = 'AWAITING_AI' THEN
    SELECT COALESCE(ARRAY_AGG(value ORDER BY value), ARRAY[]::TEXT[])
    INTO v_guaranteed_ids
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_snapshot->'guaranteedSurvivorIdeaIds');

    SELECT COALESCE(ARRAY_AGG(value ORDER BY value), ARRAY[]::TEXT[])
    INTO v_boundary_ids
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_snapshot->'boundaryTieIdeaIds');

    IF p_ai_report_id IS NULL THEN RAISE EXCEPTION 'AI 경계 판정 기록이 필요합니다.'; END IF;
    SELECT result_snapshot
    INTO v_ai_result
    FROM public.ai_reports
    WHERE id = p_ai_report_id
      AND room_id = p_room_id
      AND round_id = p_round_id
      AND report_type = 'AI_BOUNDARY_TIEBREAK';
    IF NOT FOUND THEN RAISE EXCEPTION 'AI 경계 판정 기록을 찾을 수 없습니다.'; END IF;

    SELECT COALESCE(ARRAY_AGG(value ORDER BY value), ARRAY[]::TEXT[])
    INTO v_report_selected_ids
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_ai_result->'selectedIdeaIds');

    IF EXISTS (
      SELECT 1 FROM UNNEST(v_guaranteed_ids) required_id
      WHERE NOT required_id = ANY(p_survivor_idea_ids)
    ) OR EXISTS (
      SELECT 1 FROM UNNEST(p_survivor_idea_ids) survivor_id
      WHERE NOT survivor_id = ANY(v_guaranteed_ids || v_boundary_ids)
    ) OR (
      SELECT COALESCE(ARRAY_AGG(id ORDER BY id), ARRAY[]::TEXT[])
      FROM UNNEST(p_survivor_idea_ids) id
      WHERE id = ANY(v_boundary_ids)
    ) <> v_report_selected_ids THEN
      RAISE EXCEPTION 'AI 경계 판정과 최종 후보 목록이 일치하지 않습니다.';
    END IF;
  ELSIF v_state = 'READY_TO_FINALIZE' THEN
    SELECT COALESCE(ARRAY_AGG(value ORDER BY value), ARRAY[]::TEXT[])
    INTO v_server_selected_ids
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_snapshot->'serverSelectedIdeaIds');
    IF (
      SELECT ARRAY_AGG(id ORDER BY id) FROM UNNEST(p_survivor_idea_ids) id
    ) <> v_server_selected_ids THEN
      RAISE EXCEPTION '서버 점수 순위와 최종 후보 목록이 일치하지 않습니다.';
    END IF;
    IF p_ai_report_id IS NOT NULL THEN RAISE EXCEPTION 'AI 판정이 필요하지 않은 회차입니다.'; END IF;
  ELSE
    RAISE EXCEPTION '지원하지 않는 집계 준비 상태입니다.';
  END IF;

  SELECT COALESCE(ARRAY_AGG(candidate_id ORDER BY candidate_id), ARRAY[]::TEXT[])
  INTO v_eliminated_ids
  FROM UNNEST(v_all_candidate_ids) candidate_id
  WHERE NOT candidate_id = ANY(p_survivor_idea_ids);

  UPDATE public.ideas
  SET
    status = CASE WHEN id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
    eliminated_round = CASE WHEN id = ANY(v_eliminated_ids) THEN v_round.round_number ELSE NULL END
  WHERE room_id = p_room_id AND id = ANY(v_all_candidate_ids);

  UPDATE public.round_candidates
  SET outcome = CASE WHEN idea_id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
  WHERE round_id = p_round_id AND room_id = p_room_id;

  FOR v_idea_id IN SELECT key FROM JSONB_EACH(v_score_stats)
  LOOP
    v_score_stats := JSONB_SET(
      v_score_stats,
      ARRAY[v_idea_id, 'survived'],
      TO_JSONB(v_idea_id = ANY(p_survivor_idea_ids)),
      TRUE
    );
  END LOOP;

  v_snapshot := v_snapshot || jsonb_build_object(
    'aggregationStatus', 'COMPLETED',
    'actualSurvivorCount', CARDINALITY(p_survivor_idea_ids),
    'survivorIdeaIds', p_survivor_idea_ids,
    'eliminatedIdeaIds', v_eliminated_ids,
    'scoreStats', v_score_stats,
    'aiTiebreak', CASE WHEN v_state = 'AWAITING_AI' THEN v_ai_result ELSE jsonb_build_object('used', FALSE) END,
    'completedAt', v_now
  );

  UPDATE public.evaluation_rounds
  SET status = 'COMPLETED', completed_at = v_now, result_snapshot = v_snapshot,
      aggregation_status = 'COMPLETED', closure_reason = 'ALL_SUBMITTED',
      locked_at = v_now, results_revealed_at = v_now
  WHERE id = p_round_id AND room_id = p_room_id AND status = 'ACTIVE';

  UPDATE public.rooms
  SET status = 'ELIMINATION', final_vote_status = 'NOT_STARTED',
      tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id AND status = 'EVALUATION';

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.apply_score_screening_result(TEXT, TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_score_screening_result(TEXT, TEXT, TEXT[], TEXT) TO service_role;

COMMIT;

-- 실행 후 확인용: 모두 0이면 정상
SELECT 'duplicate_boundary_tiebreak_reports' AS check_name, COUNT(*) AS issue_count
FROM (
  SELECT room_id, round_id
  FROM public.ai_reports
  WHERE round_id IS NOT NULL
    AND report_type = 'AI_BOUNDARY_TIEBREAK'
  GROUP BY room_id, round_id
  HAVING COUNT(*) > 1
) duplicates
UNION ALL
SELECT 'v6_completed_rounds_over_four', COUNT(*)
FROM public.evaluation_rounds round_row
JOIN public.rooms room_row ON room_row.id = round_row.room_id
WHERE room_row.engine_version >= 6
  AND round_row.evaluation_method = 'SCORE_FEEDBACK'
  AND round_row.aggregation_status = 'COMPLETED'
  AND JSONB_ARRAY_LENGTH(COALESCE(round_row.result_snapshot->'survivorIdeaIds', '[]'::JSONB)) > 4;

-- =============================================================================
-- V7 TWO-STAGE + CUMULATIVE FINAL
-- =============================================================================

-- =============================================================================
-- WhyNot V7: 1차 최대 8개 / 2차 최대 4개 / 별 3개 누적 최종 투표
--
-- 기존 V1~V6 데이터와 테이블은 보존한다. 새 구조화/빠른 결정 회의실만 V7을 사용한다.
-- =============================================================================

BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS current_final_vote_cycle_id TEXT NULL;

ALTER TABLE public.rooms
  ALTER COLUMN engine_version SET DEFAULT 7;

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_final_vote_status_check;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_final_vote_status_check
  CHECK (final_vote_status IN (
    'NOT_STARTED', 'VOTING', 'TIE_PENDING', 'CONSENT_PENDING',
    'ROULETTE_PENDING', 'FINALIZED'
  ));

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS winner_selection_method TEXT NULL;

ALTER TABLE public.ideas
  DROP CONSTRAINT IF EXISTS ideas_winner_selection_method_check;

ALTER TABLE public.ideas
  ADD CONSTRAINT ideas_winner_selection_method_check
  CHECK (winner_selection_method IS NULL OR winner_selection_method IN (
    'CUMULATIVE_STAR', 'ROULETTE', 'AUTO_ALL'
  ));

ALTER TABLE public.evaluation_rounds
  DROP CONSTRAINT IF EXISTS evaluation_rounds_method_check;

ALTER TABLE public.evaluation_rounds
  ADD CONSTRAINT evaluation_rounds_method_check
  CHECK (evaluation_method IN ('LEGACY', 'SCORE_FEEDBACK', 'SCORE_ONLY'));

-- V5의 기존 CHECK는 모든 점수 행에 피드백을 강제하므로 2차 SCORE_ONLY와 충돌한다.
-- 1차 피드백 필수 여부는 아래 집계 RPC가 회차 방식과 함께 검증한다.
ALTER TABLE public.evaluations
  DROP CONSTRAINT IF EXISTS evaluations_score_feedback_check;

ALTER TABLE public.evaluations
  ADD CONSTRAINT evaluations_score_feedback_check
  CHECK (feedback_text IS NULL OR CHAR_LENGTH(feedback_text) <= 500);

-- 1차와 2차 모두 전체 집계가 시작되기 전에는 제출자가 자신의 FINAL
-- 제출을 DRAFT로 되돌려 수정할 수 있다. 기존 스냅샷 신원은 그대로 잠근다.
CREATE OR REPLACE FUNCTION public.guard_round_participant_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_round_status TEXT;
  v_evaluation_method TEXT;
  v_aggregation_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_round_status
    FROM public.evaluation_rounds
    WHERE id = OLD.round_id AND room_id = OLD.room_id
    FOR UPDATE;
    IF v_round_status = 'ACTIVE' THEN
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

  SELECT status, evaluation_method, aggregation_status
  INTO v_round_status, v_evaluation_method, v_aggregation_status
  FROM public.evaluation_rounds
  WHERE id = OLD.round_id AND room_id = OLD.room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluation round does not exist'; END IF;

  IF OLD.submission_status = 'FINAL' AND NEW.submission_status <> 'FINAL' THEN
    IF NOT (
      v_evaluation_method IN ('SCORE_FEEDBACK', 'SCORE_ONLY')
      AND v_round_status = 'ACTIVE'
      AND v_aggregation_status = 'NOT_STARTED'
      AND NEW.submission_status = 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Final submission cannot return to draft';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.final_vote_cycles (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  decision_round_id TEXT NOT NULL,
  cycle_number INT NOT NULL CHECK (cycle_number >= 1),
  cycle_kind TEXT NOT NULL CHECK (cycle_kind IN ('INITIAL', 'TIE_REVOTE')),
  candidate_idea_ids TEXT[] NOT NULL CHECK (CARDINALITY(candidate_idea_ids) >= 1),
  guaranteed_winner_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tie_candidate_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tie_slots INT NOT NULL DEFAULT 0 CHECK (tie_slots >= 0),
  status TEXT NOT NULL CHECK (status IN ('VOTING', 'CONSENT', 'ROULETTE', 'COMPLETED')),
  result_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT final_vote_cycles_round_room_fk
    FOREIGN KEY (decision_round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE,
  UNIQUE (room_id, decision_round_id, cycle_number)
);

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_current_final_vote_cycle_fk;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_current_final_vote_cycle_fk
  FOREIGN KEY (current_final_vote_cycle_id)
  REFERENCES public.final_vote_cycles(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.final_vote_ballots (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES public.final_vote_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selected_idea_ids TEXT[] NOT NULL CHECK (CARDINALITY(selected_idea_ids) = 3),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, user_id),
  CONSTRAINT final_vote_ballots_member_fk
    FOREIGN KEY (room_id, user_id)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.final_roulette_consents (
  cycle_id TEXT NOT NULL REFERENCES public.final_vote_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  consent BOOLEAN NOT NULL,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, user_id),
  CONSTRAINT final_roulette_consents_member_fk
    FOREIGN KEY (room_id, user_id)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.final_roulette_draws (
  cycle_id TEXT NOT NULL REFERENCES public.final_vote_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  draw_number INT NOT NULL CHECK (draw_number >= 1),
  candidate_idea_ids TEXT[] NOT NULL CHECK (CARDINALITY(candidate_idea_ids) >= 1),
  selected_idea_id TEXT NOT NULL REFERENCES public.ideas(id) ON DELETE RESTRICT,
  drawn_by TEXT NOT NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, draw_number),
  UNIQUE (cycle_id, selected_idea_id),
  CONSTRAINT final_roulette_draws_host_fk
    FOREIGN KEY (room_id, drawn_by)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS final_vote_cycles_room_status_idx
  ON public.final_vote_cycles(room_id, status, cycle_number DESC);
CREATE INDEX IF NOT EXISTS final_vote_ballots_cycle_idx
  ON public.final_vote_ballots(cycle_id, submitted_at);
CREATE INDEX IF NOT EXISTS final_roulette_consents_cycle_idx
  ON public.final_roulette_consents(cycle_id, consent);
CREATE INDEX IF NOT EXISTS final_roulette_draws_cycle_idx
  ON public.final_roulette_draws(cycle_id, draw_number);

ALTER TABLE public.final_vote_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_vote_ballots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_roulette_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_roulette_draws ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.final_vote_cycles FROM anon, authenticated;
REVOKE ALL ON public.final_vote_ballots FROM anon, authenticated;
REVOKE ALL ON public.final_roulette_consents FROM anon, authenticated;
REVOKE ALL ON public.final_roulette_draws FROM anon, authenticated;
GRANT ALL ON public.final_vote_cycles TO service_role;
GRANT ALL ON public.final_vote_ballots TO service_role;
GRANT ALL ON public.final_roulette_consents TO service_role;
GRANT ALL ON public.final_roulette_draws TO service_role;

-- 점수 집계는 순수 합계만 사용한다. 중간값/편차/구간 비율/가중치/보정점수는 계산하지 않는다.
CREATE OR REPLACE FUNCTION public.finalize_score_evaluation_round(
  p_room_id TEXT,
  p_round_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_target_winner_count INT;
  v_required_count INT;
  v_candidate_count INT;
  v_missing_count INT;
  v_desired_count INT;
  v_max_count INT;
  v_base_cutoff BIGINT;
  v_boundary_score BIGINT;
  v_remaining_slots INT := 0;
  v_ai_required BOOLEAN := FALSE;
  v_candidate_ids TEXT[] := ARRAY[]::TEXT[];
  v_base_ids TEXT[] := ARRAY[]::TEXT[];
  v_guaranteed_ids TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_server_selected_ids TEXT[] := ARRAY[]::TEXT[];
  v_score_stats JSONB := '{}'::JSONB;
  v_snapshot JSONB;
BEGIN
  SELECT * INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN
    RETURN COALESCE(v_round.result_snapshot, '{}'::JSONB)
      || jsonb_build_object('aggregationStatus', 'COMPLETED', 'alreadyCompleted', TRUE);
  END IF;
  IF v_round.evaluation_method NOT IN ('SCORE_FEEDBACK', 'SCORE_ONLY') OR v_round.stage <> 'EVALUATION' THEN
    RAISE EXCEPTION '지원하는 점수 평가 회차가 아닙니다.';
  END IF;
  IF v_round.aggregation_status = 'PROCESSING'
     AND COALESCE(v_round.result_snapshot->>'aggregationStatus', '') IN ('AWAITING_AI', 'READY_TO_FINALIZE') THEN
    RETURN v_round.result_snapshot;
  END IF;

  SELECT GREATEST(1, COALESCE(target_winner_count, 1))
  INTO v_target_winner_count FROM public.rooms WHERE id = p_room_id;
  SELECT COUNT(*) INTO v_required_count
  FROM public.evaluation_round_participants
  WHERE round_id = p_round_id AND room_id = p_room_id AND is_required = TRUE;
  SELECT COUNT(*) INTO v_candidate_count
  FROM public.round_candidates
  WHERE round_id = p_round_id AND room_id = p_room_id AND outcome = 'ACTIVE';

  IF v_required_count < 2 OR v_candidate_count < 2 THEN
    RAISE EXCEPTION '점수 평가에는 참여자와 후보가 각각 2개 이상 필요합니다.';
  END IF;

  SELECT COUNT(*) INTO v_missing_count
  FROM public.evaluation_round_participants participant
  CROSS JOIN public.round_candidates candidate
  JOIN public.ideas idea ON idea.id = candidate.idea_id AND idea.room_id = candidate.room_id
  WHERE participant.round_id = p_round_id
    AND participant.room_id = p_room_id
    AND participant.is_required = TRUE
    AND participant.submission_status = 'FINAL'
    AND candidate.round_id = p_round_id
    AND candidate.room_id = p_room_id
    AND candidate.outcome = 'ACTIVE'
    AND idea.submitter_id <> participant.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.evaluations evaluation
      WHERE evaluation.round_id = p_round_id
        AND evaluation.room_id = p_room_id
        AND evaluation.evaluator_id = participant.user_id
        AND evaluation.idea_id = candidate.idea_id
        AND evaluation.overall_score BETWEEN 1 AND 10
        AND (
          v_round.evaluation_method = 'SCORE_ONLY'
          OR NULLIF(BTRIM(COALESCE(evaluation.feedback_text, '')), '') IS NOT NULL
        )
    );
  v_missing_count := v_missing_count + (
    SELECT COUNT(*) FROM public.evaluation_round_participants
    WHERE round_id = p_round_id AND room_id = p_room_id
      AND is_required = TRUE AND submission_status <> 'FINAL'
  );
  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object(
      'aggregationStatus', 'WAITING',
      'missingCount', v_missing_count,
      'requiredParticipantCount', v_required_count
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.evaluations evaluation
    JOIN public.ideas idea ON idea.id = evaluation.idea_id AND idea.room_id = evaluation.room_id
    WHERE evaluation.round_id = p_round_id AND evaluation.room_id = p_room_id
      AND evaluation.overall_score IS NOT NULL AND evaluation.evaluator_id = idea.submitter_id
  ) THEN
    RAISE EXCEPTION '본인 아이디어에 대한 점수 행이 포함되어 있습니다.';
  END IF;

  WITH scores AS (
    SELECT candidate.idea_id,
      COALESCE(SUM(evaluation.overall_score), 0)::BIGINT AS total_score,
      COUNT(evaluation.overall_score)::INT AS response_count
    FROM public.round_candidates candidate
    LEFT JOIN public.evaluations evaluation
      ON evaluation.round_id = candidate.round_id
     AND evaluation.room_id = candidate.room_id
     AND evaluation.idea_id = candidate.idea_id
     AND evaluation.overall_score IS NOT NULL
    WHERE candidate.round_id = p_round_id AND candidate.room_id = p_room_id
      AND candidate.outcome = 'ACTIVE'
    GROUP BY candidate.idea_id
  )
  SELECT
    ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id),
    JSONB_OBJECT_AGG(idea_id, jsonb_build_object(
      'totalScore', total_score,
      'responseCount', response_count
    ))
  INTO v_candidate_ids, v_score_stats
  FROM scores;

  IF v_round.evaluation_method = 'SCORE_FEEDBACK' THEN
    v_desired_count := LEAST(
      v_candidate_count,
      GREATEST(CEIL(v_candidate_count * 0.4)::INT, v_target_winner_count + 1)
    );
    v_max_count := LEAST(v_candidate_count, 8);
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT total_score INTO v_base_cutoff
    FROM scores ORDER BY total_score DESC, idea_id OFFSET v_desired_count - 1 LIMIT 1;
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id), ARRAY[]::TEXT[])
    INTO v_base_ids FROM scores WHERE total_score >= v_base_cutoff;
  ELSE
    v_desired_count := LEAST(v_candidate_count, 4);
    v_max_count := v_desired_count;
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT total_score INTO v_base_cutoff
    FROM scores ORDER BY total_score DESC, idea_id OFFSET v_desired_count - 1 LIMIT 1;
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id), ARRAY[]::TEXT[])
    INTO v_base_ids FROM scores WHERE total_score >= v_base_cutoff;
  END IF;

  IF CARDINALITY(v_base_ids) <= v_max_count THEN
    v_server_selected_ids := v_base_ids;
  ELSE
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT total_score INTO v_boundary_score
    FROM scores ORDER BY total_score DESC, idea_id OFFSET v_max_count - 1 LIMIT 1;
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT
      COALESCE(ARRAY_AGG(idea_id ORDER BY idea_id) FILTER (WHERE total_score > v_boundary_score), ARRAY[]::TEXT[]),
      COALESCE(ARRAY_AGG(idea_id ORDER BY idea_id) FILTER (WHERE total_score = v_boundary_score), ARRAY[]::TEXT[])
    INTO v_guaranteed_ids, v_boundary_ids FROM scores;
    v_remaining_slots := v_max_count - CARDINALITY(v_guaranteed_ids);
    v_ai_required := CARDINALITY(v_boundary_ids) > v_remaining_slots AND v_remaining_slots > 0;
    IF NOT v_ai_required THEN v_server_selected_ids := v_candidate_ids[1:v_max_count]; END IF;
  END IF;

  v_snapshot := jsonb_build_object(
    'aggregationStatus', CASE WHEN v_ai_required THEN 'AWAITING_AI' ELSE 'READY_TO_FINALIZE' END,
    'evaluationMethod', v_round.evaluation_method,
    'scorePhase', CASE WHEN v_round.evaluation_method = 'SCORE_ONLY' THEN 'SECOND' ELSE 'FIRST' END,
    'requiredParticipantCount', v_required_count,
    'candidateIdeaIds', v_candidate_ids,
    'baseSurvivorCount', v_desired_count,
    'baseCutoffScore', v_base_cutoff,
    'guaranteedSurvivorIdeaIds', v_guaranteed_ids,
    'boundaryScore', v_boundary_score,
    'boundaryTieIdeaIds', v_boundary_ids,
    'remainingSlots', v_remaining_slots,
    'aiTiebreakRequired', v_ai_required,
    'serverSelectedIdeaIds', v_server_selected_ids,
    'maxSurvivorCount', v_max_count,
    'scoreStats', v_score_stats
  );
  UPDATE public.evaluation_rounds
  SET aggregation_status = 'PROCESSING', result_snapshot = v_snapshot
  WHERE id = p_round_id AND room_id = p_room_id;
  RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_score_round_result_v7(
  p_room_id TEXT,
  p_round_id TEXT,
  p_survivor_idea_ids TEXT[],
  p_ai_report_id TEXT DEFAULT NULL,
  p_next_status TEXT DEFAULT 'ELIMINATION'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_snapshot JSONB;
  v_candidate_ids TEXT[];
  v_eliminated_ids TEXT[];
  v_max_count INT;
  v_ai_result JSONB := jsonb_build_object('used', FALSE);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_round FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN RETURN v_round.result_snapshot; END IF;
  IF p_next_status NOT IN ('EVALUATION_ROUND_2', 'ELIMINATION') THEN
    RAISE EXCEPTION '올바르지 않은 다음 단계입니다.';
  END IF;
  v_snapshot := COALESCE(v_round.result_snapshot, '{}'::JSONB);
  v_candidate_ids := ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(v_snapshot->'candidateIdeaIds'));
  v_max_count := CASE WHEN v_round.evaluation_method = 'SCORE_ONLY' THEN 4 ELSE 8 END;
  IF CARDINALITY(p_survivor_idea_ids) < 1 OR CARDINALITY(p_survivor_idea_ids) > v_max_count THEN
    RAISE EXCEPTION '진출 후보 수가 정책 범위를 벗어났습니다.';
  END IF;
  IF CARDINALITY(p_survivor_idea_ids) <> (SELECT COUNT(DISTINCT item) FROM UNNEST(p_survivor_idea_ids) item)
     OR EXISTS (SELECT 1 FROM UNNEST(p_survivor_idea_ids) item WHERE NOT item = ANY(v_candidate_ids)) THEN
    RAISE EXCEPTION '진출 후보 목록이 현재 회차와 일치하지 않습니다.';
  END IF;
  IF COALESCE((v_snapshot->>'aiTiebreakRequired')::BOOLEAN, FALSE) THEN
    SELECT result_snapshot INTO v_ai_result FROM public.ai_reports
    WHERE id = p_ai_report_id AND room_id = p_room_id AND round_id = p_round_id
      AND report_type = 'AI_BOUNDARY_TIEBREAK';
    IF v_ai_result IS NULL THEN RAISE EXCEPTION '저장된 AI 경계 판정이 필요합니다.'; END IF;
  END IF;
  v_eliminated_ids := ARRAY(SELECT item FROM UNNEST(v_candidate_ids) item WHERE NOT item = ANY(p_survivor_idea_ids));

  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
    eliminated_round = CASE WHEN id = ANY(v_eliminated_ids) THEN v_round.round_number ELSE NULL END
  WHERE room_id = p_room_id AND id = ANY(v_candidate_ids);
  UPDATE public.round_candidates SET
    outcome = CASE WHEN idea_id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
  WHERE room_id = p_room_id AND round_id = p_round_id;

  SELECT JSONB_OBJECT_AGG(entry.key,
    entry.value || jsonb_build_object('survived', entry.key = ANY(p_survivor_idea_ids)))
  INTO v_snapshot FROM JSONB_EACH(COALESCE(v_snapshot->'scoreStats', '{}'::JSONB)) entry;
  v_snapshot := v_round.result_snapshot || jsonb_build_object(
    'aggregationStatus', 'COMPLETED',
    'survivorIdeaIds', p_survivor_idea_ids,
    'eliminatedIdeaIds', v_eliminated_ids,
    'actualSurvivorCount', CARDINALITY(p_survivor_idea_ids),
    'aiTiebreak', v_ai_result,
    'scoreStats', COALESCE(v_snapshot, '{}'::JSONB),
    'completedAt', v_now
  );
  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED', aggregation_status = 'COMPLETED', completed_at = v_now,
    result_snapshot = v_snapshot, results_revealed_at = COALESCE(results_revealed_at, v_now),
    locked_at = COALESCE(locked_at, v_now)
  WHERE id = p_round_id AND room_id = p_room_id;
  UPDATE public.rooms SET
    status = p_next_status, final_vote_status = 'NOT_STARTED', current_round_id = NULL,
    tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN v_snapshot;
END;
$$;

-- 별 3개는 같은 후보에 중복 배정할 수 있다. 마지막 제출과 집계는 회차 행 잠금 안에서 한 번만 처리한다.
CREATE OR REPLACE FUNCTION public.submit_cumulative_star_ballot_v7(
  p_room_id TEXT,
  p_cycle_id TEXT,
  p_user_id TEXT,
  p_selected_idea_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_expected INT;
  v_submitted INT;
  v_boundary_score INT;
  v_current_guaranteed TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_all_guaranteed TEXT[] := ARRAY[]::TEXT[];
  v_winner_ids TEXT[] := ARRAY[]::TEXT[];
  v_remaining_slots INT;
  v_counts JSONB := '{}'::JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'VOTING' THEN RAISE EXCEPTION '현재 제출 가능한 최종 투표 회차가 아닙니다.'; END IF;
  IF CARDINALITY(p_selected_idea_ids) <> 3 THEN RAISE EXCEPTION '별 스티커 3개를 모두 사용해야 합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM UNNEST(p_selected_idea_ids) item WHERE NOT item = ANY(v_cycle.candidate_idea_ids)) THEN
    RAISE EXCEPTION '현재 투표 대상이 아닌 후보가 포함되어 있습니다.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.room_phase_participants
    WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION '최종 투표 참여자가 아닙니다.'; END IF;

  INSERT INTO public.final_vote_ballots(id, cycle_id, room_id, user_id, selected_idea_ids, submitted_at)
  VALUES ('final-ballot-' || gen_random_uuid()::TEXT, p_cycle_id, p_room_id, p_user_id, p_selected_idea_ids, v_now)
  ON CONFLICT (cycle_id, user_id) DO UPDATE
    SET selected_idea_ids = EXCLUDED.selected_idea_ids, submitted_at = EXCLUDED.submitted_at;

  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  SELECT COUNT(*) INTO v_submitted FROM public.final_vote_ballots WHERE cycle_id = p_cycle_id;
  IF v_submitted < v_expected THEN
    RETURN jsonb_build_object('status', 'VOTING', 'submittedCount', v_submitted, 'expectedCount', v_expected, 'currentCycleId', p_cycle_id);
  END IF;

  WITH counts AS (
    SELECT candidate_id, COUNT(*)::INT AS star_count
    FROM public.final_vote_ballots ballot
    CROSS JOIN LATERAL UNNEST(ballot.selected_idea_ids) candidate_id
    WHERE ballot.cycle_id = p_cycle_id
    GROUP BY candidate_id
  ), complete_counts AS (
    SELECT candidate_id, COALESCE(counts.star_count, 0) AS star_count
    FROM UNNEST(v_cycle.candidate_idea_ids) candidate_id
    LEFT JOIN counts USING (candidate_id)
  )
  SELECT JSONB_OBJECT_AGG(candidate_id, star_count) INTO v_counts FROM complete_counts;

  WITH counts AS (
    SELECT key AS candidate_id, value::TEXT::INT AS star_count FROM JSONB_EACH(v_counts)
  )
  SELECT star_count INTO v_boundary_score FROM counts
  ORDER BY star_count DESC, candidate_id OFFSET GREATEST(0, v_cycle.tie_slots - 1) LIMIT 1;
  WITH counts AS (
    SELECT key AS candidate_id, value::TEXT::INT AS star_count FROM JSONB_EACH(v_counts)
  )
  SELECT
    COALESCE(ARRAY_AGG(candidate_id ORDER BY candidate_id) FILTER (WHERE star_count > v_boundary_score), ARRAY[]::TEXT[]),
    COALESCE(ARRAY_AGG(candidate_id ORDER BY candidate_id) FILTER (WHERE star_count = v_boundary_score), ARRAY[]::TEXT[])
  INTO v_current_guaranteed, v_boundary_ids FROM counts;
  v_all_guaranteed := v_cycle.guaranteed_winner_idea_ids || v_current_guaranteed;
  v_remaining_slots := v_cycle.tie_slots - CARDINALITY(v_current_guaranteed);

  IF CARDINALITY(v_boundary_ids) > v_remaining_slots THEN
    UPDATE public.final_vote_cycles SET
      status = 'CONSENT', guaranteed_winner_idea_ids = v_all_guaranteed,
      tie_candidate_idea_ids = v_boundary_ids, tie_slots = v_remaining_slots,
      result_snapshot = jsonb_build_object('voteCounts', v_counts, 'boundaryScore', v_boundary_score)
    WHERE id = p_cycle_id;
    UPDATE public.rooms SET
      status = 'ELIMINATION', final_vote_status = 'CONSENT_PENDING',
      tie_candidate_idea_ids = v_boundary_ids, tie_slots = v_remaining_slots
    WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'status', 'CONSENT', 'currentCycleId', p_cycle_id,
      'submittedCount', v_submitted, 'expectedCount', v_expected,
      'guaranteedWinnerIdeaIds', v_all_guaranteed,
      'tieCandidateIdeaIds', v_boundary_ids, 'tieSlots', v_remaining_slots,
      'voteCounts', v_counts
    );
  END IF;

  v_winner_ids := v_all_guaranteed || v_boundary_ids[1:v_remaining_slots];
  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(v_winner_ids) THEN 'WINNER' ELSE 'ELIMINATED' END,
    winner_selection_method = CASE WHEN id = ANY(v_winner_ids) THEN 'CUMULATIVE_STAR' ELSE NULL END
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  UPDATE public.final_vote_cycles SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = jsonb_build_object('winnerIdeaIds', v_winner_ids, 'voteCounts', v_counts)
  WHERE id = p_cycle_id;
  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = COALESCE(result_snapshot, '{}'::JSONB) || jsonb_build_object(
      'winnerIdeaIds', v_winner_ids, 'voteCounts', v_counts, 'selectionMethod', 'CUMULATIVE_STAR'
    )
  WHERE id = v_cycle.decision_round_id AND room_id = p_room_id;
  UPDATE public.rooms SET
    status = 'CLOSED', final_vote_status = 'FINALIZED',
    tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object(
    'status', 'COMPLETED', 'finalized', TRUE, 'currentCycleId', p_cycle_id,
    'winnerIdeaIds', v_winner_ids, 'voteCounts', v_counts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_cumulative_star_ballot_v7(
  p_room_id TEXT, p_cycle_id TEXT, p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_cycle public.final_vote_cycles%ROWTYPE;
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'VOTING' THEN RAISE EXCEPTION '집계 전 투표만 수정할 수 있습니다.'; END IF;
  DELETE FROM public.final_vote_ballots
  WHERE cycle_id = p_cycle_id AND room_id = p_room_id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', TRUE, 'status', 'VOTING');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_final_roulette_consent_v7(
  p_room_id TEXT, p_cycle_id TEXT, p_user_id TEXT, p_consent BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_expected INT;
  v_consented INT;
  v_next_id TEXT;
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'CONSENT' THEN RAISE EXCEPTION '현재 롤렛 동의 단계가 아닙니다.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.room_phase_participants
    WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION '최종 투표 참여자가 아닙니다.'; END IF;
  INSERT INTO public.final_roulette_consents(cycle_id, room_id, user_id, consent, responded_at)
  VALUES (p_cycle_id, p_room_id, p_user_id, p_consent, NOW())
  ON CONFLICT (cycle_id, user_id) DO UPDATE SET consent = EXCLUDED.consent, responded_at = EXCLUDED.responded_at;

  IF NOT p_consent THEN
    v_next_id := 'final-vote-cycle-' || gen_random_uuid()::TEXT;
    UPDATE public.final_vote_cycles SET status = 'COMPLETED', completed_at = NOW(),
      result_snapshot = result_snapshot || jsonb_build_object('rouletteDeclined', TRUE, 'declinedBy', p_user_id)
    WHERE id = p_cycle_id;
    INSERT INTO public.final_vote_cycles(
      id, room_id, decision_round_id, cycle_number, cycle_kind,
      candidate_idea_ids, guaranteed_winner_idea_ids, tie_candidate_idea_ids,
      tie_slots, status, result_snapshot
    ) VALUES (
      v_next_id, p_room_id, v_cycle.decision_round_id, v_cycle.cycle_number + 1, 'TIE_REVOTE',
      v_cycle.tie_candidate_idea_ids, v_cycle.guaranteed_winner_idea_ids, ARRAY[]::TEXT[],
      v_cycle.tie_slots, 'VOTING', '{}'::JSONB
    );
    UPDATE public.rooms SET
      status = 'ELIMINATION', final_vote_status = 'VOTING', current_final_vote_cycle_id = v_next_id,
      tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
    WHERE id = p_room_id;
    RETURN jsonb_build_object('status', 'VOTING', 'currentCycleId', v_next_id, 'tieRevoteCreated', TRUE);
  END IF;

  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  SELECT COUNT(*) INTO v_consented FROM public.final_roulette_consents
  WHERE cycle_id = p_cycle_id AND consent = TRUE;
  IF v_consented >= v_expected THEN
    UPDATE public.final_vote_cycles SET status = 'ROULETTE' WHERE id = p_cycle_id;
    UPDATE public.rooms SET final_vote_status = 'ROULETTE_PENDING' WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'status', 'ROULETTE', 'currentCycleId', p_cycle_id,
      'tieCandidateIdeaIds', v_cycle.tie_candidate_idea_ids, 'tieSlots', v_cycle.tie_slots,
      'consentedCount', v_consented, 'expectedCount', v_expected
    );
  END IF;
  RETURN jsonb_build_object(
    'status', 'CONSENT', 'currentCycleId', p_cycle_id,
    'tieCandidateIdeaIds', v_cycle.tie_candidate_idea_ids, 'tieSlots', v_cycle.tie_slots,
    'consentedCount', v_consented, 'expectedCount', v_expected
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_final_roulette_draw_v7(
  p_room_id TEXT,
  p_cycle_id TEXT,
  p_draw_number INT,
  p_candidate_idea_ids TEXT[],
  p_selected_idea_id TEXT,
  p_drawn_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_existing public.final_roulette_draws%ROWTYPE;
  v_draw_count INT;
  v_expected_draw_number INT;
  v_remaining_ids TEXT[];
  v_roulette_winners TEXT[];
  v_winner_ids TEXT[];
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '최종 투표 회차를 찾을 수 없습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id AND host_id = p_drawn_by) THEN
    RAISE EXCEPTION '방장만 롤렛을 돌릴 수 있습니다.';
  END IF;
  SELECT * INTO v_existing FROM public.final_roulette_draws
  WHERE cycle_id = p_cycle_id AND draw_number = p_draw_number;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_cycle.status = 'COMPLETED' THEN 'COMPLETED' ELSE 'ROULETTE' END,
      'finalized', v_cycle.status = 'COMPLETED',
      'currentCycleId', p_cycle_id,
      'selectedIdeaId', v_existing.selected_idea_id, 'drawNumber', v_existing.draw_number,
      'winnerIdeaIds', COALESCE(v_cycle.result_snapshot->'winnerIdeaIds', '[]'::JSONB),
      'rouletteWinnerIdeaIds', COALESCE(v_cycle.result_snapshot->'rouletteWinnerIdeaIds', '[]'::JSONB),
      'alreadyDrawn', TRUE
    );
  END IF;
  IF v_cycle.status <> 'ROULETTE' THEN RAISE EXCEPTION '현재 롤렛 추첨 단계가 아닙니다.'; END IF;
  SELECT COUNT(*) INTO v_draw_count FROM public.final_roulette_draws WHERE cycle_id = p_cycle_id;
  v_expected_draw_number := v_draw_count + 1;
  IF p_draw_number <> v_expected_draw_number OR p_draw_number > v_cycle.tie_slots THEN
    RAISE EXCEPTION '현재 롤렛 추첨 순서와 일치하지 않습니다.';
  END IF;
  v_remaining_ids := ARRAY(
    SELECT item FROM UNNEST(v_cycle.tie_candidate_idea_ids) item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.final_roulette_draws draw
      WHERE draw.cycle_id = p_cycle_id AND draw.selected_idea_id = item
    ) ORDER BY item
  );
  IF NOT p_selected_idea_id = ANY(v_remaining_ids)
     OR CARDINALITY(p_candidate_idea_ids) <> CARDINALITY(v_remaining_ids)
     OR NOT (p_candidate_idea_ids @> v_remaining_ids AND v_remaining_ids @> p_candidate_idea_ids) THEN
    RAISE EXCEPTION '롤렛 후보 목록 또는 선택 결과가 저장 상태와 일치하지 않습니다.';
  END IF;
  INSERT INTO public.final_roulette_draws(
    cycle_id, room_id, draw_number, candidate_idea_ids, selected_idea_id, drawn_by, drawn_at
  ) VALUES (p_cycle_id, p_room_id, p_draw_number, p_candidate_idea_ids, p_selected_idea_id, p_drawn_by, v_now);

  SELECT COUNT(*) INTO v_draw_count FROM public.final_roulette_draws WHERE cycle_id = p_cycle_id;
  IF v_draw_count < v_cycle.tie_slots THEN
    RETURN jsonb_build_object(
      'status', 'ROULETTE', 'currentCycleId', p_cycle_id,
      'selectedIdeaId', p_selected_idea_id, 'drawNumber', p_draw_number,
      'remainingDrawCount', v_cycle.tie_slots - v_draw_count,
      'tieCandidateIdeaIds', v_cycle.tie_candidate_idea_ids, 'tieSlots', v_cycle.tie_slots
    );
  END IF;

  SELECT ARRAY_AGG(selected_idea_id ORDER BY draw_number)
  INTO v_roulette_winners FROM public.final_roulette_draws WHERE cycle_id = p_cycle_id;
  v_winner_ids := v_cycle.guaranteed_winner_idea_ids || v_roulette_winners;
  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(v_winner_ids) THEN 'WINNER' ELSE 'ELIMINATED' END,
    winner_selection_method = CASE
      WHEN id = ANY(v_roulette_winners) THEN 'ROULETTE'
      WHEN id = ANY(v_cycle.guaranteed_winner_idea_ids) THEN 'CUMULATIVE_STAR'
      ELSE NULL END
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  UPDATE public.final_vote_cycles SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = result_snapshot || jsonb_build_object(
      'winnerIdeaIds', v_winner_ids, 'rouletteWinnerIdeaIds', v_roulette_winners
    )
  WHERE id = p_cycle_id;
  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = COALESCE(result_snapshot, '{}'::JSONB) || jsonb_build_object(
      'winnerIdeaIds', v_winner_ids, 'rouletteWinnerIdeaIds', v_roulette_winners
    )
  WHERE id = v_cycle.decision_round_id AND room_id = p_room_id;
  UPDATE public.rooms SET
    status = 'CLOSED', final_vote_status = 'FINALIZED',
    tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object(
    'status', 'COMPLETED', 'finalized', TRUE, 'currentCycleId', p_cycle_id,
    'selectedIdeaId', p_selected_idea_id, 'drawNumber', p_draw_number,
    'winnerIdeaIds', v_winner_ids, 'rouletteWinnerIdeaIds', v_roulette_winners,
    'remainingDrawCount', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_score_round_result_v7(TEXT, TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_cumulative_star_ballot_v7(TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_cumulative_star_ballot_v7(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_final_roulette_consent_v7(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_final_roulette_draw_v7(TEXT, TEXT, INT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_score_round_result_v7(TEXT, TEXT, TEXT[], TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_cumulative_star_ballot_v7(TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_cumulative_star_ballot_v7(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_final_roulette_consent_v7(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_final_roulette_draw_v7(TEXT, TEXT, INT, TEXT[], TEXT, TEXT) TO service_role;

COMMIT;

-- 적용 후 확인: 모두 0이어야 한다.
SELECT 'invalid_v7_score_rounds' AS check_name, COUNT(*) AS issue_count
FROM public.evaluation_rounds
WHERE evaluation_method = 'SCORE_ONLY' AND stage <> 'EVALUATION'
UNION ALL
SELECT 'invalid_final_vote_ballots', COUNT(*)
FROM public.final_vote_ballots WHERE CARDINALITY(selected_idea_ids) <> 3
UNION ALL
SELECT 'duplicate_final_vote_cycles', COUNT(*)
FROM (
  SELECT room_id, decision_round_id, cycle_number
  FROM public.final_vote_cycles
  GROUP BY room_id, decision_round_id, cycle_number HAVING COUNT(*) > 1
) duplicate_cycles;

-- =============================================================================
-- V8 POLICY STABILITY
-- =============================================================================

-- =============================================================================
-- WhyNot V8: 인증/아이디어/점수 회차 원자성 및 1차 40% 동점 전원 진출
--
-- 적용 원칙
--   1. 완료된 과거 회차의 result_snapshot은 변경하지 않는다.
--   2. 새로 집계되는 1차 회차는 목표 수 보정 후 상위 40% 경계 동점을 모두 진출시킨다.
--   3. 1차에는 최대 8개 제한과 AI 경계 판정을 사용하지 않는다.
--   4. 2차는 최대 4개 및 4위 경계 AI 판정을 그대로 유지한다.
--   5. 회원가입, 아이디어 변경, 평가 수정 전환을 각각 DB 트랜잭션 안에서 처리한다.
-- =============================================================================

BEGIN;

ALTER TABLE public.rooms
  ALTER COLUMN engine_version SET DEFAULT 8;

UPDATE public.rooms
SET engine_version = GREATEST(COALESCE(engine_version, 1), 8)
WHERE COALESCE(decision_mode, 'STRUCTURED') = 'STRUCTURED'
  AND status <> 'CLOSED';

-- 적용 순간 집계 중이던 1차 회차만 계산 스냅샷을 비운다.
-- 제출된 점수/피드백과 완료된 과거 회차 결과는 그대로 보존한다.
UPDATE public.evaluation_rounds
SET aggregation_status = 'NOT_STARTED', result_snapshot = '{}'::JSONB
WHERE status = 'ACTIVE'
  AND evaluation_method = 'SCORE_FEEDBACK'
  AND (
    aggregation_status <> 'NOT_STARTED'
    OR result_snapshot <> '{}'::JSONB
  );

-- 2차 SCORE_ONLY 회차는 1차 SCORE_FEEDBACK 회차를 부모로 가질 수 있다.
-- 기존 보완(REFINEMENT) 회차의 제약은 그대로 유지한다.
CREATE OR REPLACE FUNCTION public.guard_refinement_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_version INT;
  v_parent_kind TEXT;
  v_parent_method TEXT;
BEGIN
  IF NEW.round_kind = 'REFINEMENT' THEN
    IF NEW.parent_round_id IS NULL THEN
      RAISE EXCEPTION 'REFINEMENT round requires parent_round_id';
    END IF;

    SELECT criteria_set_version, round_kind, evaluation_method
    INTO v_parent_version, v_parent_kind, v_parent_method
    FROM public.evaluation_rounds
    WHERE id = NEW.parent_round_id AND room_id = NEW.room_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Parent round does not exist in the same room'; END IF;
    IF v_parent_kind <> 'INITIAL' THEN
      RAISE EXCEPTION 'A refinement round can only follow an initial round';
    END IF;
    IF NEW.criteria_set_version <> v_parent_version THEN
      RAISE EXCEPTION 'Refinement must reuse the parent criteria set version';
    END IF;
  ELSIF NEW.parent_round_id IS NOT NULL THEN
    IF NEW.evaluation_method <> 'SCORE_ONLY' THEN
      RAISE EXCEPTION 'Only SCORE_ONLY initial rounds may reference a parent round';
    END IF;

    SELECT criteria_set_version, round_kind, evaluation_method
    INTO v_parent_version, v_parent_kind, v_parent_method
    FROM public.evaluation_rounds
    WHERE id = NEW.parent_round_id AND room_id = NEW.room_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Parent score round does not exist in the same room'; END IF;
    IF v_parent_kind <> 'INITIAL' OR v_parent_method <> 'SCORE_FEEDBACK' THEN
      RAISE EXCEPTION 'SCORE_ONLY round requires a SCORE_FEEDBACK parent';
    END IF;
    IF NEW.criteria_set_version <> v_parent_version THEN
      RAISE EXCEPTION 'Second score round must reuse the parent criteria set version';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 동일한 1차 회차에서 2차 회차가 중복 생성되는 것을 DB가 차단한다.
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_rounds_one_score_only_child_idx
  ON public.evaluation_rounds(room_id, parent_round_id)
  WHERE evaluation_method = 'SCORE_ONLY' AND parent_round_id IS NOT NULL;

-- 회원 계정, 가입 감사 행, 최초 세션을 한 트랜잭션으로 생성한다.
CREATE OR REPLACE FUNCTION public.create_user_account_with_session_v8(
  p_user_id UUID,
  p_login_id TEXT,
  p_password_hash TEXT,
  p_nickname TEXT,
  p_recovery_code_hash TEXT,
  p_session_token_hash TEXT,
  p_session_expires_at TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_accounts(
    id, login_id, password_hash, nickname, recovery_code_hash,
    created_at, updated_at, status, failed_recovery_attempts
  ) VALUES (
    p_user_id, p_login_id, p_password_hash, p_nickname, p_recovery_code_hash,
    p_created_at, p_created_at, 'ACTIVE', 0
  );

  INSERT INTO public.user_registrations(
    user_id, login_id, nickname, registration_status, registered_at
  ) VALUES (
    p_user_id, p_login_id, p_nickname, 'COMPLETED', p_created_at
  );

  INSERT INTO public.user_sessions(token_hash, user_id, expires_at, created_at)
  VALUES (p_session_token_hash, p_user_id, p_session_expires_at, p_created_at);

  RETURN jsonb_build_object('ok', TRUE, 'userId', p_user_id, 'loginId', p_login_id);
END;
$$;

-- 아이디어 등록/수정/삭제와 1단계 완료 취소를 같은 트랜잭션으로 묶는다.
CREATE OR REPLACE FUNCTION public.create_idea_v8(
  p_room_id TEXT,
  p_idea_id TEXT,
  p_user_id TEXT,
  p_title TEXT,
  p_description TEXT,
  p_submitter_name TEXT,
  p_attachment_url TEXT,
  p_pdf_attachment_url TEXT,
  p_tags TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_status TEXT;
  v_idea_count INT;
  v_idea public.ideas%ROWTYPE;
BEGIN
  SELECT status INTO v_room_status
  FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF v_room_status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '현재 아이디어 등록 단계가 아닙니다.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.participants WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '회의 참여자만 아이디어를 등록할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_idea_count
  FROM public.ideas WHERE room_id = p_room_id AND submitter_id = p_user_id;
  IF v_idea_count >= 3 THEN
    RAISE EXCEPTION '아이디어는 참여자당 최대 3개까지 등록할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ideas(
    id, room_id, title, description, submitter_id, submitter_name,
    attachment_url, pdf_attachment_url, tags, status
  ) VALUES (
    p_idea_id, p_room_id, p_title, p_description, p_user_id, p_submitter_name,
    p_attachment_url, p_pdf_attachment_url, COALESCE(p_tags, ARRAY[]::TEXT[]), 'ACTIVE'
  ) RETURNING * INTO v_idea;

  DELETE FROM public.phase_completions
  WHERE room_id = p_room_id AND phase = 'IDEA_SUBMISSION' AND user_id = p_user_id;

  RETURN to_jsonb(v_idea);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_idea_v8(
  p_room_id TEXT,
  p_idea_id TEXT,
  p_user_id TEXT,
  p_title TEXT,
  p_description TEXT,
  p_attachment_url TEXT,
  p_pdf_attachment_url TEXT,
  p_tags TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_status TEXT;
  v_owner_id TEXT;
  v_idea public.ideas%ROWTYPE;
BEGIN
  SELECT status INTO v_room_status
  FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF v_room_status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '아이디어 제출 단계에서만 수정할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT submitter_id INTO v_owner_id
  FROM public.ideas WHERE id = p_idea_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '아이디어를 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_owner_id <> p_user_id THEN
    RAISE EXCEPTION '작성자 본인만 수정할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ideas SET
    title = p_title,
    description = p_description,
    attachment_url = p_attachment_url,
    pdf_attachment_url = p_pdf_attachment_url,
    tags = COALESCE(p_tags, ARRAY[]::TEXT[])
  WHERE id = p_idea_id AND room_id = p_room_id
  RETURNING * INTO v_idea;

  DELETE FROM public.phase_completions
  WHERE room_id = p_room_id AND phase = 'IDEA_SUBMISSION' AND user_id = p_user_id;

  RETURN to_jsonb(v_idea);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_idea_v8(
  p_room_id TEXT,
  p_idea_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_status TEXT;
  v_owner_id TEXT;
BEGIN
  SELECT status INTO v_room_status
  FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF v_room_status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '아이디어 제출 단계에서만 삭제할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT submitter_id INTO v_owner_id
  FROM public.ideas WHERE id = p_idea_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '아이디어를 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_owner_id <> p_user_id THEN
    RAISE EXCEPTION '작성자 본인만 삭제할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.ideas WHERE id = p_idea_id AND room_id = p_room_id;
  DELETE FROM public.phase_completions
  WHERE room_id = p_room_id AND phase = 'IDEA_SUBMISSION' AND user_id = p_user_id;

  RETURN jsonb_build_object('success', TRUE, 'deletedId', p_idea_id);
END;
$$;

-- 초대 참가와 1단계 종료도 같은 rooms 행을 잠가, 마감 직전 참가/수정 경합을 차단한다.
CREATE OR REPLACE FUNCTION public.join_room_v8(
  p_room_id TEXT,
  p_user_id TEXT,
  p_nickname TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_already_member BOOLEAN;
  v_participant_count INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.status = 'CLOSED' THEN
    RAISE EXCEPTION '이미 종료된 회의실입니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.participants WHERE room_id = p_room_id AND user_id = p_user_id
  ) INTO v_already_member;
  IF NOT v_already_member AND v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '새 참여자는 아이디어 등록 단계에서만 참가할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_participant_count
  FROM public.participants WHERE room_id = p_room_id;
  IF NOT v_already_member AND v_participant_count >= GREATEST(1, COALESCE(v_room.max_participants, 6)) THEN
    RAISE EXCEPTION '최대 참가 가능 인원이 찼습니다.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.participants(room_id, user_id, nickname)
  VALUES (p_room_id, p_user_id, p_nickname)
  ON CONFLICT (room_id, user_id) DO UPDATE SET nickname = EXCLUDED.nickname;

  RETURN jsonb_build_object('success', TRUE, 'alreadyMember', v_already_member);
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_idea_submission_v8(
  p_room_id TEXT,
  p_host_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_participant_count INT;
  v_missing_completion_count INT;
  v_missing_idea_count INT;
  v_active_idea_count INT;
  v_phase TEXT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 방 단계를 변경할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '현재 아이디어 등록 단계를 종료할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_participant_count
  FROM public.participants WHERE room_id = p_room_id;
  IF v_participant_count < 2 THEN
    RAISE EXCEPTION '종합점수 평가는 서로 다른 참여자 2명 이상이 필요합니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_missing_completion_count
  FROM public.participants participant
  WHERE participant.room_id = p_room_id
    AND NOT EXISTS (
      SELECT 1 FROM public.phase_completions completion
      WHERE completion.room_id = p_room_id
        AND completion.phase = 'IDEA_SUBMISSION'
        AND completion.user_id = participant.user_id
    );
  IF v_missing_completion_count > 0 THEN
    RAISE EXCEPTION '모든 참여자가 아이디어 등록 완료를 눌러야 다음 단계로 이동할 수 있습니다. (%명 미완료)', v_missing_completion_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_missing_idea_count
  FROM public.participants participant
  WHERE participant.room_id = p_room_id
    AND NOT EXISTS (
      SELECT 1 FROM public.ideas idea
      WHERE idea.room_id = p_room_id AND idea.submitter_id = participant.user_id
        AND idea.status = 'ACTIVE'
    );
  IF v_missing_idea_count > 0 THEN
    RAISE EXCEPTION '모든 참여자가 아이디어를 한 개 이상 등록해야 다음 단계로 이동할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_active_idea_count
  FROM public.ideas WHERE room_id = p_room_id AND status = 'ACTIVE';
  IF v_active_idea_count <= GREATEST(1, COALESCE(v_room.target_winner_count, 1)) THEN
    RAISE EXCEPTION '최종 선정 수보다 전체 아이디어가 최소 한 개 더 필요합니다.' USING ERRCODE = 'P0001';
  END IF;

  v_phase := 'CRITERIA_PROPOSAL:v' || GREATEST(1, COALESCE(v_room.criteria_set_version, 1));
  INSERT INTO public.room_phase_participants(room_id, phase, user_id)
  SELECT p_room_id, v_phase, participant.user_id
  FROM public.participants participant
  WHERE participant.room_id = p_room_id
  ON CONFLICT (room_id, phase, user_id) DO NOTHING;

  UPDATE public.rooms SET status = 'CRITERIA_PROPOSAL' WHERE id = p_room_id;
  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'CRITERIA_PROPOSAL',
    'participantCount', v_participant_count,
    'activeIdeaCount', v_active_idea_count,
    'phase', v_phase
  );
END;
$$;

-- 평가 수정 시작/취소와 집계 시작은 동일한 회차 행 잠금으로 직렬화한다.
CREATE OR REPLACE FUNCTION public.set_score_reedit_state_v8(
  p_room_id TEXT,
  p_round_id TEXT,
  p_user_id TEXT,
  p_is_reediting BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_updated_count INT;
BEGIN
  SELECT * INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND OR v_round.status <> 'ACTIVE'
     OR v_round.stage <> 'EVALUATION'
     OR v_round.evaluation_method NOT IN ('SCORE_FEEDBACK', 'SCORE_ONLY') THEN
    RAISE EXCEPTION '현재 수정할 수 있는 점수 평가 회차가 아닙니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_round.aggregation_status <> 'NOT_STARTED' THEN
    RAISE EXCEPTION '점수 집계가 시작되어 평가를 수정할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  IF p_is_reediting THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.evaluations
      WHERE room_id = p_room_id AND round_id = p_round_id AND evaluator_id = p_user_id
        AND overall_score BETWEEN 1 AND 10
    ) THEN
      RAISE EXCEPTION '먼저 현재 회차 평가를 제출해 주세요.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.evaluation_round_participants
    SET submission_status = 'DRAFT', finalized_at = NULL
    WHERE room_id = p_room_id AND round_id = p_round_id AND user_id = p_user_id
      AND is_required = TRUE AND submission_status = 'FINAL';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION '평가 완료 상태를 수정 대기로 전환할 수 없습니다.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.phase_completions(room_id, phase, user_id, completed_at)
    VALUES (p_room_id, 'EVALUATION_REEDIT:' || p_round_id, p_user_id, NOW())
    ON CONFLICT (room_id, phase, user_id)
    DO UPDATE SET completed_at = EXCLUDED.completed_at;
  ELSE
    UPDATE public.evaluation_round_participants
    SET submission_status = 'FINAL', finalized_at = NOW()
    WHERE room_id = p_room_id AND round_id = p_round_id AND user_id = p_user_id
      AND is_required = TRUE AND submission_status = 'DRAFT';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION '기존 평가 완료 상태를 복원할 수 없습니다.' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.phase_completions
    WHERE room_id = p_room_id AND phase = 'EVALUATION_REEDIT:' || p_round_id
      AND user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'isReEditing', p_is_reediting);
END;
$$;

-- 점수 합계 외의 중간값/편차/구간 비율/가중치/보정점수는 계산하지 않는다.
CREATE OR REPLACE FUNCTION public.finalize_score_evaluation_round(
  p_room_id TEXT,
  p_round_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_target_winner_count INT;
  v_required_count INT;
  v_candidate_count INT;
  v_missing_count INT;
  v_desired_count INT;
  v_max_count INT;
  v_base_cutoff BIGINT;
  v_boundary_score BIGINT;
  v_remaining_slots INT := 0;
  v_ai_required BOOLEAN := FALSE;
  v_candidate_ids TEXT[] := ARRAY[]::TEXT[];
  v_base_ids TEXT[] := ARRAY[]::TEXT[];
  v_guaranteed_ids TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_server_selected_ids TEXT[] := ARRAY[]::TEXT[];
  v_score_stats JSONB := '{}'::JSONB;
  v_snapshot JSONB;
BEGIN
  SELECT * INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN
    RETURN COALESCE(v_round.result_snapshot, '{}'::JSONB)
      || jsonb_build_object('aggregationStatus', 'COMPLETED', 'alreadyCompleted', TRUE);
  END IF;
  IF v_round.evaluation_method NOT IN ('SCORE_FEEDBACK', 'SCORE_ONLY') OR v_round.stage <> 'EVALUATION' THEN
    RAISE EXCEPTION '지원하는 점수 평가 회차가 아닙니다.';
  END IF;
  IF v_round.aggregation_status = 'PROCESSING'
     AND COALESCE(v_round.result_snapshot->>'aggregationStatus', '') IN ('AWAITING_AI', 'READY_TO_FINALIZE') THEN
    RETURN v_round.result_snapshot;
  END IF;

  SELECT GREATEST(1, COALESCE(target_winner_count, 1))
  INTO v_target_winner_count FROM public.rooms WHERE id = p_room_id;
  SELECT COUNT(*) INTO v_required_count
  FROM public.evaluation_round_participants
  WHERE round_id = p_round_id AND room_id = p_room_id AND is_required = TRUE;
  SELECT COUNT(*) INTO v_candidate_count
  FROM public.round_candidates
  WHERE round_id = p_round_id AND room_id = p_room_id AND outcome = 'ACTIVE';

  IF v_required_count < 2 OR v_candidate_count < 2 THEN
    RAISE EXCEPTION '점수 평가에는 참여자와 후보가 각각 2개 이상 필요합니다.';
  END IF;

  SELECT COUNT(*) INTO v_missing_count
  FROM public.evaluation_round_participants participant
  CROSS JOIN public.round_candidates candidate
  JOIN public.ideas idea ON idea.id = candidate.idea_id AND idea.room_id = candidate.room_id
  WHERE participant.round_id = p_round_id
    AND participant.room_id = p_room_id
    AND participant.is_required = TRUE
    AND participant.submission_status = 'FINAL'
    AND candidate.round_id = p_round_id
    AND candidate.room_id = p_room_id
    AND candidate.outcome = 'ACTIVE'
    AND idea.submitter_id <> participant.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.evaluations evaluation
      WHERE evaluation.round_id = p_round_id
        AND evaluation.room_id = p_room_id
        AND evaluation.evaluator_id = participant.user_id
        AND evaluation.idea_id = candidate.idea_id
        AND evaluation.overall_score BETWEEN 1 AND 10
        AND (
          v_round.evaluation_method = 'SCORE_ONLY'
          OR NULLIF(BTRIM(COALESCE(evaluation.feedback_text, '')), '') IS NOT NULL
        )
    );
  v_missing_count := v_missing_count + (
    SELECT COUNT(*) FROM public.evaluation_round_participants
    WHERE round_id = p_round_id AND room_id = p_room_id
      AND is_required = TRUE AND submission_status <> 'FINAL'
  );
  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object(
      'aggregationStatus', 'WAITING',
      'missingCount', v_missing_count,
      'requiredParticipantCount', v_required_count
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.evaluations evaluation
    JOIN public.ideas idea ON idea.id = evaluation.idea_id AND idea.room_id = evaluation.room_id
    WHERE evaluation.round_id = p_round_id AND evaluation.room_id = p_room_id
      AND evaluation.overall_score IS NOT NULL AND evaluation.evaluator_id = idea.submitter_id
  ) THEN
    RAISE EXCEPTION '본인 아이디어에 대한 점수 행이 포함되어 있습니다.';
  END IF;

  WITH scores AS (
    SELECT candidate.idea_id,
      COALESCE(SUM(evaluation.overall_score), 0)::BIGINT AS total_score,
      COUNT(evaluation.overall_score)::INT AS response_count
    FROM public.round_candidates candidate
    LEFT JOIN public.evaluations evaluation
      ON evaluation.round_id = candidate.round_id
     AND evaluation.room_id = candidate.room_id
     AND evaluation.idea_id = candidate.idea_id
     AND evaluation.overall_score IS NOT NULL
    WHERE candidate.round_id = p_round_id AND candidate.room_id = p_room_id
      AND candidate.outcome = 'ACTIVE'
    GROUP BY candidate.idea_id
  )
  SELECT
    ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id),
    JSONB_OBJECT_AGG(idea_id, jsonb_build_object(
      'totalScore', total_score,
      'responseCount', response_count
    ))
  INTO v_candidate_ids, v_score_stats
  FROM scores;

  IF v_round.evaluation_method = 'SCORE_FEEDBACK' THEN
    v_desired_count := LEAST(
      v_candidate_count,
      GREATEST(CEIL(v_candidate_count * 0.4)::INT, v_target_winner_count + 1)
    );
    v_max_count := v_candidate_count;
  ELSE
    v_desired_count := LEAST(v_candidate_count, 4);
    v_max_count := v_desired_count;
  END IF;

  WITH scores AS (
    SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
    FROM JSONB_EACH(v_score_stats)
  )
  SELECT total_score INTO v_base_cutoff
  FROM scores ORDER BY total_score DESC, idea_id OFFSET v_desired_count - 1 LIMIT 1;

  WITH scores AS (
    SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
    FROM JSONB_EACH(v_score_stats)
  )
  SELECT COALESCE(ARRAY_AGG(idea_id ORDER BY total_score DESC, idea_id), ARRAY[]::TEXT[])
  INTO v_base_ids FROM scores WHERE total_score >= v_base_cutoff;

  IF v_round.evaluation_method = 'SCORE_FEEDBACK' THEN
    -- 1차는 40% 경계 동점을 모두 살린다. 최대 개수와 AI 판정이 없다.
    v_server_selected_ids := v_base_ids;
  ELSIF CARDINALITY(v_base_ids) <= v_max_count THEN
    v_server_selected_ids := v_base_ids;
  ELSE
    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT total_score INTO v_boundary_score
    FROM scores ORDER BY total_score DESC, idea_id OFFSET v_max_count - 1 LIMIT 1;

    WITH scores AS (
      SELECT key AS idea_id, (value->>'totalScore')::BIGINT AS total_score
      FROM JSONB_EACH(v_score_stats)
    )
    SELECT
      COALESCE(ARRAY_AGG(idea_id ORDER BY idea_id) FILTER (WHERE total_score > v_boundary_score), ARRAY[]::TEXT[]),
      COALESCE(ARRAY_AGG(idea_id ORDER BY idea_id) FILTER (WHERE total_score = v_boundary_score), ARRAY[]::TEXT[])
    INTO v_guaranteed_ids, v_boundary_ids FROM scores;
    v_remaining_slots := v_max_count - CARDINALITY(v_guaranteed_ids);
    v_ai_required := CARDINALITY(v_boundary_ids) > v_remaining_slots AND v_remaining_slots > 0;
    IF NOT v_ai_required THEN v_server_selected_ids := v_candidate_ids[1:v_max_count]; END IF;
  END IF;

  v_snapshot := jsonb_build_object(
    'aggregationStatus', CASE WHEN v_ai_required THEN 'AWAITING_AI' ELSE 'READY_TO_FINALIZE' END,
    'evaluationMethod', v_round.evaluation_method,
    'scorePhase', CASE WHEN v_round.evaluation_method = 'SCORE_ONLY' THEN 'SECOND' ELSE 'FIRST' END,
    'requiredParticipantCount', v_required_count,
    'candidateIdeaIds', v_candidate_ids,
    'baseSurvivorCount', v_desired_count,
    'baseCutoffScore', v_base_cutoff,
    'guaranteedSurvivorIdeaIds', v_guaranteed_ids,
    'boundaryScore', v_boundary_score,
    'boundaryTieIdeaIds', v_boundary_ids,
    'remainingSlots', v_remaining_slots,
    'aiTiebreakRequired', v_ai_required,
    'serverSelectedIdeaIds', v_server_selected_ids,
    'maxSurvivorCount', v_max_count,
    'tieExpanded', CARDINALITY(v_base_ids) > v_desired_count,
    'scoreStats', v_score_stats
  );

  UPDATE public.evaluation_rounds
  SET aggregation_status = 'PROCESSING', result_snapshot = v_snapshot
  WHERE id = p_round_id AND room_id = p_room_id;
  RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_score_round_result_v7(
  p_room_id TEXT,
  p_round_id TEXT,
  p_survivor_idea_ids TEXT[],
  p_ai_report_id TEXT DEFAULT NULL,
  p_next_status TEXT DEFAULT 'ELIMINATION'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_snapshot JSONB;
  v_score_stats_with_outcome JSONB;
  v_candidate_ids TEXT[];
  v_expected_survivor_ids TEXT[] := ARRAY[]::TEXT[];
  v_guaranteed_ids TEXT[] := ARRAY[]::TEXT[];
  v_ai_selected_ids TEXT[] := ARRAY[]::TEXT[];
  v_eliminated_ids TEXT[];
  v_ai_result JSONB := jsonb_build_object('used', FALSE);
  v_expected_next_status TEXT;
  v_missing_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_round FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN RETURN v_round.result_snapshot; END IF;

  v_snapshot := COALESCE(v_round.result_snapshot, '{}'::JSONB);
  IF COALESCE(v_snapshot->>'aggregationStatus', '') NOT IN ('READY_TO_FINALIZE', 'AWAITING_AI') THEN
    RAISE EXCEPTION '아직 후보를 확정할 수 있는 집계 상태가 아닙니다.';
  END IF;
  v_candidate_ids := ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(v_snapshot->'candidateIdeaIds'));

  -- 집계 준비 이후 수정 상태가 바뀌지 않았는지 최종 적용 직전에 다시 검증한다.
  SELECT COUNT(*) INTO v_missing_count
  FROM public.evaluation_round_participants participant
  CROSS JOIN public.round_candidates candidate
  JOIN public.ideas idea ON idea.id = candidate.idea_id AND idea.room_id = candidate.room_id
  WHERE participant.round_id = p_round_id
    AND participant.room_id = p_room_id
    AND participant.is_required = TRUE
    AND participant.submission_status = 'FINAL'
    AND candidate.round_id = p_round_id
    AND candidate.room_id = p_room_id
    AND candidate.outcome = 'ACTIVE'
    AND idea.submitter_id <> participant.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.evaluations evaluation
      WHERE evaluation.round_id = p_round_id
        AND evaluation.room_id = p_room_id
        AND evaluation.evaluator_id = participant.user_id
        AND evaluation.idea_id = candidate.idea_id
        AND evaluation.overall_score BETWEEN 1 AND 10
        AND (
          v_round.evaluation_method = 'SCORE_ONLY'
          OR NULLIF(BTRIM(COALESCE(evaluation.feedback_text, '')), '') IS NOT NULL
        )
    );
  v_missing_count := v_missing_count + (
    SELECT COUNT(*) FROM public.evaluation_round_participants
    WHERE round_id = p_round_id AND room_id = p_room_id
      AND is_required = TRUE AND submission_status <> 'FINAL'
  );
  IF v_missing_count > 0 THEN RAISE EXCEPTION '모든 필수 평가가 FINAL 상태가 아닙니다.'; END IF;

  IF COALESCE((v_snapshot->>'aiTiebreakRequired')::BOOLEAN, FALSE) THEN
    SELECT result_snapshot INTO v_ai_result FROM public.ai_reports
    WHERE id = p_ai_report_id AND room_id = p_room_id AND round_id = p_round_id
      AND report_type = 'AI_BOUNDARY_TIEBREAK';
    IF v_ai_result IS NULL THEN RAISE EXCEPTION '저장된 AI 경계 판정이 필요합니다.'; END IF;
    v_guaranteed_ids := ARRAY(
      SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_snapshot->'guaranteedSurvivorIdeaIds', '[]'::JSONB))
    );
    v_ai_selected_ids := ARRAY(
      SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_ai_result->'selectedIdeaIds', '[]'::JSONB))
    );
    v_expected_survivor_ids := v_guaranteed_ids || v_ai_selected_ids;
  ELSE
    v_expected_survivor_ids := ARRAY(
      SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_snapshot->'serverSelectedIdeaIds', '[]'::JSONB))
    );
  END IF;

  IF CARDINALITY(p_survivor_idea_ids) <> CARDINALITY(v_expected_survivor_ids)
     OR EXISTS (
       SELECT 1 FROM UNNEST(p_survivor_idea_ids) item
       WHERE NOT item = ANY(v_expected_survivor_ids)
     )
     OR CARDINALITY(p_survivor_idea_ids) <> (
       SELECT COUNT(DISTINCT item) FROM UNNEST(p_survivor_idea_ids) item
     ) THEN
    RAISE EXCEPTION '진출 후보 목록이 서버 집계 결과와 일치하지 않습니다.';
  END IF;

  v_expected_next_status := CASE
    WHEN v_round.evaluation_method = 'SCORE_FEEDBACK' AND CARDINALITY(p_survivor_idea_ids) > 4
      THEN 'EVALUATION_ROUND_2'
    ELSE 'ELIMINATION'
  END;
  IF p_next_status <> v_expected_next_status THEN
    RAISE EXCEPTION '다음 단계가 진출 후보 수 정책과 일치하지 않습니다.';
  END IF;

  v_eliminated_ids := ARRAY(
    SELECT item FROM UNNEST(v_candidate_ids) item WHERE NOT item = ANY(p_survivor_idea_ids)
  );

  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
    eliminated_round = CASE WHEN id = ANY(v_eliminated_ids) THEN v_round.round_number ELSE NULL END
  WHERE room_id = p_room_id AND id = ANY(v_candidate_ids);

  UPDATE public.round_candidates SET
    outcome = CASE WHEN idea_id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
  WHERE room_id = p_room_id AND round_id = p_round_id;

  SELECT JSONB_OBJECT_AGG(
    entry.key,
    entry.value || jsonb_build_object('survived', entry.key = ANY(p_survivor_idea_ids))
  ) INTO v_score_stats_with_outcome
  FROM JSONB_EACH(COALESCE(v_snapshot->'scoreStats', '{}'::JSONB)) entry;

  v_snapshot := v_snapshot || jsonb_build_object(
    'aggregationStatus', 'COMPLETED',
    'survivorIdeaIds', p_survivor_idea_ids,
    'eliminatedIdeaIds', v_eliminated_ids,
    'actualSurvivorCount', CARDINALITY(p_survivor_idea_ids),
    'aiTiebreak', v_ai_result,
    'scoreStats', COALESCE(v_score_stats_with_outcome, '{}'::JSONB),
    'completedAt', v_now
  );

  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED', aggregation_status = 'COMPLETED', completed_at = v_now,
    result_snapshot = v_snapshot, results_revealed_at = COALESCE(results_revealed_at, v_now),
    locked_at = COALESCE(locked_at, v_now)
  WHERE id = p_round_id AND room_id = p_room_id;

  UPDATE public.rooms SET
    status = p_next_status, final_vote_status = 'NOT_STARTED', current_round_id = NULL,
    tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.create_user_account_with_session_v8(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_idea_v8(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_idea_v8(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_idea_v8(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_room_v8(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_idea_submission_v8(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_score_reedit_state_v8(TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_score_round_result_v7(TEXT, TEXT, TEXT[], TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_user_account_with_session_v8(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_idea_v8(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_idea_v8(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_idea_v8(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_room_v8(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_idea_submission_v8(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_score_reedit_state_v8(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_score_round_result_v7(TEXT, TEXT, TEXT[], TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 실행 후 확인: 모든 값이 0이어야 한다.
SELECT 'invalid_active_first_round_ai' AS check_name, COUNT(*) AS issue_count
FROM public.evaluation_rounds
WHERE status = 'ACTIVE'
  AND evaluation_method = 'SCORE_FEEDBACK'
  AND (
    COALESCE((result_snapshot->>'aiTiebreakRequired')::BOOLEAN, FALSE)
    OR result_snapshot->>'aggregationStatus' = 'AWAITING_AI'
  )
UNION ALL
SELECT 'invalid_active_first_round_cap', COUNT(*)
FROM public.evaluation_rounds
WHERE status = 'ACTIVE'
  AND evaluation_method = 'SCORE_FEEDBACK'
  AND JSONB_TYPEOF(result_snapshot->'candidateIdeaIds') = 'array'
  AND COALESCE((result_snapshot->>'maxSurvivorCount')::INT, -1)
      <> JSONB_ARRAY_LENGTH(result_snapshot->'candidateIdeaIds')
UNION ALL
SELECT 'duplicate_score_only_children', COUNT(*)
FROM (
  SELECT room_id, parent_round_id
  FROM public.evaluation_rounds
  WHERE evaluation_method = 'SCORE_ONLY' AND parent_round_id IS NOT NULL
  GROUP BY room_id, parent_round_id
  HAVING COUNT(*) > 1
) duplicate_rows;

-- =============================================================================
-- WhyNot V9: 계정 초대, 참여자/외부 투표자 분리, 최종 투표 명단 고정,
--             가벼운 상태 동기화를 위한 state_version
--
-- 기존 투표 계산식과 완료된 회차 결과는 변경하지 않는다.
-- =============================================================================

BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS external_voters_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS required_voter_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_vote_roster_locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_required_voter_count_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_required_voter_count_check
  CHECK (required_voter_count BETWEEN 0 AND 30);
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_external_voter_settings_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_external_voter_settings_check CHECK (
  (external_voters_enabled AND required_voter_count BETWEEN 1 AND 30)
  OR (NOT external_voters_enabled AND required_voter_count = 0)
);

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'PARTICIPANT';
UPDATE public.participants SET role = 'PARTICIPANT'
WHERE role IS NULL OR role NOT IN ('PARTICIPANT', 'VOTER');
ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_role_check;
ALTER TABLE public.participants ADD CONSTRAINT participants_role_check
  CHECK (role IN ('PARTICIPANT', 'VOTER'));

ALTER TABLE public.room_invites
  ADD COLUMN IF NOT EXISTS invite_type TEXT NOT NULL DEFAULT 'PARTICIPANT';
ALTER TABLE public.room_invites DROP CONSTRAINT IF EXISTS room_invites_type_check;
ALTER TABLE public.room_invites ADD CONSTRAINT room_invites_type_check
  CHECK (invite_type IN ('PARTICIPANT', 'VOTER'));

-- 이전 버전에서 같은 유형의 활성 링크가 여러 개 생성되었을 수 있다.
-- 가장 최근 링크 하나만 남긴 뒤 유형별 활성 링크를 하나로 제한한다.
WITH ranked_active_invites AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY room_id, invite_type ORDER BY created_at DESC, id DESC
  ) AS row_number
  FROM public.room_invites
  WHERE is_active = TRUE
)
UPDATE public.room_invites target
SET is_active = FALSE
FROM ranked_active_invites ranked
WHERE target.id = ranked.id AND ranked.row_number > 1;
CREATE UNIQUE INDEX IF NOT EXISTS room_invites_one_active_type_idx
  ON public.room_invites(room_id, invite_type)
  WHERE is_active = TRUE;

ALTER TABLE public.room_phase_participants
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'PARTICIPANT';
ALTER TABLE public.room_phase_participants DROP CONSTRAINT IF EXISTS room_phase_participants_role_check;
ALTER TABLE public.room_phase_participants ADD CONSTRAINT room_phase_participants_role_check
  CHECK (role IN ('PARTICIPANT', 'VOTER'));

CREATE TABLE IF NOT EXISTS public.room_account_invites (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  invited_login_id TEXT NOT NULL,
  invited_user_id UUID NOT NULL REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  invite_role TEXT NOT NULL CHECK (invite_role IN ('PARTICIPANT', 'VOTER')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ NULL,
  canceled_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS room_account_invites_one_pending_idx
  ON public.room_account_invites(room_id, invited_login_id, invite_role)
  WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS room_account_invites_one_pending_user_idx
  ON public.room_account_invites(room_id, invited_user_id)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS room_account_invites_user_status_idx
  ON public.room_account_invites(invited_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.room_voter_registrations (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ACCOUNT', 'LINK', 'PARTICIPANT_FALLBACK')),
  status TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'ACTIVE', 'CANCELED')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS room_voter_registrations_room_status_idx
  ON public.room_voter_registrations(room_id, status, registered_at);

ALTER TABLE public.room_account_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_voter_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_account_invites FROM anon, authenticated;
REVOKE ALL ON public.room_voter_registrations FROM anon, authenticated;
GRANT ALL ON public.room_account_invites TO service_role;
GRANT ALL ON public.room_voter_registrations TO service_role;

-- 방과 방장 참여자를 하나의 트랜잭션으로 생성한다.
CREATE OR REPLACE FUNCTION public.create_room_with_host_v9(
  p_room JSONB,
  p_host_user_id TEXT,
  p_host_nickname TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.rooms(
    id, title, description, category, is_public, max_participants,
    target_winner_count, is_pinned, host_id, status, min_response_threshold,
    elimination_config, deadlines, engine_version, decision_mode,
    external_voters_enabled, required_voter_count,
    refinement_enabled, max_refinement_rounds
  ) VALUES (
    p_room->>'id', p_room->>'title', COALESCE(p_room->>'description', ''),
    COALESCE(p_room->>'category', '기획'), FALSE,
    (p_room->>'max_participants')::INT,
    (p_room->>'target_winner_count')::INT, FALSE, p_host_user_id,
    COALESCE(p_room->>'status', 'IDEA_SUBMISSION'),
    (p_room->>'min_response_threshold')::INT,
    COALESCE(p_room->'elimination_config', '{}'::JSONB),
    COALESCE(p_room->'deadlines', '{}'::JSONB),
    (p_room->>'engine_version')::INT,
    COALESCE(p_room->>'decision_mode', 'STRUCTURED'),
    COALESCE((p_room->>'external_voters_enabled')::BOOLEAN, FALSE),
    COALESCE((p_room->>'required_voter_count')::INT, 0),
    COALESCE((p_room->>'refinement_enabled')::BOOLEAN, FALSE),
    COALESCE((p_room->>'max_refinement_rounds')::INT, 0)
  );
  INSERT INTO public.participants(room_id, user_id, nickname, role)
  VALUES (p_room->>'id', p_host_user_id, LEFT(COALESCE(NULLIF(BTRIM(p_host_nickname), ''), '방장'), 6), 'PARTICIPANT');

  IF NULLIF(p_room->>'participant_invite_token_hash', '') IS NOT NULL THEN
    INSERT INTO public.room_invites(
      room_id, invite_token, invite_token_hash, created_by, expires_at, is_active, invite_type
    ) VALUES (
      p_room->>'id', NULL, p_room->>'participant_invite_token_hash', p_host_user_id,
      (p_room->>'participant_invite_expires_at')::TIMESTAMPTZ, TRUE, 'PARTICIPANT'
    );
  END IF;
  IF COALESCE((p_room->>'external_voters_enabled')::BOOLEAN, FALSE)
     AND NULLIF(p_room->>'voter_invite_token_hash', '') IS NOT NULL THEN
    INSERT INTO public.room_invites(
      room_id, invite_token, invite_token_hash, created_by, expires_at, is_active, invite_type
    ) VALUES (
      p_room->>'id', NULL, p_room->>'voter_invite_token_hash', p_host_user_id,
      (p_room->>'voter_invite_expires_at')::TIMESTAMPTZ, TRUE, 'VOTER'
    );
  END IF;
  RETURN jsonb_build_object(
    'success', TRUE,
    'roomId', p_room->>'id',
    'stateVersion', (SELECT state_version::TEXT FROM public.rooms WHERE id = p_room->>'id')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_invite_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_invite_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_invite_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_type TEXT := UPPER(BTRIM(COALESCE(p_invite_type, 'PARTICIPANT')));
  v_id UUID;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 초대 링크를 만들 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_type NOT IN ('PARTICIPANT', 'VOTER') THEN
    RAISE EXCEPTION '지원하지 않는 초대 유형입니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_type = 'PARTICIPANT' AND v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '참여자 링크는 아이디어 등록 단계에서만 만들 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_type = 'VOTER' AND (
    NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1
    OR v_room.final_vote_roster_locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '현재는 외부 투표자 링크를 만들 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at <= NOW() OR NULLIF(BTRIM(p_invite_token_hash), '') IS NULL THEN
    RAISE EXCEPTION '초대 링크 정보가 올바르지 않습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.room_invites SET is_active = FALSE
  WHERE room_id = p_room_id AND invite_type = v_type AND is_active = TRUE;
  INSERT INTO public.room_invites(
    room_id, invite_token, invite_token_hash, created_by, expires_at, is_active, invite_type
  ) VALUES (
    p_room_id, NULL, p_invite_token_hash, p_host_user_id, p_expires_at, TRUE, v_type
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', TRUE, 'id', v_id, 'inviteType', v_type);
END;
$$;

-- 회의실 자체 변경은 상태 버전을 한 번 올린다. 호출자가 이미 더 큰 버전을
-- 지정한 경우에는 그 값을 보존해 자식 트리거와 중복 증가하지 않는다.
CREATE OR REPLACE FUNCTION public.bump_room_row_state_version_v9()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.state_version IS NOT DISTINCT FROM OLD.state_version THEN
    NEW.state_version := OLD.state_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_bump_state_version_v9 ON public.rooms;
CREATE TRIGGER rooms_bump_state_version_v9
BEFORE UPDATE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.bump_room_row_state_version_v9();

CREATE OR REPLACE FUNCTION public.bump_parent_room_state_version_v9()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id TEXT;
BEGIN
  v_room_id := COALESCE(to_jsonb(NEW)->>TG_ARGV[0], to_jsonb(OLD)->>TG_ARGV[0]);
  IF v_room_id IS NOT NULL THEN
    UPDATE public.rooms SET state_version = state_version + 1 WHERE id = v_room_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'participants', 'ideas', 'criteria', 'criterion_proposals',
    'criterion_approvals', 'phase_completions', 'room_phase_participants',
    'evaluations', 'evaluation_rounds', 'evaluation_round_participants',
    'round_candidates', 'decision_votes', 'ai_reports', 'idea_versions',
    'candidate_feedback', 'refinement_cycles', 'refinement_cycle_votes',
    'round_deadline_audit', 'final_vote_cycles',
    'final_vote_ballots', 'final_roulette_consents', 'final_roulette_draws',
    'room_invites', 'room_account_invites', 'room_voter_registrations'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_bump_room_v9', v_table);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.bump_parent_room_state_version_v9(''room_id'')',
        v_table || '_bump_room_v9', v_table
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_account_invite_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_login_id TEXT,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_account public.user_accounts%ROWTYPE;
  v_login_id TEXT := LOWER(BTRIM(p_login_id));
  v_role TEXT := UPPER(BTRIM(p_role));
  v_used INT;
  v_invite public.room_account_invites%ROWTYPE;
BEGIN
  IF v_role NOT IN ('PARTICIPANT', 'VOTER') THEN
    RAISE EXCEPTION '지원하지 않는 초대 역할입니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 계정 초대를 만들 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 초대를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_account FROM public.user_accounts
  WHERE login_id = v_login_id AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION '가입되어 있는 활성 계정을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_account.id::TEXT = v_room.host_id THEN
    RAISE EXCEPTION '방장 계정은 다시 초대할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.room_account_invites
    WHERE room_id = p_room_id AND invited_user_id = v_account.id AND status = 'PENDING'
  ) THEN
    RAISE EXCEPTION '이 계정에는 이미 대기 중인 초대가 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_role = 'PARTICIPANT' THEN
    IF v_room.status <> 'IDEA_SUBMISSION' THEN
      RAISE EXCEPTION '참여자 계정 초대는 아이디어 등록 단계에서만 가능합니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.participants
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT AND role = 'PARTICIPANT') THEN
      RAISE EXCEPTION '이미 이 회의실에 참여 중인 계정입니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.room_voter_registrations
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT
        AND status IN ('WAITING', 'ACTIVE')) THEN
      RAISE EXCEPTION '이미 외부 투표자로 등록된 계정입니다.' USING ERRCODE = 'P0001';
    END IF;
    SELECT
      (SELECT COUNT(*) FROM public.participants
       WHERE room_id = p_room_id AND role = 'PARTICIPANT')
      +
      (SELECT COUNT(*) FROM public.room_account_invites
       WHERE room_id = p_room_id AND invite_role = 'PARTICIPANT' AND status = 'PENDING')
    INTO v_used;
    IF v_used >= v_room.max_participants THEN
      RAISE EXCEPTION '참여자 정원과 예약 좌석이 모두 찼습니다.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1 THEN
      RAISE EXCEPTION '외부 투표자 사용이 활성화되지 않았습니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.participants
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT AND role = 'PARTICIPANT') THEN
      RAISE EXCEPTION '기존 참여자는 외부 투표자로 중복 등록할 수 없습니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.room_voter_registrations
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT
        AND status IN ('WAITING', 'ACTIVE')) THEN
      RAISE EXCEPTION '이미 외부 투표자로 등록된 계정입니다.' USING ERRCODE = 'P0001';
    END IF;
    SELECT
      (SELECT COUNT(*) FROM public.room_voter_registrations
       WHERE room_id = p_room_id AND status IN ('WAITING', 'ACTIVE'))
      +
      (SELECT COUNT(*) FROM public.room_account_invites
       WHERE room_id = p_room_id AND invite_role = 'VOTER' AND status = 'PENDING')
    INTO v_used;
    IF v_used >= v_room.required_voter_count THEN
      RAISE EXCEPTION '설정한 외부 투표자 인원이 모두 예약되었습니다.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.room_account_invites(
    id, room_id, invited_login_id, invited_user_id, invite_role, status, created_by
  ) VALUES (
    'account-invite-' || gen_random_uuid()::TEXT, p_room_id, v_login_id,
    v_account.id, v_role, 'PENDING', p_host_user_id
  ) RETURNING * INTO v_invite;

  RETURN jsonb_build_object(
    'id', v_invite.id, 'roomId', v_invite.room_id,
    'loginId', v_invite.invited_login_id, 'role', v_invite.invite_role,
    'status', v_invite.status, 'createdAt', v_invite.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_room_account_invite_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_invite_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 초대를 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 초대를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.room_account_invites
  SET status = 'CANCELED', canceled_at = NOW()
  WHERE id = p_invite_id AND room_id = p_room_id AND status = 'PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION '취소할 대기 초대를 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('success', TRUE, 'inviteId', p_invite_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_room_account_invites_v9(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_accounts%ROWTYPE;
  v_invite public.room_account_invites%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_participant_count INT;
  v_matched JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_account FROM public.user_accounts
  WHERE id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RETURN v_matched; END IF;

  FOR v_invite IN
    SELECT * FROM public.room_account_invites
    WHERE invited_user_id = p_user_id AND status = 'PENDING'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_room FROM public.rooms WHERE id = v_invite.room_id FOR UPDATE;
    IF NOT FOUND OR v_room.status = 'CLOSED' THEN
      UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
      WHERE id = v_invite.id;
      CONTINUE;
    END IF;

    IF v_invite.invite_role = 'PARTICIPANT' THEN
      IF v_room.status <> 'IDEA_SUBMISSION' THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      SELECT COUNT(*) INTO v_participant_count FROM public.participants
      WHERE room_id = v_room.id AND role = 'PARTICIPANT';
      IF v_participant_count >= v_room.max_participants THEN
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.room_voter_registrations
        WHERE room_id = v_room.id AND user_id = p_user_id::TEXT
          AND status IN ('WAITING', 'ACTIVE')) THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      INSERT INTO public.participants(room_id, user_id, nickname, role)
      VALUES (v_room.id, p_user_id::TEXT, v_account.nickname, 'PARTICIPANT')
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname, role = 'PARTICIPANT';
    ELSE
      IF NOT v_room.external_voters_enabled OR v_room.final_vote_roster_locked_at IS NOT NULL THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.participants
        WHERE room_id = v_room.id AND user_id = p_user_id::TEXT AND role = 'PARTICIPANT') THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      SELECT COUNT(*) INTO v_participant_count FROM public.room_voter_registrations
      WHERE room_id = v_room.id AND status IN ('WAITING', 'ACTIVE')
        AND user_id <> p_user_id::TEXT;
      IF v_participant_count >= v_room.required_voter_count THEN
        CONTINUE;
      END IF;
      INSERT INTO public.room_voter_registrations(room_id, user_id, nickname, source, status)
      VALUES (v_room.id, p_user_id::TEXT, v_account.nickname, 'ACCOUNT', 'WAITING')
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname, source = 'ACCOUNT', status = 'WAITING';
    END IF;

    UPDATE public.room_account_invites
    SET status = 'ACCEPTED', accepted_at = NOW()
    WHERE id = v_invite.id;
    v_matched := v_matched || jsonb_build_array(jsonb_build_object(
      'roomId', v_room.id, 'role', v_invite.invite_role,
      'waiting', v_invite.invite_role = 'VOTER'
    ));
  END LOOP;
  RETURN v_matched;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room_v9(
  p_room_id TEXT,
  p_user_id TEXT,
  p_nickname TEXT,
  p_invite_type TEXT,
  p_allow_voter_fallback BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_role TEXT := UPPER(BTRIM(COALESCE(p_invite_type, 'PARTICIPANT')));
  v_existing_role TEXT;
  v_existing_voter_status TEXT;
  v_participant_count INT;
  v_reserved_count INT;
  v_voter_count INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.status = 'CLOSED' THEN RAISE EXCEPTION '이미 종료된 회의실입니다.' USING ERRCODE = 'P0001'; END IF;

  SELECT role INTO v_existing_role FROM public.participants
  WHERE room_id = p_room_id AND user_id = p_user_id;
  SELECT status INTO v_existing_voter_status FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND user_id = p_user_id
    AND status IN ('WAITING', 'ACTIVE');
  IF v_existing_role = 'PARTICIPANT' THEN
    RETURN jsonb_build_object('success', TRUE, 'alreadyMember', TRUE, 'role', 'PARTICIPANT', 'waiting', FALSE);
  END IF;
  IF v_existing_voter_status IN ('WAITING', 'ACTIVE') THEN
    RETURN jsonb_build_object(
      'success', TRUE, 'alreadyMember', TRUE, 'role', 'VOTER',
      'waiting', v_existing_voter_status = 'WAITING'
    );
  END IF;

  IF v_role = 'PARTICIPANT' THEN
    IF v_room.status <> 'IDEA_SUBMISSION' THEN
      RAISE EXCEPTION '새 참여자는 아이디어 등록 단계에서만 참가할 수 있습니다.' USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_participant_count FROM public.participants
    WHERE room_id = p_room_id AND role = 'PARTICIPANT';
    SELECT COUNT(*) INTO v_reserved_count FROM public.room_account_invites
    WHERE room_id = p_room_id AND invite_role = 'PARTICIPANT' AND status = 'PENDING'
      AND invited_user_id::TEXT <> p_user_id;
    IF v_participant_count + v_reserved_count >= v_room.max_participants THEN
      IF NOT p_allow_voter_fallback OR NOT v_room.external_voters_enabled THEN
        RAISE EXCEPTION 'PARTICIPANT_FULL_VOTER_AVAILABLE' USING ERRCODE = 'P0001';
      END IF;
      v_role := 'VOTER';
    ELSE
      INSERT INTO public.participants(room_id, user_id, nickname, role)
      VALUES (p_room_id, p_user_id, p_nickname, 'PARTICIPANT')
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname, role = 'PARTICIPANT';
      UPDATE public.room_account_invites
      SET status = 'ACCEPTED', accepted_at = NOW()
      WHERE room_id = p_room_id AND invited_user_id::TEXT = p_user_id
        AND invite_role = 'PARTICIPANT' AND status = 'PENDING';
      RETURN jsonb_build_object('success', TRUE, 'alreadyMember', FALSE, 'role', 'PARTICIPANT', 'waiting', FALSE);
    END IF;
  END IF;

  IF v_role <> 'VOTER' THEN
    RAISE EXCEPTION '지원하지 않는 초대 유형입니다.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1 THEN
    RAISE EXCEPTION '외부 투표자 모집이 활성화되지 않았습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 이미 확정되었습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.participants
    WHERE room_id = p_room_id AND user_id = p_user_id AND role = 'PARTICIPANT') THEN
    RAISE EXCEPTION '기존 참여자는 외부 투표자로 중복 등록할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_voter_count FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status IN ('WAITING', 'ACTIVE') AND user_id <> p_user_id;
  SELECT COUNT(*) INTO v_reserved_count FROM public.room_account_invites
  WHERE room_id = p_room_id AND invite_role = 'VOTER' AND status = 'PENDING'
    AND invited_user_id::TEXT <> p_user_id;
  IF v_voter_count + v_reserved_count >= v_room.required_voter_count THEN
    RAISE EXCEPTION '설정한 외부 투표자 인원이 모두 등록되었습니다.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.room_voter_registrations(room_id, user_id, nickname, source, status)
  VALUES (
    p_room_id, p_user_id, p_nickname,
    CASE WHEN p_allow_voter_fallback THEN 'PARTICIPANT_FALLBACK' ELSE 'LINK' END,
    'WAITING'
  ) ON CONFLICT (room_id, user_id) DO UPDATE
  SET nickname = EXCLUDED.nickname, source = EXCLUDED.source, status = 'WAITING';
  UPDATE public.room_account_invites
  SET status = 'ACCEPTED', accepted_at = NOW()
  WHERE room_id = p_room_id AND invited_user_id::TEXT = p_user_id
    AND invite_role = 'VOTER' AND status = 'PENDING';
  RETURN jsonb_build_object('success', TRUE, 'alreadyMember', FALSE, 'role', 'VOTER', 'waiting', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_room_voter_registration_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_voter_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 외부 투표자 등록을 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 외부 투표자를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.room_voter_registrations
  SET status = 'CANCELED', activated_at = NULL
  WHERE room_id = p_room_id AND user_id = p_voter_user_id AND status = 'WAITING';
  IF NOT FOUND THEN
    RAISE EXCEPTION '취소할 대기 외부 투표자를 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'userId', p_voter_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_final_vote_roster_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_phase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_registered INT;
  v_expected INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 최종 투표를 시작할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
    WHERE room_id = p_room_id AND phase = p_phase;
    RETURN jsonb_build_object('success', TRUE, 'alreadyLocked', TRUE, 'expectedCount', v_expected);
  END IF;
  IF v_room.status NOT IN ('IDEA_SUBMISSION', 'ELIMINATION') THEN
    RAISE EXCEPTION '현재 단계에서는 최종 투표를 시작할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_registered FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status = 'WAITING';
  IF v_room.external_voters_enabled AND v_registered <> v_room.required_voter_count THEN
    RAISE EXCEPTION '설정한 외부 투표자 전원이 등록되어야 시작할 수 있습니다. (%/%명)',
      v_registered, v_room.required_voter_count USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_room.external_voters_enabled AND v_registered > 0 THEN
    RAISE EXCEPTION '외부 투표자 설정을 확인해 주세요.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.participants(room_id, user_id, nickname, role)
  SELECT room_id, user_id, nickname, 'VOTER'
  FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status = 'WAITING'
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET nickname = EXCLUDED.nickname, role = 'VOTER';

  UPDATE public.room_voter_registrations
  SET status = 'ACTIVE', activated_at = NOW()
  WHERE room_id = p_room_id AND status = 'WAITING';

  DELETE FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = p_phase;
  INSERT INTO public.room_phase_participants(room_id, phase, user_id, role)
  SELECT p_room_id, p_phase, user_id, 'PARTICIPANT'
  FROM public.participants
  WHERE room_id = p_room_id AND role = 'PARTICIPANT'
  UNION ALL
  SELECT p_room_id, p_phase, user_id, 'VOTER'
  FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status = 'ACTIVE';

  UPDATE public.rooms
  SET final_vote_roster_locked_at = NOW(), final_vote_status = 'VOTING'
  WHERE id = p_room_id;
  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = p_phase;
  RETURN jsonb_build_object('success', TRUE, 'expectedCount', v_expected, 'registeredVoterCount', v_registered);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_incomplete_final_vote_cycle_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_cycle_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_expected INT;
  v_submitted INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 미완료 회차를 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'VOTING' THEN
    RAISE EXCEPTION '취소할 수 있는 진행 중 회차가 아닙니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  SELECT COUNT(*) INTO v_submitted FROM public.final_vote_ballots WHERE cycle_id = p_cycle_id;
  IF v_submitted >= v_expected THEN
    RAISE EXCEPTION '전원 제출이 끝난 회차는 취소할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.final_vote_cycles
  SET status = 'COMPLETED', completed_at = NOW(),
      result_snapshot = COALESCE(result_snapshot, '{}'::JSONB)
        || jsonb_build_object('canceled', TRUE, 'submittedCount', v_submitted, 'expectedCount', v_expected)
  WHERE id = p_cycle_id;
  DELETE FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  -- 과거 투표 용지는 participants(room_id,user_id)를 참조하므로 참여자 행은
  -- 보존한다. 활성 여부는 room_voter_registrations.status로만 판정한다.
  UPDATE public.room_voter_registrations
  SET status = 'WAITING', activated_at = NULL
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  UPDATE public.rooms SET
    current_final_vote_cycle_id = NULL,
    final_vote_status = 'NOT_STARTED',
    final_vote_roster_locked_at = NULL,
    tie_candidate_idea_ids = ARRAY[]::TEXT[],
    tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object('success', TRUE, 'submittedCount', v_submitted, 'expectedCount', v_expected);
END;
$$;

-- 최종 후보와 방 상태를 한 트랜잭션에서 확정한다. 기존 소거 후보는
-- 그대로 보존하고 현재 활성 후보만 최종 선정/소거로 전환한다.
CREATE OR REPLACE FUNCTION public.finalize_room_winners_v9(
  p_room_id TEXT,
  p_winner_idea_ids TEXT[],
  p_selection_methods JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_winner_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE) THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.ideas
  SET
    status = CASE
      WHEN id = ANY(COALESCE(p_winner_idea_ids, ARRAY[]::TEXT[])) THEN 'WINNER'
      WHEN status = 'ACTIVE' THEN 'ELIMINATED'
      ELSE status
    END,
    winner_selection_method = CASE
      WHEN id = ANY(COALESCE(p_winner_idea_ids, ARRAY[]::TEXT[]))
        THEN COALESCE(p_selection_methods ->> id, 'CUMULATIVE_STAR')
      WHEN status = 'ACTIVE' THEN NULL
      ELSE winner_selection_method
    END
  WHERE room_id = p_room_id;
  GET DIAGNOSTICS v_winner_count = ROW_COUNT;

  UPDATE public.rooms
  SET status = 'CLOSED', final_vote_status = 'FINALIZED',
      tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object('success', TRUE, 'updatedIdeaCount', v_winner_count);
END;
$$;

-- 폴링 한 번에 접근 권한과 변경 버전을 함께 확인한다. 일반 권한 미들웨어의
-- 다중 SELECT를 우회하므로 참여자·투표자가 늘어도 상태 확인은 DB 1회다.
CREATE OR REPLACE FUNCTION public.get_room_state_v9(
  p_room_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_allowed := v_room.host_id = p_user_id
    OR EXISTS (
      SELECT 1 FROM public.participants
      WHERE room_id = p_room_id AND user_id = p_user_id AND role = 'PARTICIPANT'
    )
    OR EXISTS (
      SELECT 1 FROM public.room_voter_registrations
      WHERE room_id = p_room_id AND user_id = p_user_id
        AND status IN ('WAITING', 'ACTIVE')
    );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'ROOM_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'finalVoteStatus', v_room.final_vote_status,
    'currentRoundId', v_room.current_round_id,
    'currentFinalVoteCycleId', v_room.current_final_vote_cycle_id,
    'stateVersion', v_room.state_version::TEXT
  );
END;
$$;

-- 참여자 계정 초대의 좌석 예약은 1단계 종료 시 자동 만료된다.
CREATE OR REPLACE FUNCTION public.expire_participant_invites_v9()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'IDEA_SUBMISSION' AND NEW.status <> 'IDEA_SUBMISSION' THEN
    UPDATE public.room_account_invites
    SET status = 'EXPIRED', canceled_at = NOW()
    WHERE room_id = NEW.id AND invite_role = 'PARTICIPANT' AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rooms_expire_participant_invites_v9 ON public.rooms;
CREATE TRIGGER rooms_expire_participant_invites_v9
AFTER UPDATE OF status ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.expire_participant_invites_v9();

-- V9 RPCs are server-only. Revoking PUBLIC alone does not remove grants that
-- were assigned directly to Supabase's anon/authenticated roles.
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_parent_room_state_version_v9() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_room_row_state_version_v9() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.expire_participant_invites_v9() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_room_account_invite_v9(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_room_with_host_v9(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_room_invite_v9(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_room_account_invite_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.accept_room_account_invites_v9(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.join_room_v9(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_room_voter_registration_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.start_final_vote_roster_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_incomplete_final_vote_cycle_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_room_winners_v9(TEXT, TEXT[], JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_room_state_v9(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_account_invite_v9(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_room_with_host_v9(JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_room_invite_v9(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_room_account_invite_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_room_account_invites_v9(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_room_v9(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_room_voter_registration_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_final_vote_roster_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_incomplete_final_vote_cycle_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_room_winners_v9(TEXT, TEXT[], JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_room_state_v9(TEXT, TEXT) TO service_role;

COMMIT;

-- 검증 결과는 모두 0이어야 한다.
SELECT 'invalid_external_voter_settings' AS check_name, COUNT(*) AS issue_count
FROM public.rooms
WHERE (external_voters_enabled AND required_voter_count NOT BETWEEN 1 AND 30)
   OR (NOT external_voters_enabled AND required_voter_count <> 0)
UNION ALL
SELECT 'invalid_participant_roles', COUNT(*) FROM public.participants
WHERE role NOT IN ('PARTICIPANT', 'VOTER')
UNION ALL
SELECT 'duplicate_active_account_invites', COUNT(*) FROM (
  SELECT room_id, invited_login_id, invite_role
  FROM public.room_account_invites WHERE status = 'PENDING'
  GROUP BY room_id, invited_login_id, invite_role HAVING COUNT(*) > 1
) duplicate_rows
UNION ALL
SELECT 'locked_rooms_without_final_snapshot', COUNT(*)
FROM public.rooms room
WHERE room.final_vote_roster_locked_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.room_phase_participants participant
    WHERE participant.room_id = room.id AND participant.phase LIKE 'FINAL_VOTE:%'
  );


-- ============================================================
-- V10 voter invite consent + UI support (2026-08-23)
-- ============================================================
BEGIN;

-- V10: voter account invitations require an explicit accept/decline response.
ALTER TABLE public.room_account_invites
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ NULL;

ALTER TABLE public.room_account_invites
  DROP CONSTRAINT IF EXISTS room_account_invites_status_check;
ALTER TABLE public.room_account_invites
  ADD CONSTRAINT room_account_invites_status_check
  CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED'));

-- Existing completed rows predate responded_at. Backfill only historical rows;
-- pending invitations intentionally remain NULL until a real response occurs.
UPDATE public.room_account_invites
SET responded_at = COALESCE(responded_at, accepted_at, canceled_at, created_at)
WHERE status <> 'PENDING' AND responded_at IS NULL;

-- Participant account invitations keep the V9 automatic-login behavior.
-- Voter invitations are deliberately excluded from this function.
CREATE OR REPLACE FUNCTION public.accept_participant_account_invites_v10(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_accounts%ROWTYPE;
  v_invite public.room_account_invites%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_participant_count INT;
  v_matched JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_account
  FROM public.user_accounts
  WHERE id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RETURN v_matched; END IF;

  FOR v_invite IN
    SELECT *
    FROM public.room_account_invites
    WHERE invited_user_id = p_user_id
      AND invite_role = 'PARTICIPANT'
      AND status = 'PENDING'
    ORDER BY created_at, id
  LOOP
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = v_invite.room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room.status = 'CLOSED' THEN
      UPDATE public.room_account_invites
      SET status = 'EXPIRED', canceled_at = NOW(), responded_at = NOW()
      WHERE id = v_invite.id AND status = 'PENDING';
      CONTINUE;
    END IF;

    SELECT * INTO v_invite
    FROM public.room_account_invites
    WHERE id = v_invite.id
      AND invited_user_id = p_user_id
      AND invite_role = 'PARTICIPANT'
      AND status = 'PENDING'
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_room.status <> 'IDEA_SUBMISSION' THEN
      UPDATE public.room_account_invites
      SET status = 'EXPIRED', canceled_at = NOW(), responded_at = NOW()
      WHERE id = v_invite.id AND status = 'PENDING';
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.room_voter_registrations
      WHERE room_id = v_room.id
        AND user_id = p_user_id::TEXT
        AND status IN ('WAITING', 'ACTIVE')
    ) THEN
      UPDATE public.room_account_invites
      SET status = 'EXPIRED', canceled_at = NOW(), responded_at = NOW()
      WHERE id = v_invite.id AND status = 'PENDING';
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_participant_count
    FROM public.participants
    WHERE room_id = v_room.id AND role = 'PARTICIPANT';

    IF v_participant_count >= v_room.max_participants THEN
      -- Keep the reservation pending. A full room may later free a seat.
      CONTINUE;
    END IF;

    INSERT INTO public.participants(room_id, user_id, nickname, role)
    VALUES (v_room.id, p_user_id::TEXT, v_account.nickname, 'PARTICIPANT')
    ON CONFLICT (room_id, user_id) DO UPDATE
    SET nickname = EXCLUDED.nickname, role = 'PARTICIPANT';

    UPDATE public.room_account_invites
    SET status = 'ACCEPTED', accepted_at = NOW(), responded_at = NOW()
    WHERE id = v_invite.id AND status = 'PENDING';

    v_matched := v_matched || jsonb_build_array(jsonb_build_object(
      'roomId', v_room.id,
      'role', 'PARTICIPANT',
      'waiting', FALSE
    ));
  END LOOP;

  RETURN v_matched;
END;
$$;

-- Lightweight list used only for the logged-in invitee's pending voter invites.
-- It intentionally returns no ideas, criteria, scores, or feedback.
CREATE OR REPLACE FUNCTION public.list_pending_voter_account_invites_v10(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', invite.id,
        'roomId', invite.room_id,
        'roomTitle', room.title,
        'invitedBy', COALESCE(NULLIF(host_account.nickname, ''), NULLIF(host_account.login_id, ''), '방장'),
        'role', 'VOTER',
        'status', invite.status,
        'roomStatus', room.status,
        'finalVoteStatus', room.final_vote_status,
        'createdAt', invite.created_at
      )
      ORDER BY invite.created_at, invite.id
    ),
    '[]'::JSONB
  )
  FROM public.room_account_invites invite
  JOIN public.rooms room ON room.id = invite.room_id
  LEFT JOIN public.user_accounts host_account ON host_account.id::TEXT = invite.created_by
  WHERE invite.invited_user_id = p_user_id
    AND invite.invite_role = 'VOTER'
    AND invite.status = 'PENDING'
    AND room.status <> 'CLOSED'
    AND room.final_vote_roster_locked_at IS NULL
    AND COALESCE(room.final_vote_status, 'NOT_STARTED') <> 'FINALIZED';
$$;

-- Accept or decline exactly one pending voter account invitation.
CREATE OR REPLACE FUNCTION public.respond_voter_account_invite_v10(
  p_user_id UUID,
  p_invite_id TEXT,
  p_response TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_accounts%ROWTYPE;
  v_invite public.room_account_invites%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_response TEXT := UPPER(BTRIM(COALESCE(p_response, '')));
  v_registered_count INT;
BEGIN
  IF v_response NOT IN ('ACCEPT', 'DECLINE') THEN
    RAISE EXCEPTION '초대 응답 값이 올바르지 않습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_account
  FROM public.user_accounts
  WHERE id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION '활성 계정을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the room first, then lock the room before the invitation. This
  -- matches host-side mutations and keeps capacity decisions serialized.
  SELECT * INTO v_invite
  FROM public.room_account_invites
  WHERE id = p_invite_id
    AND invited_user_id = p_user_id
    AND invite_role = 'VOTER';

  IF NOT FOUND THEN
    RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_invite.room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '회의실을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_invite
  FROM public.room_account_invites
  WHERE id = p_invite_id
    AND invited_user_id = p_user_id
    AND invite_role = 'VOTER'
  FOR UPDATE;

  IF NOT FOUND OR v_invite.status <> 'PENDING' THEN
    RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status = 'CLOSED' OR v_room.final_vote_status = 'FINALIZED' THEN
    RAISE EXCEPTION '이미 종료된 회의실입니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 이미 확정되었습니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_response = 'DECLINE' THEN
    UPDATE public.room_account_invites
    SET status = 'DECLINED', canceled_at = NOW(), responded_at = NOW()
    WHERE id = v_invite.id AND status = 'PENDING';
    IF NOT FOUND THEN
      RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'success', TRUE,
      'decision', 'DECLINED',
      'inviteId', v_invite.id,
      'roomId', v_invite.room_id
    );
  END IF;

  IF NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1 THEN
    RAISE EXCEPTION '외부 투표자 모집이 종료되었습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.participants
    WHERE room_id = v_room.id
      AND user_id = p_user_id::TEXT
      AND role = 'PARTICIPANT'
  ) THEN
    RAISE EXCEPTION '이미 참여자로 등록되어 있어 투표자로 중복 등록할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.room_voter_registrations
    WHERE room_id = v_room.id
      AND user_id = p_user_id::TEXT
      AND status IN ('WAITING', 'ACTIVE')
  ) THEN
    UPDATE public.room_account_invites
    SET status = 'ACCEPTED', accepted_at = NOW(), responded_at = NOW()
    WHERE id = v_invite.id AND status = 'PENDING';
    IF NOT FOUND THEN
      RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'success', TRUE,
      'decision', 'ACCEPTED',
      'inviteId', v_invite.id,
      'roomId', v_invite.room_id,
      'waiting', TRUE,
      'alreadyRegistered', TRUE
    );
  END IF;

  SELECT COUNT(*) INTO v_registered_count
  FROM public.room_voter_registrations
  WHERE room_id = v_room.id
    AND status IN ('WAITING', 'ACTIVE');

  IF v_registered_count >= v_room.required_voter_count THEN
    RAISE EXCEPTION '투표 정원이 마감되었습니다.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.room_voter_registrations(room_id, user_id, nickname, source, status)
  VALUES (v_room.id, p_user_id::TEXT, v_account.nickname, 'ACCOUNT', 'WAITING')
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET nickname = EXCLUDED.nickname, source = 'ACCOUNT', status = 'WAITING';

  UPDATE public.room_account_invites
  SET status = 'ACCEPTED', accepted_at = NOW(), responded_at = NOW()
  WHERE id = v_invite.id AND status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', 'ACCEPTED',
    'inviteId', v_invite.id,
    'roomId', v_invite.room_id,
    'waiting', TRUE
  );
END;
$$;

-- Host cancellation also records a response timestamp and immediately frees
-- the reserved seat because only PENDING invitations consume capacity.
CREATE OR REPLACE FUNCTION public.cancel_room_account_invite_v10(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_invite_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 초대를 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 초대를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.room_account_invites
  SET status = 'CANCELED', canceled_at = NOW(), responded_at = NOW()
  WHERE id = p_invite_id
    AND room_id = p_room_id
    AND status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION '취소할 대기 초대를 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'inviteId', p_invite_id);
END;
$$;

-- Compatibility wrapper: old server code can no longer auto-accept voter
-- account invitations after this migration is installed.
CREATE OR REPLACE FUNCTION public.accept_room_account_invites_v9(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.accept_participant_account_invites_v10(p_user_id);
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.accept_participant_account_invites_v10(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.list_pending_voter_account_invites_v10(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.respond_voter_account_invite_v10(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_room_account_invite_v10(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.accept_room_account_invites_v9(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_participant_account_invites_v10(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_voter_account_invites_v10(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_voter_account_invite_v10(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_room_account_invite_v10(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_room_account_invites_v9(UUID) TO service_role;

COMMIT;

-- V10 verification: all three issue_count values must be 0.
SELECT 'invalid_account_invite_status' AS check_name, COUNT(*) AS issue_count
FROM public.room_account_invites
WHERE status NOT IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED')
UNION ALL
SELECT 'voter_invite_accepted_without_registration', COUNT(*)
FROM public.room_account_invites invite
WHERE invite.invite_role = 'VOTER'
  AND invite.status = 'ACCEPTED'
  AND NOT EXISTS (
    SELECT 1
    FROM public.room_voter_registrations voter
    WHERE voter.room_id = invite.room_id
      AND voter.user_id = invite.invited_user_id::TEXT
      AND voter.status IN ('WAITING', 'ACTIVE', 'CANCELED')
  )
UNION ALL
SELECT 'voter_invite_participant_role_conflict', COUNT(*)
FROM public.room_account_invites invite
WHERE invite.invite_role = 'VOTER'
  AND invite.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM public.participants participant
    WHERE participant.room_id = invite.room_id
      AND participant.user_id = invite.invited_user_id::TEXT
      AND participant.role = 'PARTICIPANT'
  );

-- V11: participant consent, unified pending invite queue, 24h idle session policy
-- Source: supabase/migrations/20260823_participant_invite_session_navigation_v11.sql

BEGIN;

-- =============================================================================
-- WHYNOT V11
-- 1) Participant account invites require explicit accept/decline + 1~6 nickname.
-- 2) Login/signup/session restore can no longer auto-accept participant invites.
-- 3) Participant and voter pending account invites are listed in one invitee-only queue.
-- 4) Any PENDING -> terminal invite transition records responded_at automatically.
-- 5) Existing login sessions are capped to the new 24-hour idle-session ceiling.
-- 6) Participant max capacity cannot be lowered below active + reserved seats.
-- =============================================================================

-- Existing V10 sessions may have been issued with a seven-day absolute expiry.
-- Cap them immediately; future real-user activity is extended by the server's
-- /api/auth/activity endpoint, not by background polling.
UPDATE public.user_sessions
SET expires_at = LEAST(expires_at, NOW() + INTERVAL '1 day')
WHERE expires_at > NOW() + INTERVAL '1 day';

-- A single invariant keeps responded_at correct even when an older V9/V10 RPC
-- changes an invitation status (link join, host cancel, phase expiry, etc.).
CREATE OR REPLACE FUNCTION public.set_room_account_invite_responded_at_v11()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'PENDING'
     AND NEW.status <> 'PENDING'
     AND NEW.responded_at IS NULL THEN
    NEW.responded_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_account_invites_set_responded_at_v11 ON public.room_account_invites;
CREATE TRIGGER room_account_invites_set_responded_at_v11
BEFORE UPDATE OF status ON public.room_account_invites
FOR EACH ROW
EXECUTE FUNCTION public.set_room_account_invite_responded_at_v11();

-- A pending participant account invite is a real reserved seat. Prevent a host
-- from lowering max_participants below active participants + pending reservations.
-- Because room-changing invite/join RPCs also lock the room row first, this trigger
-- closes the race between capacity-setting changes and invitation acceptance/creation.
CREATE OR REPLACE FUNCTION public.enforce_participant_reserved_capacity_v11()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_used INT;
BEGIN
  IF NEW.max_participants IS NOT DISTINCT FROM OLD.max_participants THEN
    RETURN NEW;
  END IF;

  SELECT
    (SELECT COUNT(*) FROM public.participants
     WHERE room_id = NEW.id AND role = 'PARTICIPANT')
    +
    (SELECT COUNT(*) FROM public.room_account_invites
     WHERE room_id = NEW.id AND invite_role = 'PARTICIPANT' AND status = 'PENDING')
  INTO v_used;

  IF NEW.max_participants < v_used THEN
    RAISE EXCEPTION '참여자와 예약 좌석 %개보다 최대 참여 인원을 작게 설정할 수 없습니다.', v_used
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_enforce_participant_reserved_capacity_v11 ON public.rooms;
CREATE TRIGGER rooms_enforce_participant_reserved_capacity_v11
BEFORE UPDATE OF max_participants ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.enforce_participant_reserved_capacity_v11();

-- Clean up any stale reservations that predate the V11 invariant.
UPDATE public.room_account_invites invite
SET status = 'EXPIRED',
    canceled_at = COALESCE(invite.canceled_at, NOW()),
    responded_at = COALESCE(invite.responded_at, NOW())
FROM public.rooms room
WHERE room.id = invite.room_id
  AND invite.invite_role = 'PARTICIPANT'
  AND invite.status = 'PENDING'
  AND room.status <> 'IDEA_SUBMISSION';

UPDATE public.room_account_invites invite
SET status = 'EXPIRED',
    canceled_at = COALESCE(invite.canceled_at, NOW()),
    responded_at = COALESCE(invite.responded_at, NOW())
FROM public.rooms room
WHERE room.id = invite.room_id
  AND invite.invite_role = 'VOTER'
  AND invite.status = 'PENDING'
  AND (
    room.status = 'CLOSED'
    OR room.final_vote_roster_locked_at IS NOT NULL
    OR COALESCE(room.final_vote_status, 'NOT_STARTED') = 'FINALIZED'
  );

-- A user can also enter through a shared link after receiving a direct account
-- invite for the opposite role. Resolve that conflict immediately so the old
-- reservation cannot remain as a ghost seat or reappear in the lobby queue.
UPDATE public.room_account_invites invite
SET status = 'EXPIRED',
    canceled_at = COALESCE(invite.canceled_at, NOW()),
    responded_at = COALESCE(invite.responded_at, NOW())
WHERE invite.invite_role = 'PARTICIPANT'
  AND invite.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM public.room_voter_registrations voter
    WHERE voter.room_id = invite.room_id
      AND voter.user_id = invite.invited_user_id::TEXT
      AND voter.status IN ('WAITING', 'ACTIVE')
  );

UPDATE public.room_account_invites invite
SET status = 'EXPIRED',
    canceled_at = COALESCE(invite.canceled_at, NOW()),
    responded_at = COALESCE(invite.responded_at, NOW())
WHERE invite.invite_role = 'VOTER'
  AND invite.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM public.participants participant
    WHERE participant.room_id = invite.room_id
      AND participant.user_id = invite.invited_user_id::TEXT
      AND participant.role = 'PARTICIPANT'
  );

CREATE OR REPLACE FUNCTION public.expire_voter_account_invite_on_participant_v11()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'PARTICIPANT' THEN
    UPDATE public.room_account_invites
    SET status = 'EXPIRED',
        canceled_at = COALESCE(canceled_at, NOW()),
        responded_at = COALESCE(responded_at, NOW())
    WHERE room_id = NEW.room_id
      AND invited_user_id::TEXT = NEW.user_id
      AND invite_role = 'VOTER'
      AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participants_expire_conflicting_account_invite_v11 ON public.participants;
CREATE TRIGGER participants_expire_conflicting_account_invite_v11
AFTER INSERT OR UPDATE ON public.participants
FOR EACH ROW
EXECUTE FUNCTION public.expire_voter_account_invite_on_participant_v11();

CREATE OR REPLACE FUNCTION public.expire_participant_account_invite_on_voter_v11()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('WAITING', 'ACTIVE') THEN
    UPDATE public.room_account_invites
    SET status = 'EXPIRED',
        canceled_at = COALESCE(canceled_at, NOW()),
        responded_at = COALESCE(responded_at, NOW())
    WHERE room_id = NEW.room_id
      AND invited_user_id::TEXT = NEW.user_id
      AND invite_role = 'PARTICIPANT'
      AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS voter_registrations_expire_conflicting_account_invite_v11 ON public.room_voter_registrations;
CREATE TRIGGER voter_registrations_expire_conflicting_account_invite_v11
AFTER INSERT OR UPDATE ON public.room_voter_registrations
FOR EACH ROW
EXECUTE FUNCTION public.expire_participant_account_invite_on_voter_v11();

-- V11 hard-stop for the V9/V10 automatic participant acceptance path.
-- Keeping the old function names as no-ops makes rollback/old app instances safe:
-- they can call these functions, but no invitation is accepted without consent.
CREATE OR REPLACE FUNCTION public.accept_participant_account_invites_v10(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN '[]'::JSONB;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_room_account_invites_v9(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN '[]'::JSONB;
END;
$$;

-- One lightweight list for the logged-in invitee only. It intentionally exposes
-- only information needed to render the invitation card; it never returns other
-- invitees, participants, ideas, criteria, scores, votes, or feedback.
CREATE OR REPLACE FUNCTION public.list_pending_account_invites_v11(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', invite.id,
        'roomId', invite.room_id,
        'roomTitle', room.title,
        'invitedBy', COALESCE(NULLIF(host_account.nickname, ''), NULLIF(host_account.login_id, ''), '방장'),
        'role', invite.invite_role,
        'status', invite.status,
        'roomStatus', room.status,
        'finalVoteStatus', room.final_vote_status,
        'createdAt', invite.created_at
      )
      ORDER BY invite.created_at, invite.id
    ),
    '[]'::JSONB
  )
  FROM public.room_account_invites invite
  JOIN public.rooms room ON room.id = invite.room_id
  LEFT JOIN public.user_accounts host_account ON host_account.id::TEXT = invite.created_by
  WHERE invite.invited_user_id = p_user_id
    AND invite.status = 'PENDING'
    AND (
      (
        invite.invite_role = 'PARTICIPANT'
        AND room.status = 'IDEA_SUBMISSION'
      )
      OR
      (
        invite.invite_role = 'VOTER'
        AND room.status <> 'CLOSED'
        AND room.final_vote_roster_locked_at IS NULL
        AND COALESCE(room.final_vote_status, 'NOT_STARTED') <> 'FINALIZED'
      )
    );
$$;

-- Explicit response transaction for exactly one participant account invitation.
-- Room lock -> invitation lock matches host-side mutation order and serializes
-- capacity decisions with link joins, cancellations, and phase transitions.
CREATE OR REPLACE FUNCTION public.respond_participant_account_invite_v11(
  p_user_id UUID,
  p_invite_id TEXT,
  p_response TEXT,
  p_nickname TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_accounts%ROWTYPE;
  v_invite public.room_account_invites%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_response TEXT := UPPER(BTRIM(COALESCE(p_response, '')));
  v_nickname TEXT := BTRIM(COALESCE(p_nickname, ''));
  v_participant_count INT;
  v_existing_nickname TEXT;
BEGIN
  IF v_response NOT IN ('ACCEPT', 'DECLINE') THEN
    RAISE EXCEPTION '초대 응답 값이 올바르지 않습니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_response = 'ACCEPT' AND (
    CHAR_LENGTH(v_nickname) < 1
    OR CHAR_LENGTH(v_nickname) > 6
    OR v_nickname ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION '입장할 닉네임을 1~6자로 입력해 주세요.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_account
  FROM public.user_accounts
  WHERE id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION '활성 계정을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve room id before locks, then always lock room first.
  SELECT * INTO v_invite
  FROM public.room_account_invites
  WHERE id = p_invite_id
    AND invited_user_id = p_user_id
    AND invite_role = 'PARTICIPANT';
  IF NOT FOUND THEN
    RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_invite.room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '회의실을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_invite
  FROM public.room_account_invites
  WHERE id = p_invite_id
    AND invited_user_id = p_user_id
    AND invite_role = 'PARTICIPANT'
  FOR UPDATE;
  IF NOT FOUND OR v_invite.status <> 'PENDING' THEN
    RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '참여 가능한 단계가 종료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_response = 'DECLINE' THEN
    UPDATE public.room_account_invites
    SET status = 'DECLINED',
        canceled_at = NOW(),
        responded_at = NOW()
    WHERE id = v_invite.id AND status = 'PENDING';
    IF NOT FOUND THEN
      RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'success', TRUE,
      'decision', 'DECLINED',
      'inviteId', v_invite.id,
      'roomId', v_invite.room_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.room_voter_registrations
    WHERE room_id = v_room.id
      AND user_id = p_user_id::TEXT
      AND status IN ('WAITING', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION '이미 투표자로 등록되어 있어 참여자로 중복 등록할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent cleanup for a rare legacy/link-join race. A participant row must
  -- never be duplicated; the pending invitation is simply finalized.
  SELECT nickname INTO v_existing_nickname
  FROM public.participants
  WHERE room_id = v_room.id
    AND user_id = p_user_id::TEXT
    AND role = 'PARTICIPANT';

  IF FOUND THEN
    UPDATE public.room_account_invites
    SET status = 'ACCEPTED',
        accepted_at = COALESCE(accepted_at, NOW()),
        responded_at = NOW()
    WHERE id = v_invite.id AND status = 'PENDING';
    IF NOT FOUND THEN
      RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'success', TRUE,
      'decision', 'ACCEPTED',
      'inviteId', v_invite.id,
      'roomId', v_invite.room_id,
      'nickname', v_existing_nickname,
      'alreadyRegistered', TRUE
    );
  END IF;

  SELECT COUNT(*) INTO v_participant_count
  FROM public.participants
  WHERE room_id = v_room.id AND role = 'PARTICIPANT';

  IF v_participant_count >= v_room.max_participants THEN
    RAISE EXCEPTION '참여자 정원이 마감되었습니다.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.participants(room_id, user_id, nickname, role)
  VALUES (v_room.id, p_user_id::TEXT, v_nickname, 'PARTICIPANT')
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET nickname = EXCLUDED.nickname,
      role = 'PARTICIPANT';

  UPDATE public.room_account_invites
  SET status = 'ACCEPTED',
      accepted_at = NOW(),
      responded_at = NOW()
  WHERE id = v_invite.id AND status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION '이미 처리되었거나 만료된 초대입니다.' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', 'ACCEPTED',
    'inviteId', v_invite.id,
    'roomId', v_invite.room_id,
    'nickname', v_nickname,
    'alreadyRegistered', FALSE
  );
END;
$$;

-- Server-only execution rights, consistent with V9/V10 hardening.
REVOKE ALL PRIVILEGES ON FUNCTION public.set_room_account_invite_responded_at_v11() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_participant_reserved_capacity_v11() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.expire_voter_account_invite_on_participant_v11() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.expire_participant_account_invite_on_voter_v11() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.accept_participant_account_invites_v10(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.accept_room_account_invites_v9(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.list_pending_account_invites_v11(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.respond_participant_account_invite_v11(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_participant_account_invites_v10(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_room_account_invites_v9(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_account_invites_v11(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_participant_account_invite_v11(UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

-- V11 verification: every issue_count should be 0 immediately after migration.
SELECT 'participant_invite_accepted_without_participant' AS check_name, COUNT(*) AS issue_count
FROM public.room_account_invites invite
WHERE invite.invite_role = 'PARTICIPANT'
  AND invite.status = 'ACCEPTED'
  AND NOT EXISTS (
    SELECT 1
    FROM public.participants participant
    WHERE participant.room_id = invite.room_id
      AND participant.user_id = invite.invited_user_id::TEXT
      AND participant.role = 'PARTICIPANT'
  )
UNION ALL
SELECT 'participant_invite_pending_after_idea_phase', COUNT(*)
FROM public.room_account_invites invite
JOIN public.rooms room ON room.id = invite.room_id
WHERE invite.invite_role = 'PARTICIPANT'
  AND invite.status = 'PENDING'
  AND room.status <> 'IDEA_SUBMISSION'
UNION ALL
SELECT 'participant_invite_voter_role_conflict', COUNT(*)
FROM public.room_account_invites invite
WHERE invite.invite_role = 'PARTICIPANT'
  AND invite.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM public.room_voter_registrations voter
    WHERE voter.room_id = invite.room_id
      AND voter.user_id = invite.invited_user_id::TEXT
      AND voter.status IN ('WAITING', 'ACTIVE')
  )
UNION ALL
SELECT 'voter_invite_participant_role_conflict', COUNT(*)
FROM public.room_account_invites invite
WHERE invite.invite_role = 'VOTER'
  AND invite.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM public.participants participant
    WHERE participant.room_id = invite.room_id
      AND participant.user_id = invite.invited_user_id::TEXT
      AND participant.role = 'PARTICIPANT'
  )
UNION ALL
SELECT 'terminal_invite_without_responded_at', COUNT(*)
FROM public.room_account_invites
WHERE status <> 'PENDING' AND responded_at IS NULL
UNION ALL
SELECT 'session_expiry_over_24h', COUNT(*)
FROM public.user_sessions
WHERE expires_at > NOW() + INTERVAL '1 day';


-- =============================================================================
-- V12. PARTICIPANT/VOTER LEAVE, CLOSED ARCHIVE, FINAL-VOTE PLANNED SCHEDULE
-- Source: supabase/migrations/20260823_participant_voter_archive_schedule_v12.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- WHYNOT V12
-- 1) Participant self-leave is allowed only during IDEA_SUBMISSION and never for host.
-- 2) Leaving removes the participant's Stage-1 ideas/completion atomically and frees the seat.
-- 3) WAITING external voters may cancel their own registration before roster lock.
-- 4) Personal archive is restricted to CLOSED rooms and works for participant/host/voter.
-- 5) Legacy non-CLOSED hidden rows are restored to the normal dashboard.
-- 6) Final-vote planned start/end keys are normalized without introducing auto start/end.
-- 7) Stage-1 host gate counts PARTICIPANT roles only.
-- =============================================================================

ALTER TABLE public.room_voter_registrations
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ NULL;

ALTER TABLE public.room_account_invites
  ADD COLUMN IF NOT EXISTS membership_left_at TIMESTAMPTZ NULL;

-- V11 wrote the planned final-vote start into voteStartTime and the planned end
-- into evaluationAt. Copy those values to unambiguous canonical keys. Legacy keys
-- are intentionally preserved for rollback compatibility; V12 application writes
-- only finalVoteStartAt/finalVoteEndAt.
UPDATE public.rooms
SET deadlines = jsonb_strip_nulls(
  COALESCE(deadlines, '{}'::JSONB) ||
  jsonb_build_object(
    'finalVoteStartAt', COALESCE(deadlines ->> 'finalVoteStartAt', deadlines ->> 'voteStartTime'),
    'finalVoteEndAt', COALESCE(deadlines ->> 'finalVoteEndAt', deadlines ->> 'evaluationAt')
  )
)
WHERE (deadlines ? 'voteStartTime' OR deadlines ? 'evaluationAt')
  AND (
    NOT (deadlines ? 'finalVoteStartAt') OR
    NOT (deadlines ? 'finalVoteEndAt')
  );

-- V11 allowed personal hiding during active phases. V12 archive policy is CLOSED-only.
UPDATE public.participants participant
SET hidden_at = NULL
FROM public.rooms room
WHERE room.id = participant.room_id
  AND room.status <> 'CLOSED'
  AND participant.hidden_at IS NOT NULL;

UPDATE public.room_voter_registrations voter
SET hidden_at = NULL
FROM public.rooms room
WHERE room.id = voter.room_id
  AND room.status <> 'CLOSED'
  AND voter.hidden_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_room_archive_v12(
  p_room_id TEXT,
  p_user_id TEXT,
  p_hidden BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_hidden_at TIMESTAMPTZ := CASE WHEN p_hidden THEN NOW() ELSE NULL END;
  v_participant_rows INT := 0;
  v_voter_rows INT := 0;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.status <> 'CLOSED' THEN
    RAISE EXCEPTION '완료된 회의실만 보관할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.participants
  SET hidden_at = v_hidden_at
  WHERE room_id = p_room_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_participant_rows = ROW_COUNT;

  UPDATE public.room_voter_registrations
  SET hidden_at = v_hidden_at
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND status IN ('WAITING', 'ACTIVE');
  GET DIAGNOSTICS v_voter_rows = ROW_COUNT;

  IF v_participant_rows + v_voter_rows = 0 THEN
    RAISE EXCEPTION '이 회의실을 보관할 권한이 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'archived', p_hidden,
    'roomId', p_room_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_room_participant_v12(
  p_room_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_deleted_ideas INT := 0;
  v_remaining_participants INT := 0;
BEGIN
  -- Serializes against advance_idea_submission_v8 and invite/capacity mutations.
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.host_id = p_user_id THEN
    RAISE EXCEPTION '방장은 회의실에서 탈퇴할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '참여자는 아이디어 등록 단계에서만 회의실에서 탈퇴할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.participants
    WHERE room_id = p_room_id
      AND user_id = p_user_id
      AND role = 'PARTICIPANT'
  ) THEN
    RAISE EXCEPTION '탈퇴할 참여자 정보를 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.phase_completions
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND phase = 'IDEA_SUBMISSION';

  -- Defensive cleanup for legacy/stale Stage-1 snapshots only. Later phase snapshots
  -- cannot exist while the room row is locked in IDEA_SUBMISSION.
  DELETE FROM public.room_phase_participants
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND phase LIKE 'IDEA_SUBMISSION%';

  DELETE FROM public.ideas
  WHERE room_id = p_room_id
    AND submitter_id = p_user_id;
  GET DIAGNOSTICS v_deleted_ideas = ROW_COUNT;

  -- Preserve ACCEPTED invite history while marking that the accepted membership
  -- intentionally ended. This distinguishes a legitimate leave from data corruption.
  UPDATE public.room_account_invites
  SET membership_left_at = COALESCE(membership_left_at, NOW())
  WHERE room_id = p_room_id
    AND invited_user_id::TEXT = p_user_id
    AND invite_role = 'PARTICIPANT'
    AND status = 'ACCEPTED'
    AND membership_left_at IS NULL;

  DELETE FROM public.participants
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND role = 'PARTICIPANT';

  IF NOT FOUND THEN
    RAISE EXCEPTION '참여자 탈퇴가 다른 요청과 충돌했습니다. 다시 시도해 주세요.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_remaining_participants
  FROM public.participants
  WHERE room_id = p_room_id
    AND role = 'PARTICIPANT';

  RETURN jsonb_build_object(
    'success', TRUE,
    'roomId', p_room_id,
    'deletedIdeaCount', v_deleted_ideas,
    'remainingParticipantCount', v_remaining_participants
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_voter_registration_v12(
  p_room_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.status = 'CLOSED'
     OR v_room.final_vote_roster_locked_at IS NOT NULL
     OR COALESCE(v_room.final_vote_status, 'NOT_STARTED') <> 'NOT_STARTED'
     OR v_room.current_final_vote_cycle_id IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표가 시작된 뒤에는 투표자 등록을 취소할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.room_voter_registrations
  SET status = 'CANCELED',
      activated_at = NULL,
      hidden_at = NULL
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND status = 'WAITING';

  IF NOT FOUND THEN
    RAISE EXCEPTION '취소할 대기 투표자 등록을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  -- Keep the original ACCEPTED invitation as history while recording that the
  -- accepted voter registration was intentionally canceled by the voter.
  UPDATE public.room_account_invites
  SET membership_left_at = COALESCE(membership_left_at, NOW())
  WHERE room_id = p_room_id
    AND invited_user_id::TEXT = p_user_id
    AND invite_role = 'VOTER'
    AND status = 'ACCEPTED'
    AND membership_left_at IS NULL;

  RETURN jsonb_build_object(
    'success', TRUE,
    'roomId', p_room_id,
    'userId', p_user_id
  );
END;
$$;

-- V8's original Stage-1 gate predated the V9 PARTICIPANT/VOTER role split and
-- counted every row in participants. Replace it so only real participants can
-- satisfy or block the host's next-stage gate.
CREATE OR REPLACE FUNCTION public.advance_idea_submission_v8(
  p_room_id TEXT,
  p_host_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_participant_count INT;
  v_missing_completion_count INT;
  v_missing_idea_count INT;
  v_active_idea_count INT;
  v_phase TEXT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 방 단계를 변경할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '현재 아이디어 등록 단계를 종료할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_participant_count
  FROM public.participants
  WHERE room_id = p_room_id AND role = 'PARTICIPANT';
  IF v_participant_count < 2 THEN
    RAISE EXCEPTION '종합점수 평가는 서로 다른 참여자 2명 이상이 필요합니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_missing_completion_count
  FROM public.participants participant
  WHERE participant.room_id = p_room_id
    AND participant.role = 'PARTICIPANT'
    AND NOT EXISTS (
      SELECT 1 FROM public.phase_completions completion
      WHERE completion.room_id = p_room_id
        AND completion.phase = 'IDEA_SUBMISSION'
        AND completion.user_id = participant.user_id
    );
  IF v_missing_completion_count > 0 THEN
    RAISE EXCEPTION '모든 참여자가 아이디어 등록 완료를 눌러야 다음 단계로 이동할 수 있습니다. (%명 미완료)', v_missing_completion_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_missing_idea_count
  FROM public.participants participant
  WHERE participant.room_id = p_room_id
    AND participant.role = 'PARTICIPANT'
    AND NOT EXISTS (
      SELECT 1 FROM public.ideas idea
      WHERE idea.room_id = p_room_id
        AND idea.submitter_id = participant.user_id
        AND idea.status = 'ACTIVE'
    );
  IF v_missing_idea_count > 0 THEN
    RAISE EXCEPTION '모든 참여자가 아이디어를 한 개 이상 등록해야 다음 단계로 이동할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_active_idea_count
  FROM public.ideas
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  IF v_active_idea_count <= GREATEST(1, COALESCE(v_room.target_winner_count, 1)) THEN
    RAISE EXCEPTION '최종 선정 수보다 전체 아이디어가 최소 한 개 더 필요합니다.' USING ERRCODE = 'P0001';
  END IF;

  v_phase := 'CRITERIA_PROPOSAL:v' || GREATEST(1, COALESCE(v_room.criteria_set_version, 1));
  INSERT INTO public.room_phase_participants(room_id, phase, user_id, role)
  SELECT p_room_id, v_phase, participant.user_id, 'PARTICIPANT'
  FROM public.participants participant
  WHERE participant.room_id = p_room_id
    AND participant.role = 'PARTICIPANT'
  ON CONFLICT (room_id, phase, user_id) DO NOTHING;

  UPDATE public.rooms SET status = 'CRITERIA_PROPOSAL' WHERE id = p_room_id;
  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'CRITERIA_PROPOSAL',
    'participantCount', v_participant_count,
    'activeIdeaCount', v_active_idea_count,
    'phase', v_phase
  );
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.leave_room_participant_v12(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_my_voter_registration_v12(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.advance_idea_submission_v8(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.leave_room_participant_v12(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_my_voter_registration_v12(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_idea_submission_v8(TEXT, TEXT) TO service_role;

COMMIT;

-- V12 verification: every issue_count should be 0 immediately after migration.
SELECT 'non_closed_participant_archive' AS check_name, COUNT(*) AS issue_count
FROM public.participants participant
JOIN public.rooms room ON room.id = participant.room_id
WHERE room.status <> 'CLOSED' AND participant.hidden_at IS NOT NULL
UNION ALL
SELECT 'non_closed_voter_archive', COUNT(*)
FROM public.room_voter_registrations voter
JOIN public.rooms room ON room.id = voter.room_id
WHERE room.status <> 'CLOSED' AND voter.hidden_at IS NOT NULL
UNION ALL
SELECT 'accepted_participant_invite_without_member_or_leave_history', COUNT(*)
FROM public.room_account_invites invite
WHERE invite.invite_role = 'PARTICIPANT'
  AND invite.status = 'ACCEPTED'
  AND invite.membership_left_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.participants participant
    WHERE participant.room_id = invite.room_id
      AND participant.user_id = invite.invited_user_id::TEXT
      AND participant.role = 'PARTICIPANT'
  )
UNION ALL
SELECT 'accepted_voter_invite_without_registration_or_leave_history', COUNT(*)
FROM public.room_account_invites invite
WHERE invite.invite_role = 'VOTER'
  AND invite.status = 'ACCEPTED'
  AND invite.membership_left_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.room_voter_registrations voter
    WHERE voter.room_id = invite.room_id
      AND voter.user_id = invite.invited_user_id::TEXT
      AND voter.status IN ('WAITING', 'ACTIVE')
  )
UNION ALL
SELECT 'legacy_final_vote_start_not_normalized', COUNT(*)
FROM public.rooms
WHERE deadlines ? 'voteStartTime' AND NOT (deadlines ? 'finalVoteStartAt')
UNION ALL
SELECT 'legacy_final_vote_end_not_normalized', COUNT(*)
FROM public.rooms
WHERE deadlines ? 'evaluationAt' AND NOT (deadlines ? 'finalVoteEndAt');


-- ============================================================================
-- Source: supabase/migrations/20260823_archive_all_room_states_v12_1.sql
-- V12.1 personal archive policy correction: all room states can be archived.
-- ============================================================================

-- WHYNOT V12.1: personal archive for all room states
-- 2026-08-23
--
-- Policy correction after V12:
-- - Archive is a personal list-cleanup preference, not a lifecycle action.
-- - IDEA_SUBMISSION / evaluation phases / CLOSED rooms can all be archived.
-- - Archiving never leaves, deletes, ends, or changes the room/stage.
-- - The existing hidden_at columns and set_room_archive_v12 RPC are reused.
-- - Existing V12 migration remains immutable; this migration only relaxes the CLOSED-only guard.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_room_archive_v12(
  p_room_id TEXT,
  p_user_id TEXT,
  p_hidden BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_hidden_at TIMESTAMPTZ := CASE WHEN p_hidden THEN NOW() ELSE NULL END;
  v_participant_rows INT := 0;
  v_voter_rows INT := 0;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  -- Personal archive is intentionally independent from room.status.
  UPDATE public.participants
  SET hidden_at = v_hidden_at
  WHERE room_id = p_room_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_participant_rows = ROW_COUNT;

  UPDATE public.room_voter_registrations
  SET hidden_at = v_hidden_at
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND status IN ('WAITING', 'ACTIVE');
  GET DIAGNOSTICS v_voter_rows = ROW_COUNT;

  IF v_participant_rows + v_voter_rows = 0 THEN
    RAISE EXCEPTION '이 회의실을 보관할 권한이 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'archived', p_hidden,
    'roomId', p_room_id
  );
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;

-- V12.1 verification: every issue_count should be 0.
SELECT 'archive_function_closed_only_guard' AS check_name,
  CASE
    WHEN pg_get_functiondef('public.set_room_archive_v12(text,text,boolean)'::regprocedure)
      ILIKE '%완료된 회의실만 보관%'
    THEN 1 ELSE 0
  END AS issue_count
UNION ALL
SELECT 'participant_archive_orphan_room', COUNT(*)
FROM public.participants participant
LEFT JOIN public.rooms room ON room.id = participant.room_id
WHERE participant.hidden_at IS NOT NULL AND room.id IS NULL
UNION ALL
SELECT 'voter_archive_orphan_room', COUNT(*)
FROM public.room_voter_registrations voter
LEFT JOIN public.rooms room ON room.id = voter.room_id
WHERE voter.hidden_at IS NOT NULL AND room.id IS NULL
UNION ALL
SELECT 'terminal_voter_registration_archived', COUNT(*)
FROM public.room_voter_registrations voter
WHERE voter.hidden_at IS NOT NULL
  AND voter.status NOT IN ('WAITING', 'ACTIVE');


-- WHYNOT_FEEDBACK_RECONSTRUCTION_V13_BEGIN
-- 신규/복구 환경에서 V13을 동일하게 구성하기 위한 추가 구간입니다.
-- =============================================================================
-- WhyNot V13: eliminated-idea feedback reconstruction
--
-- Purpose
--   - Preserve original evaluation rows.
--   - Never expose raw feedback for ideas eliminated by score-evaluation rounds.
--   - Store AI reconstruction as an independent FEEDBACK_RECONSTRUCTION report.
--   - Keep score calculation, survivor selection, second-round scoring and final vote unchanged.
-- =============================================================================

BEGIN;

ALTER TABLE public.ai_reports
  DROP CONSTRAINT IF EXISTS ai_reports_report_type_check;

ALTER TABLE public.ai_reports
  ADD CONSTRAINT ai_reports_report_type_check
  CHECK (report_type IN (
    'FINAL_DECISION',
    'REFINEMENT_SUMMARY',
    'EVALUATION_CARDS',
    'SCREENING_SUMMARY',
    'AI_BOUNDARY_TIEBREAK',
    'FEEDBACK_RECONSTRUCTION'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_feedback_reconstruction_round_unique
  ON public.ai_reports(room_id, round_id)
  WHERE round_id IS NOT NULL
    AND report_type = 'FEEDBACK_RECONSTRUCTION';

CREATE OR REPLACE FUNCTION public.claim_feedback_reconstruction_v13(
  p_room_id TEXT,
  p_round_id TEXT,
  p_lease_token TEXT,
  p_lease_seconds INT DEFAULT 45
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.ai_reports%ROWTYPE;
  v_snapshot JSONB;
  v_status TEXT;
  v_claimed_at TIMESTAMPTZ;
  v_retry_after TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
  v_lease_seconds INT := GREATEST(10, LEAST(COALESCE(p_lease_seconds, 45), 180));
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_room_id, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_round_id, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_lease_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'feedback reconstruction claim arguments are required';
  END IF;

  -- Serializes first-claim and stale-lease reclaim for the same room/round.
  PERFORM pg_advisory_xact_lock(
    hashtext('feedback-reconstruction:' || p_room_id || ':' || p_round_id)
  );

  SELECT *
  INTO v_report
  FROM public.ai_reports
  WHERE room_id = p_room_id
    AND round_id = p_round_id
    AND report_type = 'FEEDBACK_RECONSTRUCTION'
  FOR UPDATE;

  IF NOT FOUND THEN
    v_snapshot := jsonb_build_object(
      'schemaVersion', 1,
      'overallStatus', 'PROCESSING',
      'leaseToken', p_lease_token,
      'claimedAt', v_now
    );

    INSERT INTO public.ai_reports (
      id,
      room_id,
      round_id,
      report_type,
      report_text,
      input_snapshot,
      result_snapshot,
      model_name,
      prompt_version
    ) VALUES (
      'ai-report-feedback-reconstruction-' || p_round_id,
      p_room_id,
      p_round_id,
      'FEEDBACK_RECONSTRUCTION',
      '탈락 아이디어 익명 피드백 재구성',
      '{}'::jsonb,
      v_snapshot,
      'pending',
      'feedback-reconstruction-v1.0'
    );

    RETURN jsonb_build_object('action', 'CLAIMED', 'resultSnapshot', v_snapshot);
  END IF;

  v_snapshot := COALESCE(v_report.result_snapshot, '{}'::jsonb);
  v_status := COALESCE(v_snapshot->>'overallStatus', '');

  IF v_status IN ('READY', 'INSUFFICIENT_EVIDENCE') THEN
    RETURN jsonb_build_object('action', 'EXISTS', 'resultSnapshot', v_snapshot);
  END IF;

  IF v_status = 'PROCESSING' THEN
    BEGIN
      v_claimed_at := NULLIF(v_snapshot->>'claimedAt', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_claimed_at := NULL;
    END;

    IF v_claimed_at IS NOT NULL
       AND v_claimed_at > v_now - make_interval(secs => v_lease_seconds) THEN
      RETURN jsonb_build_object('action', 'PROCESSING', 'resultSnapshot', v_snapshot);
    END IF;
  ELSIF v_status = 'UNAVAILABLE' THEN
    BEGIN
      v_retry_after := NULLIF(v_snapshot->>'retryAfter', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_retry_after := NULL;
    END;

    IF v_retry_after IS NOT NULL AND v_retry_after > v_now THEN
      RETURN jsonb_build_object('action', 'EXISTS', 'resultSnapshot', v_snapshot);
    END IF;
  END IF;

  v_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'overallStatus', 'PROCESSING',
    'leaseToken', p_lease_token,
    'claimedAt', v_now
  );

  UPDATE public.ai_reports
  SET
    result_snapshot = v_snapshot,
    model_name = 'pending',
    prompt_version = 'feedback-reconstruction-v1.0'
  WHERE id = v_report.id;

  RETURN jsonb_build_object('action', 'CLAIMED', 'resultSnapshot', v_snapshot);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_feedback_reconstruction_v13(
  p_room_id TEXT,
  p_round_id TEXT,
  p_lease_token TEXT,
  p_input_snapshot JSONB,
  p_result_snapshot JSONB,
  p_model_name TEXT,
  p_prompt_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.ai_reports%ROWTYPE;
  v_current_token TEXT;
  v_status TEXT;
  v_clean_result JSONB;
BEGIN
  SELECT *
  INTO v_report
  FROM public.ai_reports
  WHERE room_id = p_room_id
    AND round_id = p_round_id
    AND report_type = 'FEEDBACK_RECONSTRUCTION'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback reconstruction report does not exist';
  END IF;

  v_current_token := COALESCE(v_report.result_snapshot->>'leaseToken', '');
  IF v_current_token <> COALESCE(p_lease_token, '') THEN
    RAISE EXCEPTION 'feedback reconstruction lease is no longer valid';
  END IF;

  v_status := COALESCE(p_result_snapshot->>'overallStatus', '');
  IF v_status NOT IN ('READY', 'INSUFFICIENT_EVIDENCE', 'UNAVAILABLE') THEN
    RAISE EXCEPTION 'invalid feedback reconstruction completion status';
  END IF;

  v_clean_result := COALESCE(p_result_snapshot, '{}'::jsonb) - 'leaseToken' - 'claimedAt';

  UPDATE public.ai_reports
  SET
    report_text = '탈락 아이디어 익명 피드백 재구성',
    input_snapshot = COALESCE(p_input_snapshot, '{}'::jsonb),
    result_snapshot = v_clean_result,
    model_name = COALESCE(NULLIF(BTRIM(p_model_name), ''), 'unknown'),
    prompt_version = COALESCE(NULLIF(BTRIM(p_prompt_version), ''), 'feedback-reconstruction-v1.0')
  WHERE id = v_report.id;

  RETURN v_clean_result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_feedback_reconstruction_v13(TEXT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_feedback_reconstruction_v13(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_feedback_reconstruction_v13(TEXT, TEXT, TEXT, INT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_feedback_reconstruction_v13(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT)
  TO service_role;

COMMIT;

-- WHYNOT_FEEDBACK_RECONSTRUCTION_V13_END

-- =============================================================================
-- WHYNOT V14 RELEASE HARDENING
-- 1) Real PDF reference assets (private Supabase Storage)
-- 2) Backward-compatible idea metadata columns
--
-- IMPORTANT
-- - Apply this forward migration to the existing Supabase project.
-- - Do NOT re-run supabase_master_migration_full.sql on an existing production DB.
-- =============================================================================

BEGIN;

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS pdf_attachment_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_attachment_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_attachment_size BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ideas_pdf_attachment_size_v14_check'
      AND conrelid = 'public.ideas'::regclass
  ) THEN
    ALTER TABLE public.ideas
      ADD CONSTRAINT ideas_pdf_attachment_size_v14_check
      CHECK (
        pdf_attachment_size IS NULL
        OR (pdf_attachment_size > 0 AND pdf_attachment_size <= 10485760)
      );
  END IF;
END $$;

-- Private bucket. Files are never exposed with a permanent public URL.
-- Uploads use short-lived signed upload URLs issued by the application server.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'idea-pdfs',
  'idea-pdfs',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON COLUMN public.ideas.pdf_attachment_path IS
  'V14: private Supabase Storage path for a real PDF reference file';
COMMENT ON COLUMN public.ideas.pdf_attachment_name IS
  'V14: original PDF display name; server redacts it for non-authors to protect anonymity';
COMMENT ON COLUMN public.ideas.pdf_attachment_size IS
  'V14: PDF size in bytes; max 10 MiB';

COMMIT;


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

-- =============================================================================
-- WHYNOT V16: 2차 점수 경계 동점 결선 + 출시 직전 교착 방지
--
-- 운영 적용: 이 forward migration만 실행한다.
-- supabase_master_migration_full.sql 은 운영 DB에 실행하지 않는다.
-- =============================================================================

BEGIN;

-- 1) 2차 SCORE_ONLY 4위 경계 결선 상태를 영속화한다.
CREATE TABLE IF NOT EXISTS public.score_boundary_runoffs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  candidate_idea_ids TEXT[] NOT NULL,
  remaining_slots INT NOT NULL,
  guaranteed_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  eligible_voter_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'VOTING',
  source_reason TEXT NOT NULL,
  resolution_method TEXT NULL,
  selected_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  random_selected_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  result_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT score_boundary_runoffs_round_room_fk
    FOREIGN KEY (round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT score_boundary_runoffs_candidate_count_check
    CHECK (CARDINALITY(candidate_idea_ids) >= 2),
  CONSTRAINT score_boundary_runoffs_remaining_slots_check
    CHECK (remaining_slots >= 1 AND remaining_slots < CARDINALITY(candidate_idea_ids)),
  CONSTRAINT score_boundary_runoffs_status_check
    CHECK (status IN ('VOTING', 'COMPLETED')),
  CONSTRAINT score_boundary_runoffs_source_reason_check
    CHECK (source_reason IN ('AI_INSUFFICIENT_EVIDENCE', 'AI_UNAVAILABLE')),
  CONSTRAINT score_boundary_runoffs_resolution_method_check
    CHECK (resolution_method IS NULL OR resolution_method IN ('USER_RUNOFF', 'RUNOFF_RANDOM', 'AUTO_RANDOM')),
  CONSTRAINT score_boundary_runoffs_deadline_check
    CHECK (deadline_at >= started_at),
  UNIQUE (room_id, round_id),
  UNIQUE (id, room_id)
);

CREATE TABLE IF NOT EXISTS public.score_boundary_runoff_ballots (
  id TEXT PRIMARY KEY,
  runoff_id TEXT NOT NULL,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selected_idea_ids TEXT[] NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT score_boundary_runoff_ballots_runoff_room_fk
    FOREIGN KEY (runoff_id, room_id)
    REFERENCES public.score_boundary_runoffs(id, room_id)
    ON DELETE CASCADE,
  CONSTRAINT score_boundary_runoff_ballots_member_fk
    FOREIGN KEY (room_id, user_id)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT score_boundary_runoff_ballots_nonempty_check
    CHECK (CARDINALITY(selected_idea_ids) >= 1),
  UNIQUE (runoff_id, user_id)
);

CREATE INDEX IF NOT EXISTS score_boundary_runoffs_room_round_idx
  ON public.score_boundary_runoffs(room_id, round_id, status);
CREATE INDEX IF NOT EXISTS score_boundary_runoff_ballots_runoff_idx
  ON public.score_boundary_runoff_ballots(runoff_id, submitted_at);

ALTER TABLE public.score_boundary_runoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_boundary_runoff_ballots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.score_boundary_runoffs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.score_boundary_runoff_ballots FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.score_boundary_runoffs TO service_role;
GRANT ALL ON public.score_boundary_runoff_ballots TO service_role;

-- V9 state_version 트리거 패턴을 새 결선 테이블에도 동일하게 적용한다.
DROP TRIGGER IF EXISTS score_boundary_runoffs_bump_room_v16 ON public.score_boundary_runoffs;
CREATE TRIGGER score_boundary_runoffs_bump_room_v16
AFTER INSERT OR UPDATE OR DELETE ON public.score_boundary_runoffs
FOR EACH ROW EXECUTE FUNCTION public.bump_parent_room_state_version_v9('room_id');

DROP TRIGGER IF EXISTS score_boundary_runoff_ballots_bump_room_v16 ON public.score_boundary_runoff_ballots;
CREATE TRIGGER score_boundary_runoff_ballots_bump_room_v16
AFTER INSERT OR UPDATE OR DELETE ON public.score_boundary_runoff_ballots
FOR EACH ROW EXECUTE FUNCTION public.bump_parent_room_state_version_v9('room_id');

-- 2) 중립 참여자의 결선표를 한 번만 저장한다.
CREATE OR REPLACE FUNCTION public.submit_score_boundary_runoff_ballot_v16(
  p_room_id TEXT,
  p_runoff_id TEXT,
  p_user_id TEXT,
  p_selected_idea_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_runoff public.score_boundary_runoffs%ROWTYPE;
  v_selected_count INT;
BEGIN
  SELECT * INTO v_runoff
  FROM public.score_boundary_runoffs
  WHERE id = p_runoff_id AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '동점 결선을 찾을 수 없습니다.';
  END IF;
  IF v_runoff.status <> 'VOTING' THEN
    RAISE EXCEPTION '이미 종료된 동점 결선입니다.';
  END IF;
  IF NOW() >= v_runoff.deadline_at THEN
    RAISE EXCEPTION '동점 결선 투표 시간이 종료되었습니다.';
  END IF;
  IF NOT (p_user_id = ANY(v_runoff.eligible_voter_ids)) THEN
    RAISE EXCEPTION '동점 후보의 작성자는 중립 결선 투표에 참여할 수 없습니다.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.evaluation_round_participants participant
    WHERE participant.room_id = p_room_id
      AND participant.round_id = v_runoff.round_id
      AND participant.user_id = p_user_id
      AND participant.is_required = TRUE
  ) THEN
    RAISE EXCEPTION '2차 평가 참여자 스냅샷에 포함되지 않은 사용자입니다.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.ideas idea
    WHERE idea.room_id = p_room_id
      AND idea.id = ANY(v_runoff.candidate_idea_ids)
      AND idea.submitter_id = p_user_id
  ) THEN
    RAISE EXCEPTION '동점 후보 작성자는 중립 결선 투표에 참여할 수 없습니다.';
  END IF;

  v_selected_count := COALESCE(CARDINALITY(p_selected_idea_ids), 0);
  IF v_selected_count <> v_runoff.remaining_slots THEN
    RAISE EXCEPTION '남은 자리 수와 선택한 후보 수가 일치하지 않습니다.';
  END IF;
  IF v_selected_count <> (
    SELECT COUNT(DISTINCT item) FROM UNNEST(COALESCE(p_selected_idea_ids, ARRAY[]::TEXT[])) item
  ) THEN
    RAISE EXCEPTION '같은 후보를 중복 선택할 수 없습니다.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM UNNEST(COALESCE(p_selected_idea_ids, ARRAY[]::TEXT[])) item
    WHERE NOT item = ANY(v_runoff.candidate_idea_ids)
  ) THEN
    RAISE EXCEPTION '현재 동점 결선 후보가 아닌 아이디어가 포함되어 있습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.score_boundary_runoff_ballots
    WHERE runoff_id = p_runoff_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '동점 결선 투표는 이미 제출되었습니다.';
  END IF;

  INSERT INTO public.score_boundary_runoff_ballots(
    id, runoff_id, room_id, user_id, selected_idea_ids, submitted_at
  ) VALUES (
    p_runoff_id || ':' || p_user_id,
    p_runoff_id,
    p_room_id,
    p_user_id,
    p_selected_idea_ids,
    NOW()
  );

  RETURN jsonb_build_object('success', TRUE, 'submitted', TRUE);
END;
$$;

-- 3) 서버에서 계산한 결선 결과를 단 한 번만 확정한다.
-- 동시 요청이 들어와도 최초 확정 결과를 그대로 반환해 무작위 재추첨을 막는다.
CREATE OR REPLACE FUNCTION public.finalize_score_boundary_runoff_v16(
  p_room_id TEXT,
  p_round_id TEXT,
  p_runoff_id TEXT,
  p_selected_idea_ids TEXT[],
  p_random_selected_idea_ids TEXT[],
  p_resolution_method TEXT,
  p_result_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_runoff public.score_boundary_runoffs%ROWTYPE;
  v_selected_count INT;
  v_random_count INT;
BEGIN
  SELECT * INTO v_runoff
  FROM public.score_boundary_runoffs
  WHERE id = p_runoff_id
    AND room_id = p_room_id
    AND round_id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '동점 결선을 찾을 수 없습니다.';
  END IF;
  IF v_runoff.status = 'COMPLETED' THEN
    RETURN to_jsonb(v_runoff);
  END IF;
  IF p_resolution_method NOT IN ('USER_RUNOFF', 'RUNOFF_RANDOM', 'AUTO_RANDOM') THEN
    RAISE EXCEPTION '지원하지 않는 동점 결선 확정 방식입니다.';
  END IF;

  v_selected_count := COALESCE(CARDINALITY(p_selected_idea_ids), 0);
  v_random_count := COALESCE(CARDINALITY(p_random_selected_idea_ids), 0);
  IF v_selected_count <> v_runoff.remaining_slots THEN
    RAISE EXCEPTION '결선 확정 후보 수가 남은 자리 수와 일치하지 않습니다.';
  END IF;
  IF v_selected_count <> (
    SELECT COUNT(DISTINCT item) FROM UNNEST(COALESCE(p_selected_idea_ids, ARRAY[]::TEXT[])) item
  ) THEN
    RAISE EXCEPTION '결선 확정 후보가 중복되어 있습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM UNNEST(COALESCE(p_selected_idea_ids, ARRAY[]::TEXT[])) item
    WHERE NOT item = ANY(v_runoff.candidate_idea_ids)
  ) THEN
    RAISE EXCEPTION '결선 확정 후보가 현재 경계 후보와 일치하지 않습니다.';
  END IF;
  IF v_random_count <> (
    SELECT COUNT(DISTINCT item) FROM UNNEST(COALESCE(p_random_selected_idea_ids, ARRAY[]::TEXT[])) item
  ) THEN
    RAISE EXCEPTION '무작위 확정 후보가 중복되어 있습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM UNNEST(COALESCE(p_random_selected_idea_ids, ARRAY[]::TEXT[])) item
    WHERE NOT item = ANY(p_selected_idea_ids)
  ) THEN
    RAISE EXCEPTION '무작위 확정 후보는 최종 선택 후보의 부분집합이어야 합니다.';
  END IF;
  IF p_resolution_method = 'USER_RUNOFF' AND v_random_count <> 0 THEN
    RAISE EXCEPTION '일반 결선 결과에는 무작위 확정 후보가 포함될 수 없습니다.';
  END IF;
  IF p_resolution_method = 'RUNOFF_RANDOM' AND v_random_count < 1 THEN
    RAISE EXCEPTION '재동점 무작위 확정에는 최소 1개의 무작위 후보가 필요합니다.';
  END IF;
  IF p_resolution_method = 'AUTO_RANDOM' AND v_random_count <> v_runoff.remaining_slots THEN
    RAISE EXCEPTION '자동 무작위 확정은 남은 자리 전체를 무작위로 결정해야 합니다.';
  END IF;

  UPDATE public.score_boundary_runoffs
  SET status = 'COMPLETED',
      resolution_method = p_resolution_method,
      selected_idea_ids = p_selected_idea_ids,
      random_selected_idea_ids = COALESCE(p_random_selected_idea_ids, ARRAY[]::TEXT[]),
      result_snapshot = COALESCE(p_result_snapshot, '{}'::JSONB),
      completed_at = NOW()
  WHERE id = p_runoff_id AND room_id = p_room_id
  RETURNING * INTO v_runoff;

  RETURN to_jsonb(v_runoff);
END;
$$;

-- 4) 기존 V7 apply 함수는 AWAITING_AI에서 AI 보고서를 반드시 요구한다.
-- V16 결선 완료 시에는 저장된 결선만 검증해서 동일한 2차 결과를 원자적으로 적용한다.
CREATE OR REPLACE FUNCTION public.apply_score_boundary_runoff_result_v16(
  p_room_id TEXT,
  p_round_id TEXT,
  p_runoff_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.evaluation_rounds%ROWTYPE;
  v_runoff public.score_boundary_runoffs%ROWTYPE;
  v_snapshot JSONB;
  v_candidate_ids TEXT[] := ARRAY[]::TEXT[];
  v_guaranteed_ids TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_survivor_ids TEXT[] := ARRAY[]::TEXT[];
  v_eliminated_ids TEXT[] := ARRAY[]::TEXT[];
  v_score_stats_with_outcome JSONB := '{}'::JSONB;
  v_expected_survivor_count INT;
  v_missing_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_round
  FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '2차 점수 평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN RETURN v_round.result_snapshot; END IF;
  IF v_round.evaluation_method <> 'SCORE_ONLY' OR v_round.stage <> 'EVALUATION' THEN
    RAISE EXCEPTION '2차 SCORE_ONLY 평가 회차만 결선 결과를 적용할 수 있습니다.';
  END IF;

  SELECT * INTO v_runoff
  FROM public.score_boundary_runoffs
  WHERE id = p_runoff_id
    AND room_id = p_room_id
    AND round_id = p_round_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '동점 결선을 찾을 수 없습니다.'; END IF;
  IF v_runoff.status <> 'COMPLETED' THEN RAISE EXCEPTION '아직 완료되지 않은 동점 결선입니다.'; END IF;

  v_snapshot := COALESCE(v_round.result_snapshot, '{}'::JSONB);
  IF COALESCE(v_snapshot->>'aggregationStatus', '') <> 'AWAITING_AI'
     OR NOT COALESCE((v_snapshot->>'aiTiebreakRequired')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION '현재 2차 점수 회차가 경계 동점 결선 대기 상태가 아닙니다.';
  END IF;

  v_candidate_ids := ARRAY(
    SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_snapshot->'candidateIdeaIds', '[]'::JSONB))
  );
  v_guaranteed_ids := ARRAY(
    SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_snapshot->'guaranteedSurvivorIdeaIds', '[]'::JSONB))
  );
  v_boundary_ids := ARRAY(
    SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_snapshot->'boundaryTieIdeaIds', '[]'::JSONB))
  );

  -- Runoff가 원래 2차 집계 경계와 정확히 같은지 검증한다.
  IF COALESCE((v_snapshot->>'remainingSlots')::INT, 0) <> v_runoff.remaining_slots THEN
    RAISE EXCEPTION '결선 남은 자리 수가 2차 집계 스냅샷과 일치하지 않습니다.';
  END IF;
  IF CARDINALITY(v_runoff.candidate_idea_ids) <> CARDINALITY(v_boundary_ids)
     OR EXISTS (
       SELECT 1 FROM UNNEST(v_runoff.candidate_idea_ids) item
       WHERE NOT item = ANY(v_boundary_ids)
     )
     OR EXISTS (
       SELECT 1 FROM UNNEST(v_boundary_ids) item
       WHERE NOT item = ANY(v_runoff.candidate_idea_ids)
     ) THEN
    RAISE EXCEPTION '결선 후보가 2차 점수 경계 후보와 일치하지 않습니다.';
  END IF;
  IF CARDINALITY(v_runoff.guaranteed_idea_ids) <> CARDINALITY(v_guaranteed_ids)
     OR EXISTS (
       SELECT 1 FROM UNNEST(v_runoff.guaranteed_idea_ids) item
       WHERE NOT item = ANY(v_guaranteed_ids)
     )
     OR EXISTS (
       SELECT 1 FROM UNNEST(v_guaranteed_ids) item
       WHERE NOT item = ANY(v_runoff.guaranteed_idea_ids)
     ) THEN
    RAISE EXCEPTION '결선 확정 전 보장 진출 후보가 집계 스냅샷과 일치하지 않습니다.';
  END IF;

  IF CARDINALITY(v_runoff.selected_idea_ids) <> v_runoff.remaining_slots
     OR CARDINALITY(v_runoff.selected_idea_ids) <> (
       SELECT COUNT(DISTINCT item) FROM UNNEST(v_runoff.selected_idea_ids) item
     )
     OR EXISTS (
       SELECT 1 FROM UNNEST(v_runoff.selected_idea_ids) item
       WHERE NOT item = ANY(v_boundary_ids)
     ) THEN
    RAISE EXCEPTION '완료된 결선의 선택 후보가 유효하지 않습니다.';
  END IF;

  v_survivor_ids := v_guaranteed_ids || v_runoff.selected_idea_ids;
  IF CARDINALITY(v_survivor_ids) <> (
    SELECT COUNT(DISTINCT item) FROM UNNEST(v_survivor_ids) item
  ) THEN
    RAISE EXCEPTION '최종 진출 후보에 중복이 포함되어 있습니다.';
  END IF;
  v_expected_survivor_count := LEAST(CARDINALITY(v_candidate_ids), 4);
  IF CARDINALITY(v_survivor_ids) <> v_expected_survivor_count THEN
    RAISE EXCEPTION '결선 이후 최종 후보 수가 최대 4개 정책과 일치하지 않습니다.';
  END IF;

  -- 집계 준비 후 필수 제출이나 점수 행이 바뀌지 않았는지 적용 직전에 재검증한다.
  SELECT COUNT(*) INTO v_missing_count
  FROM public.evaluation_round_participants participant
  CROSS JOIN public.round_candidates candidate
  JOIN public.ideas idea ON idea.id = candidate.idea_id AND idea.room_id = candidate.room_id
  WHERE participant.round_id = p_round_id
    AND participant.room_id = p_room_id
    AND participant.is_required = TRUE
    AND participant.submission_status = 'FINAL'
    AND candidate.round_id = p_round_id
    AND candidate.room_id = p_room_id
    AND candidate.outcome = 'ACTIVE'
    AND idea.submitter_id <> participant.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.evaluations evaluation
      WHERE evaluation.round_id = p_round_id
        AND evaluation.room_id = p_room_id
        AND evaluation.evaluator_id = participant.user_id
        AND evaluation.idea_id = candidate.idea_id
        AND evaluation.overall_score BETWEEN 1 AND 10
    );
  v_missing_count := v_missing_count + (
    SELECT COUNT(*) FROM public.evaluation_round_participants
    WHERE round_id = p_round_id
      AND room_id = p_room_id
      AND is_required = TRUE
      AND submission_status <> 'FINAL'
  );
  IF v_missing_count > 0 THEN
    RAISE EXCEPTION '모든 필수 2차 평가가 FINAL 상태가 아닙니다.';
  END IF;

  v_eliminated_ids := ARRAY(
    SELECT item FROM UNNEST(v_candidate_ids) item WHERE NOT item = ANY(v_survivor_ids)
  );

  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(v_survivor_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
    eliminated_round = CASE WHEN id = ANY(v_eliminated_ids) THEN v_round.round_number ELSE NULL END
  WHERE room_id = p_room_id AND id = ANY(v_candidate_ids);

  UPDATE public.round_candidates SET
    outcome = CASE WHEN idea_id = ANY(v_survivor_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
  WHERE room_id = p_room_id AND round_id = p_round_id;

  SELECT JSONB_OBJECT_AGG(
    entry.key,
    entry.value || jsonb_build_object('survived', entry.key = ANY(v_survivor_ids))
  ) INTO v_score_stats_with_outcome
  FROM JSONB_EACH(COALESCE(v_snapshot->'scoreStats', '{}'::JSONB)) entry;

  v_snapshot := v_snapshot || jsonb_build_object(
    'aggregationStatus', 'COMPLETED',
    'survivorIdeaIds', v_survivor_ids,
    'eliminatedIdeaIds', v_eliminated_ids,
    'actualSurvivorCount', CARDINALITY(v_survivor_ids),
    'aiTiebreak', jsonb_build_object('used', FALSE),
    'boundaryRunoff', jsonb_build_object(
      'used', TRUE,
      'sourceReason', v_runoff.source_reason,
      'candidateIdeaIds', v_runoff.candidate_idea_ids,
      'remainingSlots', v_runoff.remaining_slots,
      'selectedIdeaIds', v_runoff.selected_idea_ids,
      'randomSelectedIdeaIds', v_runoff.random_selected_idea_ids,
      'resolutionMethod', v_runoff.resolution_method,
      'startedAt', v_runoff.started_at,
      'completedAt', v_runoff.completed_at
    ),
    'scoreStats', COALESCE(v_score_stats_with_outcome, '{}'::JSONB),
    'completedAt', v_now
  );

  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED',
    aggregation_status = 'COMPLETED',
    completed_at = v_now,
    result_snapshot = v_snapshot,
    results_revealed_at = COALESCE(results_revealed_at, v_now),
    locked_at = COALESCE(locked_at, v_now)
  WHERE id = p_round_id AND room_id = p_room_id;

  UPDATE public.rooms SET
    status = 'ELIMINATION',
    final_vote_status = 'NOT_STARTED',
    current_round_id = NULL,
    tie_candidate_idea_ids = ARRAY[]::TEXT[],
    tie_slots = 0
  WHERE id = p_room_id;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_score_boundary_runoff_ballot_v16(TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_score_boundary_runoff_v16(TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_score_boundary_runoff_result_v16(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_score_boundary_runoff_ballot_v16(TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_score_boundary_runoff_v16(TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_score_boundary_runoff_result_v16(TEXT, TEXT, TEXT) TO service_role;

COMMIT;
