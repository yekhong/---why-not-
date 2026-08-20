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
