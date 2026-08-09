-- =============================================================================
-- WhyNot V7: 1차 최대 8개 / 2차 최대 4개 / 별 3개 누적 최종 투표
--
-- 기존 V1~V6 데이터와 테이블은 보존한다. 새 구조화/빠른 결정 회의실만 V7을 사용한다.
-- =============================================================================

BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS current_final_vote_cycle_id TEXT NULL;

ALTER TABLE public.rooms
  ALTER COLUMN engine_version SET DEFAULT 7;

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_final_vote_status_check;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_final_vote_status_check
  CHECK (final_vote_status IN (
    'NOT_STARTED', 'VOTING', 'TIE_PENDING', 'CONSENT_PENDING',
    'ROULETTE_PENDING', 'FINALIZED'
  ));

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS winner_selection_method TEXT NULL;

ALTER TABLE public.ideas
  DROP CONSTRAINT IF EXISTS ideas_winner_selection_method_check;

ALTER TABLE public.ideas
  ADD CONSTRAINT ideas_winner_selection_method_check
  CHECK (winner_selection_method IS NULL OR winner_selection_method IN (
    'CUMULATIVE_STAR', 'ROULETTE', 'AUTO_ALL'
  ));

ALTER TABLE public.evaluation_rounds
  DROP CONSTRAINT IF EXISTS evaluation_rounds_method_check;

ALTER TABLE public.evaluation_rounds
  ADD CONSTRAINT evaluation_rounds_method_check
  CHECK (evaluation_method IN ('LEGACY', 'SCORE_FEEDBACK', 'SCORE_ONLY'));

-- V5의 기존 CHECK는 모든 점수 행에 피드백을 강제하므로 2차 SCORE_ONLY와 충돌한다.
-- 1차 피드백 필수 여부는 아래 집계 RPC가 회차 방식과 함께 검증한다.
ALTER TABLE public.evaluations
  DROP CONSTRAINT IF EXISTS evaluations_score_feedback_check;

ALTER TABLE public.evaluations
  ADD CONSTRAINT evaluations_score_feedback_check
  CHECK (feedback_text IS NULL OR CHAR_LENGTH(feedback_text) <= 500);

