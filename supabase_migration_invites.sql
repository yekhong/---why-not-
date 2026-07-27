-- ============================================================
-- WHY NOT (고민하조) Supabase Migration Script
-- Database-backed 3-Minute Expiring Invites & Atomic Joining
-- ============================================================

-- 1. Create room_invites table
CREATE TABLE IF NOT EXISTS public.room_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    invite_token TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_room_invites_token ON public.room_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_room_invites_room_id ON public.room_invites(room_id);

-- 3. Add Unique Constraint on participants to prevent duplicate joins
ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS unique_room_participant;
ALTER TABLE public.participants ADD CONSTRAINT unique_room_participant UNIQUE (room_id, user_id);

-- 4. Enable RLS on room_invites
ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for room_invites
DROP POLICY IF EXISTS "Anyone can select active room invites" ON public.room_invites;
CREATE POLICY "Anyone can select active room invites" ON public.room_invites FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert room invites" ON public.room_invites;
CREATE POLICY "Anyone can insert room invites" ON public.room_invites FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update room invites" ON public.room_invites;
CREATE POLICY "Anyone can update room invites" ON public.room_invites FOR UPDATE USING (true);

-- ============================================================
-- RPC FUNCTIONS FOR ATOMIC INVITE & JOIN OPERATIONS
-- ============================================================

