-- ============================================================
-- WHY NOT (고민하조) Supabase Migration Script
-- Role & Author-Based Evaluation Criteria Edit/Delete Security
-- ============================================================

-- 1. Add source_type and updated_at columns if not exist
ALTER TABLE public.criterion_proposals ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'user';
ALTER TABLE public.criterion_proposals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Add Index for room_id and proposer_id
CREATE INDEX IF NOT EXISTS idx_criterion_proposals_room_id ON public.criterion_proposals(room_id);
CREATE INDEX IF NOT EXISTS idx_criterion_proposals_proposer_id ON public.criterion_proposals(proposer_id);

-- ============================================================
-- RLS POLICIES FOR CRITERION PROPOSALS
-- ============================================================
ALTER TABLE public.criterion_proposals ENABLE ROW LEVEL SECURITY;

-- SELECT Policy: Anyone can select proposals
DROP POLICY IF EXISTS "Anyone can select proposals" ON public.criterion_proposals;
CREATE POLICY "Anyone can select proposals" ON public.criterion_proposals
FOR SELECT USING (true);

-- INSERT Policy: Anyone can insert proposals
DROP POLICY IF EXISTS "Anyone can insert proposals" ON public.criterion_proposals;
CREATE POLICY "Anyone can insert proposals" ON public.criterion_proposals
FOR INSERT WITH CHECK (true);

-- UPDATE Policy: Host or Author can update proposal
DROP POLICY IF EXISTS "Host or Author can update proposals" ON public.criterion_proposals;
CREATE POLICY "Host or Author can update proposals" ON public.criterion_proposals
FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = room_id AND (r.host_id = auth.uid()::text OR r.host_id = current_setting('request.jwt.claims', true)::json->>'sub')
    ) OR (
        proposer_id = auth.uid()::text AND COALESCE(source_type, 'user') = 'user'
    )
)
WITH CHECK (
    -- Prevent altering room_id, proposer_id or source_type
    room_id = OLD.room_id AND proposer_id = OLD.proposer_id AND COALESCE(source_type, 'user') = COALESCE(OLD.source_type, 'user')
);

-- DELETE Policy: Host or Author can delete proposal
DROP POLICY IF EXISTS "Host or Author can delete proposals" ON public.criterion_proposals;
CREATE POLICY "Host or Author can delete proposals" ON public.criterion_proposals
FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = room_id AND (r.host_id = auth.uid()::text OR r.host_id = current_setting('request.jwt.claims', true)::json->>'sub')
    ) OR (
        proposer_id = auth.uid()::text AND COALESCE(source_type, 'user') = 'user'
    )
);

-- ============================================================
-- POSTGRESQL RPC FUNCTIONS FOR ATOMIC EDIT & DELETE
-- ============================================================

-- A. Update Proposal Function
CREATE OR REPLACE FUNCTION public.update_criterion_proposal(
    p_proposal_id TEXT,
    p_new_text TEXT,
    p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proposal public.criterion_proposals%ROWTYPE;
    v_room_host_id TEXT;
    v_trimmed_text TEXT;
BEGIN
    v_trimmed_text := TRIM(p_new_text);
    IF v_trimmed_text = '' THEN
        RAISE EXCEPTION '평가 기준 내용을 입력해 주세요.';
    END IF;

    -- Fetch proposal
    SELECT * INTO v_proposal
    FROM public.criterion_proposals
    WHERE id = p_proposal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '존재하지 않거나 이미 삭제된 평가 기준입니다.';
    END IF;

    -- Fetch room host_id
    SELECT host_id INTO v_room_host_id
    FROM public.rooms
    WHERE id = v_proposal.room_id;

    -- Check permissions: Host or (Author and not AI)
    IF p_user_id != v_room_host_id AND (v_proposal.proposer_id != p_user_id OR COALESCE(v_proposal.source_type, 'user') = 'ai' OR v_proposal.proposer_id = 'ai') THEN
        RAISE EXCEPTION '이 평가 기준을 수정할 권한이 없습니다.';
    END IF;

    -- Perform update
    UPDATE public.criterion_proposals
    SET raw_text = v_trimmed_text,
        updated_at = NOW()
    WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', '평가 기준이 성공적으로 수정되었습니다.',
        'proposal_id', p_proposal_id,
        'raw_text', v_trimmed_text
    );
END;
$$;


-- B. Delete Proposal Function
CREATE OR REPLACE FUNCTION public.delete_criterion_proposal(
    p_proposal_id TEXT,
    p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proposal public.criterion_proposals%ROWTYPE;
    v_room_host_id TEXT;
BEGIN
    -- Fetch proposal
    SELECT * INTO v_proposal
    FROM public.criterion_proposals
    WHERE id = p_proposal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '존재하지 않거나 이미 삭제된 평가 기준입니다.';
    END IF;

    -- Fetch room host_id
    SELECT host_id INTO v_room_host_id
    FROM public.rooms
    WHERE id = v_proposal.room_id;

    -- Check permissions: Host or (Author and not AI)
    IF p_user_id != v_room_host_id AND (v_proposal.proposer_id != p_user_id OR COALESCE(v_proposal.source_type, 'user') = 'ai' OR v_proposal.proposer_id = 'ai') THEN
        RAISE EXCEPTION '이 평가 기준을 삭제할 권한이 없습니다.';
    END IF;

    -- Perform delete
    DELETE FROM public.criterion_proposals
    WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', '평가 기준이 성공적으로 삭제되었습니다.',
        'proposal_id', p_proposal_id
    );
END;
$$;

-- C. Propose Criterion with Max 21 Limit Function (Atomic Concurrency Lock)
CREATE OR REPLACE FUNCTION public.propose_criterion_with_limit(
    p_room_id TEXT,
    p_raw_text TEXT,
    p_user_id TEXT,
    p_source_type TEXT DEFAULT 'user'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_count INTEGER;
    v_trimmed_text TEXT;
    v_new_id TEXT;
BEGIN
    v_trimmed_text := TRIM(p_raw_text);
    IF v_trimmed_text = '' THEN
        RAISE EXCEPTION '제안할 기준 내용을 입력해 주세요.';
    END IF;

    -- Lock room rows for transaction concurrency validation
    PERFORM 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE;

    -- Count active proposals for this room
    SELECT COUNT(*) INTO v_current_count
    FROM public.criterion_proposals
    WHERE room_id = p_room_id;

    IF v_current_count >= 21 THEN
        RAISE EXCEPTION '평가 기준은 최대 21개까지 등록할 수 있습니다.';
    END IF;

    v_new_id := 'prop-' || SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 9);

    INSERT INTO public.criterion_proposals (id, room_id, raw_text, proposer_id, source_type, created_at)
    VALUES (v_new_id, p_room_id, v_trimmed_text, p_user_id, COALESCE(p_source_type, 'user'), NOW());

    RETURN jsonb_build_object(
        'success', true,
        'message', '평가 기준이 성공적으로 제안되었습니다.',
        'proposal_id', v_new_id,
        'count', v_current_count + 1
    );
END;
$$;