-- 1차와 2차 모두 전체 집계가 시작되기 전에는 제출자가 자신의 FINAL
-- 제출을 DRAFT로 되돌려 수정할 수 있다. 기존 스냅샷 신원은 그대로 잠근다.
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
    SELECT status INTO v_round_status
    FROM public.evaluation_rounds
    WHERE id = OLD.round_id AND room_id = OLD.room_id
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
  WHERE id = OLD.round_id AND room_id = OLD.room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluation round does not exist'; END IF;

  IF OLD.submission_status = 'FINAL' AND NEW.submission_status <> 'FINAL' THEN
    IF NOT (
      v_evaluation_method IN ('SCORE_FEEDBACK', 'SCORE_ONLY')
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

CREATE TABLE IF NOT EXISTS public.final_vote_cycles (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  decision_round_id TEXT NOT NULL,
  cycle_number INT NOT NULL CHECK (cycle_number >= 1),
  cycle_kind TEXT NOT NULL CHECK (cycle_kind IN ('INITIAL', 'TIE_REVOTE')),
  candidate_idea_ids TEXT[] NOT NULL CHECK (CARDINALITY(candidate_idea_ids) >= 1),
  guaranteed_winner_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tie_candidate_idea_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tie_slots INT NOT NULL DEFAULT 0 CHECK (tie_slots >= 0),
  status TEXT NOT NULL CHECK (status IN ('VOTING', 'CONSENT', 'ROULETTE', 'COMPLETED')),
  result_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT final_vote_cycles_round_room_fk
    FOREIGN KEY (decision_round_id, room_id)
    REFERENCES public.evaluation_rounds(id, room_id)
    ON DELETE CASCADE,
  UNIQUE (room_id, decision_round_id, cycle_number)
);

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_current_final_vote_cycle_fk;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_current_final_vote_cycle_fk
  FOREIGN KEY (current_final_vote_cycle_id)
  REFERENCES public.final_vote_cycles(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.final_vote_ballots (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES public.final_vote_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selected_idea_ids TEXT[] NOT NULL CHECK (CARDINALITY(selected_idea_ids) = 3),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, user_id),
  CONSTRAINT final_vote_ballots_member_fk
    FOREIGN KEY (room_id, user_id)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.final_roulette_consents (
  cycle_id TEXT NOT NULL REFERENCES public.final_vote_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  consent BOOLEAN NOT NULL,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, user_id),
  CONSTRAINT final_roulette_consents_member_fk
    FOREIGN KEY (room_id, user_id)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.final_roulette_draws (
  cycle_id TEXT NOT NULL REFERENCES public.final_vote_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  draw_number INT NOT NULL CHECK (draw_number >= 1),
  candidate_idea_ids TEXT[] NOT NULL CHECK (CARDINALITY(candidate_idea_ids) >= 1),
  selected_idea_id TEXT NOT NULL REFERENCES public.ideas(id) ON DELETE RESTRICT,
  drawn_by TEXT NOT NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, draw_number),
  UNIQUE (cycle_id, selected_idea_id),
  CONSTRAINT final_roulette_draws_host_fk
    FOREIGN KEY (room_id, drawn_by)
    REFERENCES public.participants(room_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS final_vote_cycles_room_status_idx
  ON public.final_vote_cycles(room_id, status, cycle_number DESC);
CREATE INDEX IF NOT EXISTS final_vote_ballots_cycle_idx
  ON public.final_vote_ballots(cycle_id, submitted_at);
CREATE INDEX IF NOT EXISTS final_roulette_consents_cycle_idx
  ON public.final_roulette_consents(cycle_id, consent);
CREATE INDEX IF NOT EXISTS final_roulette_draws_cycle_idx
  ON public.final_roulette_draws(cycle_id, draw_number);

ALTER TABLE public.final_vote_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_vote_ballots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_roulette_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_roulette_draws ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.final_vote_cycles FROM anon, authenticated;
REVOKE ALL ON public.final_vote_ballots FROM anon, authenticated;
REVOKE ALL ON public.final_roulette_consents FROM anon, authenticated;
REVOKE ALL ON public.final_roulette_draws FROM anon, authenticated;
GRANT ALL ON public.final_vote_cycles TO service_role;
GRANT ALL ON public.final_vote_ballots TO service_role;
GRANT ALL ON public.final_roulette_consents TO service_role;
GRANT ALL ON public.final_roulette_draws TO service_role;

-- 점수 집계는 순수 합계만 사용한다. 중간값/편차/구간 비율/가중치/보정점수는 계산하지 않는다.
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
    v_max_count := LEAST(v_candidate_count, 8);
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
  ELSE
    v_desired_count := LEAST(v_candidate_count, 4);
    v_max_count := v_desired_count;
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
  END IF;

  IF CARDINALITY(v_base_ids) <= v_max_count THEN
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
  v_candidate_ids TEXT[];
  v_eliminated_ids TEXT[];
  v_max_count INT;
  v_ai_result JSONB := jsonb_build_object('used', FALSE);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_round FROM public.evaluation_rounds
  WHERE id = p_round_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '평가 회차를 찾을 수 없습니다.'; END IF;
  IF v_round.status = 'COMPLETED' THEN RETURN v_round.result_snapshot; END IF;
  IF p_next_status NOT IN ('EVALUATION_ROUND_2', 'ELIMINATION') THEN
    RAISE EXCEPTION '올바르지 않은 다음 단계입니다.';
  END IF;
  v_snapshot := COALESCE(v_round.result_snapshot, '{}'::JSONB);
  v_candidate_ids := ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(v_snapshot->'candidateIdeaIds'));
  v_max_count := CASE WHEN v_round.evaluation_method = 'SCORE_ONLY' THEN 4 ELSE 8 END;
  IF CARDINALITY(p_survivor_idea_ids) < 1 OR CARDINALITY(p_survivor_idea_ids) > v_max_count THEN
    RAISE EXCEPTION '진출 후보 수가 정책 범위를 벗어났습니다.';
  END IF;
  IF CARDINALITY(p_survivor_idea_ids) <> (SELECT COUNT(DISTINCT item) FROM UNNEST(p_survivor_idea_ids) item)
     OR EXISTS (SELECT 1 FROM UNNEST(p_survivor_idea_ids) item WHERE NOT item = ANY(v_candidate_ids)) THEN
    RAISE EXCEPTION '진출 후보 목록이 현재 회차와 일치하지 않습니다.';
  END IF;
  IF COALESCE((v_snapshot->>'aiTiebreakRequired')::BOOLEAN, FALSE) THEN
    SELECT result_snapshot INTO v_ai_result FROM public.ai_reports
    WHERE id = p_ai_report_id AND room_id = p_room_id AND round_id = p_round_id
      AND report_type = 'AI_BOUNDARY_TIEBREAK';
    IF v_ai_result IS NULL THEN RAISE EXCEPTION '저장된 AI 경계 판정이 필요합니다.'; END IF;
  END IF;
  v_eliminated_ids := ARRAY(SELECT item FROM UNNEST(v_candidate_ids) item WHERE NOT item = ANY(p_survivor_idea_ids));

  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END,
    eliminated_round = CASE WHEN id = ANY(v_eliminated_ids) THEN v_round.round_number ELSE NULL END
  WHERE room_id = p_room_id AND id = ANY(v_candidate_ids);
  UPDATE public.round_candidates SET
    outcome = CASE WHEN idea_id = ANY(p_survivor_idea_ids) THEN 'ACTIVE' ELSE 'ELIMINATED' END
  WHERE room_id = p_room_id AND round_id = p_round_id;

  SELECT JSONB_OBJECT_AGG(entry.key,
    entry.value || jsonb_build_object('survived', entry.key = ANY(p_survivor_idea_ids)))
  INTO v_snapshot FROM JSONB_EACH(COALESCE(v_snapshot->'scoreStats', '{}'::JSONB)) entry;
  v_snapshot := v_round.result_snapshot || jsonb_build_object(
    'aggregationStatus', 'COMPLETED',
    'survivorIdeaIds', p_survivor_idea_ids,
    'eliminatedIdeaIds', v_eliminated_ids,
    'actualSurvivorCount', CARDINALITY(p_survivor_idea_ids),
    'aiTiebreak', v_ai_result,
    'scoreStats', COALESCE(v_snapshot, '{}'::JSONB),
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

-- 별 3개는 같은 후보에 중복 배정할 수 있다. 마지막 제출과 집계는 회차 행 잠금 안에서 한 번만 처리한다.
CREATE OR REPLACE FUNCTION public.submit_cumulative_star_ballot_v7(
  p_room_id TEXT,
  p_cycle_id TEXT,
  p_user_id TEXT,
  p_selected_idea_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_expected INT;
  v_submitted INT;
  v_boundary_score INT;
  v_current_guaranteed TEXT[] := ARRAY[]::TEXT[];
  v_boundary_ids TEXT[] := ARRAY[]::TEXT[];
  v_all_guaranteed TEXT[] := ARRAY[]::TEXT[];
  v_winner_ids TEXT[] := ARRAY[]::TEXT[];
  v_remaining_slots INT;
  v_counts JSONB := '{}'::JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'VOTING' THEN RAISE EXCEPTION '현재 제출 가능한 최종 투표 회차가 아닙니다.'; END IF;
  IF CARDINALITY(p_selected_idea_ids) <> 3 THEN RAISE EXCEPTION '별 스티커 3개를 모두 사용해야 합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM UNNEST(p_selected_idea_ids) item WHERE NOT item = ANY(v_cycle.candidate_idea_ids)) THEN
    RAISE EXCEPTION '현재 투표 대상이 아닌 후보가 포함되어 있습니다.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.room_phase_participants
    WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION '최종 투표 참여자가 아닙니다.'; END IF;

  INSERT INTO public.final_vote_ballots(id, cycle_id, room_id, user_id, selected_idea_ids, submitted_at)
  VALUES ('final-ballot-' || gen_random_uuid()::TEXT, p_cycle_id, p_room_id, p_user_id, p_selected_idea_ids, v_now)
  ON CONFLICT (cycle_id, user_id) DO UPDATE
    SET selected_idea_ids = EXCLUDED.selected_idea_ids, submitted_at = EXCLUDED.submitted_at;

  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  SELECT COUNT(*) INTO v_submitted FROM public.final_vote_ballots WHERE cycle_id = p_cycle_id;
  IF v_submitted < v_expected THEN
    RETURN jsonb_build_object('status', 'VOTING', 'submittedCount', v_submitted, 'expectedCount', v_expected, 'currentCycleId', p_cycle_id);
  END IF;

  WITH counts AS (
    SELECT candidate_id, COUNT(*)::INT AS star_count
    FROM public.final_vote_ballots ballot
    CROSS JOIN LATERAL UNNEST(ballot.selected_idea_ids) candidate_id
    WHERE ballot.cycle_id = p_cycle_id
    GROUP BY candidate_id
  ), complete_counts AS (
    SELECT candidate_id, COALESCE(counts.star_count, 0) AS star_count
    FROM UNNEST(v_cycle.candidate_idea_ids) candidate_id
    LEFT JOIN counts USING (candidate_id)
  )
  SELECT JSONB_OBJECT_AGG(candidate_id, star_count) INTO v_counts FROM complete_counts;

  WITH counts AS (
    SELECT key AS candidate_id, value::TEXT::INT AS star_count FROM JSONB_EACH(v_counts)
  )
  SELECT star_count INTO v_boundary_score FROM counts
  ORDER BY star_count DESC, candidate_id OFFSET GREATEST(0, v_cycle.tie_slots - 1) LIMIT 1;
  WITH counts AS (
    SELECT key AS candidate_id, value::TEXT::INT AS star_count FROM JSONB_EACH(v_counts)
  )
  SELECT
    COALESCE(ARRAY_AGG(candidate_id ORDER BY candidate_id) FILTER (WHERE star_count > v_boundary_score), ARRAY[]::TEXT[]),
    COALESCE(ARRAY_AGG(candidate_id ORDER BY candidate_id) FILTER (WHERE star_count = v_boundary_score), ARRAY[]::TEXT[])
  INTO v_current_guaranteed, v_boundary_ids FROM counts;
  v_all_guaranteed := v_cycle.guaranteed_winner_idea_ids || v_current_guaranteed;
  v_remaining_slots := v_cycle.tie_slots - CARDINALITY(v_current_guaranteed);

  IF CARDINALITY(v_boundary_ids) > v_remaining_slots THEN
    UPDATE public.final_vote_cycles SET
      status = 'CONSENT', guaranteed_winner_idea_ids = v_all_guaranteed,
      tie_candidate_idea_ids = v_boundary_ids, tie_slots = v_remaining_slots,
      result_snapshot = jsonb_build_object('voteCounts', v_counts, 'boundaryScore', v_boundary_score)
    WHERE id = p_cycle_id;
    UPDATE public.rooms SET
      status = 'ELIMINATION', final_vote_status = 'CONSENT_PENDING',
      tie_candidate_idea_ids = v_boundary_ids, tie_slots = v_remaining_slots
    WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'status', 'CONSENT', 'currentCycleId', p_cycle_id,
      'submittedCount', v_submitted, 'expectedCount', v_expected,
      'guaranteedWinnerIdeaIds', v_all_guaranteed,
      'tieCandidateIdeaIds', v_boundary_ids, 'tieSlots', v_remaining_slots,
      'voteCounts', v_counts
    );
  END IF;

  v_winner_ids := v_all_guaranteed || v_boundary_ids[1:v_remaining_slots];
  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(v_winner_ids) THEN 'WINNER' ELSE 'ELIMINATED' END,
    winner_selection_method = CASE WHEN id = ANY(v_winner_ids) THEN 'CUMULATIVE_STAR' ELSE NULL END
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  UPDATE public.final_vote_cycles SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = jsonb_build_object('winnerIdeaIds', v_winner_ids, 'voteCounts', v_counts)
  WHERE id = p_cycle_id;
  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = COALESCE(result_snapshot, '{}'::JSONB) || jsonb_build_object(
      'winnerIdeaIds', v_winner_ids, 'voteCounts', v_counts, 'selectionMethod', 'CUMULATIVE_STAR'
    )
  WHERE id = v_cycle.decision_round_id AND room_id = p_room_id;
  UPDATE public.rooms SET
    status = 'CLOSED', final_vote_status = 'FINALIZED',
    tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object(
    'status', 'COMPLETED', 'finalized', TRUE, 'currentCycleId', p_cycle_id,
    'winnerIdeaIds', v_winner_ids, 'voteCounts', v_counts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_cumulative_star_ballot_v7(
  p_room_id TEXT, p_cycle_id TEXT, p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_cycle public.final_vote_cycles%ROWTYPE;
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'VOTING' THEN RAISE EXCEPTION '집계 전 투표만 수정할 수 있습니다.'; END IF;
  DELETE FROM public.final_vote_ballots
  WHERE cycle_id = p_cycle_id AND room_id = p_room_id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', TRUE, 'status', 'VOTING');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_final_roulette_consent_v7(
  p_room_id TEXT, p_cycle_id TEXT, p_user_id TEXT, p_consent BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_expected INT;
  v_consented INT;
  v_next_id TEXT;
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'CONSENT' THEN RAISE EXCEPTION '현재 롤렛 동의 단계가 아닙니다.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.room_phase_participants
    WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION '최종 투표 참여자가 아닙니다.'; END IF;
  INSERT INTO public.final_roulette_consents(cycle_id, room_id, user_id, consent, responded_at)
  VALUES (p_cycle_id, p_room_id, p_user_id, p_consent, NOW())
  ON CONFLICT (cycle_id, user_id) DO UPDATE SET consent = EXCLUDED.consent, responded_at = EXCLUDED.responded_at;

  IF NOT p_consent THEN
    v_next_id := 'final-vote-cycle-' || gen_random_uuid()::TEXT;
    UPDATE public.final_vote_cycles SET status = 'COMPLETED', completed_at = NOW(),
      result_snapshot = result_snapshot || jsonb_build_object('rouletteDeclined', TRUE, 'declinedBy', p_user_id)
    WHERE id = p_cycle_id;
    INSERT INTO public.final_vote_cycles(
      id, room_id, decision_round_id, cycle_number, cycle_kind,
      candidate_idea_ids, guaranteed_winner_idea_ids, tie_candidate_idea_ids,
      tie_slots, status, result_snapshot
    ) VALUES (
      v_next_id, p_room_id, v_cycle.decision_round_id, v_cycle.cycle_number + 1, 'TIE_REVOTE',
      v_cycle.tie_candidate_idea_ids, v_cycle.guaranteed_winner_idea_ids, ARRAY[]::TEXT[],
      v_cycle.tie_slots, 'VOTING', '{}'::JSONB
    );
    UPDATE public.rooms SET
      status = 'ELIMINATION', final_vote_status = 'VOTING', current_final_vote_cycle_id = v_next_id,
      tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
    WHERE id = p_room_id;
    RETURN jsonb_build_object('status', 'VOTING', 'currentCycleId', v_next_id, 'tieRevoteCreated', TRUE);
  END IF;

  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  SELECT COUNT(*) INTO v_consented FROM public.final_roulette_consents
  WHERE cycle_id = p_cycle_id AND consent = TRUE;
  IF v_consented >= v_expected THEN
    UPDATE public.final_vote_cycles SET status = 'ROULETTE' WHERE id = p_cycle_id;
    UPDATE public.rooms SET final_vote_status = 'ROULETTE_PENDING' WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'status', 'ROULETTE', 'currentCycleId', p_cycle_id,
      'tieCandidateIdeaIds', v_cycle.tie_candidate_idea_ids, 'tieSlots', v_cycle.tie_slots,
      'consentedCount', v_consented, 'expectedCount', v_expected
    );
  END IF;
  RETURN jsonb_build_object(
    'status', 'CONSENT', 'currentCycleId', p_cycle_id,
    'tieCandidateIdeaIds', v_cycle.tie_candidate_idea_ids, 'tieSlots', v_cycle.tie_slots,
    'consentedCount', v_consented, 'expectedCount', v_expected
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_final_roulette_draw_v7(
  p_room_id TEXT,
  p_cycle_id TEXT,
  p_draw_number INT,
  p_candidate_idea_ids TEXT[],
  p_selected_idea_id TEXT,
  p_drawn_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_existing public.final_roulette_draws%ROWTYPE;
  v_draw_count INT;
  v_expected_draw_number INT;
  v_remaining_ids TEXT[];
  v_roulette_winners TEXT[];
  v_winner_ids TEXT[];
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '최종 투표 회차를 찾을 수 없습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id AND host_id = p_drawn_by) THEN
    RAISE EXCEPTION '방장만 롤렛을 돌릴 수 있습니다.';
  END IF;
  SELECT * INTO v_existing FROM public.final_roulette_draws
  WHERE cycle_id = p_cycle_id AND draw_number = p_draw_number;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_cycle.status = 'COMPLETED' THEN 'COMPLETED' ELSE 'ROULETTE' END,
      'finalized', v_cycle.status = 'COMPLETED',
      'currentCycleId', p_cycle_id,
      'selectedIdeaId', v_existing.selected_idea_id, 'drawNumber', v_existing.draw_number,
      'winnerIdeaIds', COALESCE(v_cycle.result_snapshot->'winnerIdeaIds', '[]'::JSONB),
      'rouletteWinnerIdeaIds', COALESCE(v_cycle.result_snapshot->'rouletteWinnerIdeaIds', '[]'::JSONB),
      'alreadyDrawn', TRUE
    );
  END IF;
  IF v_cycle.status <> 'ROULETTE' THEN RAISE EXCEPTION '현재 롤렛 추첨 단계가 아닙니다.'; END IF;
  SELECT COUNT(*) INTO v_draw_count FROM public.final_roulette_draws WHERE cycle_id = p_cycle_id;
  v_expected_draw_number := v_draw_count + 1;
  IF p_draw_number <> v_expected_draw_number OR p_draw_number > v_cycle.tie_slots THEN
    RAISE EXCEPTION '현재 롤렛 추첨 순서와 일치하지 않습니다.';
  END IF;
  v_remaining_ids := ARRAY(
    SELECT item FROM UNNEST(v_cycle.tie_candidate_idea_ids) item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.final_roulette_draws draw
      WHERE draw.cycle_id = p_cycle_id AND draw.selected_idea_id = item
    ) ORDER BY item
  );
  IF NOT p_selected_idea_id = ANY(v_remaining_ids)
     OR CARDINALITY(p_candidate_idea_ids) <> CARDINALITY(v_remaining_ids)
     OR NOT (p_candidate_idea_ids @> v_remaining_ids AND v_remaining_ids @> p_candidate_idea_ids) THEN
    RAISE EXCEPTION '롤렛 후보 목록 또는 선택 결과가 저장 상태와 일치하지 않습니다.';
  END IF;
  INSERT INTO public.final_roulette_draws(
    cycle_id, room_id, draw_number, candidate_idea_ids, selected_idea_id, drawn_by, drawn_at
  ) VALUES (p_cycle_id, p_room_id, p_draw_number, p_candidate_idea_ids, p_selected_idea_id, p_drawn_by, v_now);

  SELECT COUNT(*) INTO v_draw_count FROM public.final_roulette_draws WHERE cycle_id = p_cycle_id;
  IF v_draw_count < v_cycle.tie_slots THEN
    RETURN jsonb_build_object(
      'status', 'ROULETTE', 'currentCycleId', p_cycle_id,
      'selectedIdeaId', p_selected_idea_id, 'drawNumber', p_draw_number,
      'remainingDrawCount', v_cycle.tie_slots - v_draw_count,
      'tieCandidateIdeaIds', v_cycle.tie_candidate_idea_ids, 'tieSlots', v_cycle.tie_slots
    );
  END IF;

  SELECT ARRAY_AGG(selected_idea_id ORDER BY draw_number)
  INTO v_roulette_winners FROM public.final_roulette_draws WHERE cycle_id = p_cycle_id;
  v_winner_ids := v_cycle.guaranteed_winner_idea_ids || v_roulette_winners;
  UPDATE public.ideas SET
    status = CASE WHEN id = ANY(v_winner_ids) THEN 'WINNER' ELSE 'ELIMINATED' END,
    winner_selection_method = CASE
      WHEN id = ANY(v_roulette_winners) THEN 'ROULETTE'
      WHEN id = ANY(v_cycle.guaranteed_winner_idea_ids) THEN 'CUMULATIVE_STAR'
      ELSE NULL END
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  UPDATE public.final_vote_cycles SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = result_snapshot || jsonb_build_object(
      'winnerIdeaIds', v_winner_ids, 'rouletteWinnerIdeaIds', v_roulette_winners
    )
  WHERE id = p_cycle_id;
  UPDATE public.evaluation_rounds SET
    status = 'COMPLETED', completed_at = v_now,
    result_snapshot = COALESCE(result_snapshot, '{}'::JSONB) || jsonb_build_object(
      'winnerIdeaIds', v_winner_ids, 'rouletteWinnerIdeaIds', v_roulette_winners
    )
  WHERE id = v_cycle.decision_round_id AND room_id = p_room_id;
  UPDATE public.rooms SET
    status = 'CLOSED', final_vote_status = 'FINALIZED',
    tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object(
    'status', 'COMPLETED', 'finalized', TRUE, 'currentCycleId', p_cycle_id,
    'selectedIdeaId', p_selected_idea_id, 'drawNumber', p_draw_number,
    'winnerIdeaIds', v_winner_ids, 'rouletteWinnerIdeaIds', v_roulette_winners,
    'remainingDrawCount', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_score_round_result_v7(TEXT, TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_cumulative_star_ballot_v7(TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_cumulative_star_ballot_v7(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_final_roulette_consent_v7(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_final_roulette_draw_v7(TEXT, TEXT, INT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_score_evaluation_round(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_score_round_result_v7(TEXT, TEXT, TEXT[], TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_cumulative_star_ballot_v7(TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_cumulative_star_ballot_v7(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_final_roulette_consent_v7(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_final_roulette_draw_v7(TEXT, TEXT, INT, TEXT[], TEXT, TEXT) TO service_role;

COMMIT;

-- 적용 후 확인: 모두 0이어야 한다.
SELECT 'invalid_v7_score_rounds' AS check_name, COUNT(*) AS issue_count
FROM public.evaluation_rounds
WHERE evaluation_method = 'SCORE_ONLY' AND stage <> 'EVALUATION'
UNION ALL
SELECT 'invalid_final_vote_ballots', COUNT(*)
FROM public.final_vote_ballots WHERE CARDINALITY(selected_idea_ids) <> 3
UNION ALL
SELECT 'duplicate_final_vote_cycles', COUNT(*)
FROM (
  SELECT room_id, decision_round_id, cycle_number
  FROM public.final_vote_cycles
  GROUP BY room_id, decision_round_id, cycle_number HAVING COUNT(*) > 1
) duplicate_cycles;
