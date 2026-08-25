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
