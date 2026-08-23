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
