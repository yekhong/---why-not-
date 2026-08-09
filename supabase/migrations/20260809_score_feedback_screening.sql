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
