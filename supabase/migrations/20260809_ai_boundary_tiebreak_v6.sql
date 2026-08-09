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
