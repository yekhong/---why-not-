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

-- Permissive public policies for app interaction
DROP POLICY IF EXISTS "Public access on rooms" ON public.rooms;

CREATE POLICY "Public access on rooms" ON public.rooms FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on participants" ON public.participants;

CREATE POLICY "Public access on participants" ON public.participants FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on ideas" ON public.ideas;

CREATE POLICY "Public access on ideas" ON public.ideas FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on criteria" ON public.criteria;

CREATE POLICY "Public access on criteria" ON public.criteria FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on criterion_proposals" ON public.criterion_proposals;

CREATE POLICY "Public access on criterion_proposals" ON public.criterion_proposals FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on evaluations" ON public.evaluations;

CREATE POLICY "Public access on evaluations" ON public.evaluations FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on room_invites" ON public.room_invites;

CREATE POLICY "Public access on room_invites" ON public.room_invites FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on phase_completions" ON public.phase_completions;

CREATE POLICY "Public access on phase_completions" ON public.phase_completions FOR ALL USING (true);

DROP POLICY IF EXISTS "Public access on room_phase_participants" ON public.room_phase_participants;

CREATE POLICY "Public access on room_phase_participants" ON public.room_phase_participants FOR ALL USING (true);

COMMIT;