-- A. Create / Refresh 3-Minute Invite Token (Deactivates older tokens for room)
CREATE OR REPLACE FUNCTION public.create_room_invite(
    p_room_id TEXT,
    p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token TEXT;
    v_invite public.room_invites%ROWTYPE;
BEGIN
    -- Deactivate all existing invites for this room
    UPDATE public.room_invites
    SET is_active = false
    WHERE room_id = p_room_id AND is_active = true;

    -- Generate a new secure random token (e.g. inv_xxxxxxxx)
    v_token := 'inv_' || encode(gen_random_bytes(9), 'hex');

    -- Insert new invite with EXACT 3 MINUTES expiration from current DB time
    INSERT INTO public.room_invites (
        room_id,
        invite_token,
        created_by,
        expires_at,
        is_active
    ) VALUES (
        p_room_id,
        v_token,
        p_user_id,
        NOW() + INTERVAL '3 minutes',
        true
    )
    RETURNING * INTO v_invite;

    RETURN jsonb_build_object(
        'success', true,
        'invite_token', v_invite.invite_token,
        'expires_at', v_invite.expires_at,
        'created_at', v_invite.created_at,
        'is_active', v_invite.is_active
    );
END;
$$;


-- B. Deactivate Invite Token
CREATE OR REPLACE FUNCTION public.deactivate_room_invite(
    p_room_id TEXT,
    p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.room_invites
    SET is_active = false
    WHERE room_id = p_room_id AND is_active = true;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- C. Get Invite Details & Strictly Verify Expiration / Capacity
CREATE OR REPLACE FUNCTION public.get_invite_details(
    p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite public.room_invites%ROWTYPE;
    v_room public.rooms%ROWTYPE;
    v_host_nickname TEXT;
    v_participant_count INTEGER;
BEGIN
    -- Fetch invite record
    SELECT * INTO v_invite
    FROM public.room_invites
    WHERE invite_token = p_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_valid', false, 'error_code', 'NOT_FOUND', 'error_message', '존재하지 않는 초대 링크입니다.');
    END IF;

    IF NOT v_invite.is_active THEN
        RETURN jsonb_build_object('is_valid', false, 'error_code', 'DEACTIVATED', 'error_message', '방장에 의해 비활성화된 초대 링크입니다.');
    END IF;

    -- Strict DB-time check for 3-minute expiration
    IF v_invite.expires_at <= NOW() THEN
        RETURN jsonb_build_object('is_valid', false, 'error_code', 'EXPIRED', 'error_message', '생성된 지 3분이 지나 만료된 초대 링크입니다.');
    END IF;

    -- Fetch room record
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = v_invite.room_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_valid', false, 'error_code', 'ROOM_DELETED', 'error_message', '삭제된 회의실입니다.');
    END IF;

    IF v_room.status = 'CLOSED' THEN
        RETURN jsonb_build_object('is_valid', false, 'error_code', 'ROOM_CLOSED', 'error_message', '이미 종료된 회의실입니다.');
    END IF;

    -- Get participant count
    SELECT COUNT(*) INTO v_participant_count
    FROM public.participants
    WHERE room_id = v_room.id;

    -- Get host nickname
    SELECT nickname INTO v_host_nickname
    FROM public.participants
    WHERE room_id = v_room.id AND user_id = v_room.host_id
    LIMIT 1;

    IF v_host_nickname IS NULL THEN
        v_host_nickname := '방장';
    END IF;

    RETURN jsonb_build_object(
        'is_valid', true,
        'room', jsonb_build_object(
            'id', v_room.id,
            'title', v_room.title,
            'description', v_room.description,
            'category', v_room.category,
            'is_public', v_room.is_public,
            'max_participants', v_room.max_participants,
            'status', v_room.status,
            'host_id', v_room.host_id
        ),
        'host_nickname', v_host_nickname,
        'participant_count', v_participant_count,
        'max_participants', v_room.max_participants,
        'expires_at', v_invite.expires_at,
        'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (v_invite.expires_at - NOW())))::INTEGER
    );
END;
$$;


-- D. Atomic Join Function (Concurrency Lock & Strict 3-min Verification at click time)
CREATE OR REPLACE FUNCTION public.join_room_via_invite(
    p_token TEXT,
    p_user_id TEXT,
    p_nickname TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite public.room_invites%ROWTYPE;
    v_room public.rooms%ROWTYPE;
    v_current_count INTEGER;
    v_is_already_member BOOLEAN;
BEGIN
    -- 1. Lock invite row
    SELECT * INTO v_invite
    FROM public.room_invites
    WHERE invite_token = p_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '존재하지 않는 초대 링크입니다.';
    END IF;

    IF NOT v_invite.is_active THEN
        RAISE EXCEPTION '비활성화된 초대 링크입니다.';
    END IF;

    -- Re-verify strict 3-minute expiration AT THE EXACT CLICK MOMENT
    IF v_invite.expires_at <= NOW() THEN
        RAISE EXCEPTION '생성된 지 3분이 지나 만료된 초대 링크입니다.';
    END IF;

    -- 2. Lock room row
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = v_invite.room_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '삭제된 회의실입니다.';
    END IF;

    IF v_room.status = 'CLOSED' THEN
        RAISE EXCEPTION '이미 종료된 회의실입니다.';
    END IF;

    -- 3. Check if user is already a member
    SELECT EXISTS(
        SELECT 1 FROM public.participants
        WHERE room_id = v_room.id AND user_id = p_user_id
    ) INTO v_is_already_member;

    IF v_is_already_member THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_member', true,
            'room_id', v_room.id,
            'message', '이미 참가해 있는 회의실입니다.'
        );
    END IF;

    -- 4. Check current participant count atomically
    SELECT COUNT(*) INTO v_current_count
    FROM public.participants
    WHERE room_id = v_room.id;

    IF v_current_count >= v_room.max_participants THEN
        RAISE EXCEPTION '최대 참가 가능 인원(%명)이 차서 참가할 수 없습니다.', v_room.max_participants;
    END IF;

    -- 5. Insert participant record atomically
    INSERT INTO public.participants (room_id, user_id, nickname)
    VALUES (v_room.id, p_user_id, COALESCE(p_nickname, '참여자'))
    ON CONFLICT (room_id, user_id) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'already_member', false,
        'room_id', v_room.id,
        'message', '회의실에 참가가 완료되었습니다.'
    );
END;
$$;
