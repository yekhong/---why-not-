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
