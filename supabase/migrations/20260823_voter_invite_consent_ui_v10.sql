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
