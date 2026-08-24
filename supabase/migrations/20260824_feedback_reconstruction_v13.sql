-- =============================================================================
-- WhyNot V13: eliminated-idea feedback reconstruction
--
-- Purpose
--   - Preserve original evaluation rows.
--   - Never expose raw feedback for ideas eliminated by score-evaluation rounds.
--   - Store AI reconstruction as an independent FEEDBACK_RECONSTRUCTION report.
--   - Keep score calculation, survivor selection, second-round scoring and final vote unchanged.
-- =============================================================================

BEGIN;

ALTER TABLE public.ai_reports
  DROP CONSTRAINT IF EXISTS ai_reports_report_type_check;

ALTER TABLE public.ai_reports
  ADD CONSTRAINT ai_reports_report_type_check
  CHECK (report_type IN (
    'FINAL_DECISION',
    'REFINEMENT_SUMMARY',
    'EVALUATION_CARDS',
    'SCREENING_SUMMARY',
    'AI_BOUNDARY_TIEBREAK',
    'FEEDBACK_RECONSTRUCTION'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_feedback_reconstruction_round_unique
  ON public.ai_reports(room_id, round_id)
  WHERE round_id IS NOT NULL
    AND report_type = 'FEEDBACK_RECONSTRUCTION';

CREATE OR REPLACE FUNCTION public.claim_feedback_reconstruction_v13(
  p_room_id TEXT,
  p_round_id TEXT,
  p_lease_token TEXT,
  p_lease_seconds INT DEFAULT 45
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.ai_reports%ROWTYPE;
  v_snapshot JSONB;
  v_status TEXT;
  v_claimed_at TIMESTAMPTZ;
  v_retry_after TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
  v_lease_seconds INT := GREATEST(10, LEAST(COALESCE(p_lease_seconds, 45), 180));
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_room_id, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_round_id, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_lease_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'feedback reconstruction claim arguments are required';
  END IF;

  -- Serializes first-claim and stale-lease reclaim for the same room/round.
  PERFORM pg_advisory_xact_lock(
    hashtext('feedback-reconstruction:' || p_room_id || ':' || p_round_id)
  );

  SELECT *
  INTO v_report
  FROM public.ai_reports
  WHERE room_id = p_room_id
    AND round_id = p_round_id
    AND report_type = 'FEEDBACK_RECONSTRUCTION'
  FOR UPDATE;

  IF NOT FOUND THEN
    v_snapshot := jsonb_build_object(
      'schemaVersion', 1,
      'overallStatus', 'PROCESSING',
      'leaseToken', p_lease_token,
      'claimedAt', v_now
    );

    INSERT INTO public.ai_reports (
      id,
      room_id,
      round_id,
      report_type,
      report_text,
      input_snapshot,
      result_snapshot,
      model_name,
      prompt_version
    ) VALUES (
      'ai-report-feedback-reconstruction-' || p_round_id,
      p_room_id,
      p_round_id,
      'FEEDBACK_RECONSTRUCTION',
      '탈락 아이디어 익명 피드백 재구성',
      '{}'::jsonb,
      v_snapshot,
      'pending',
      'feedback-reconstruction-v1.0'
    );

    RETURN jsonb_build_object('action', 'CLAIMED', 'resultSnapshot', v_snapshot);
  END IF;

  v_snapshot := COALESCE(v_report.result_snapshot, '{}'::jsonb);
  v_status := COALESCE(v_snapshot->>'overallStatus', '');

  IF v_status IN ('READY', 'INSUFFICIENT_EVIDENCE') THEN
    RETURN jsonb_build_object('action', 'EXISTS', 'resultSnapshot', v_snapshot);
  END IF;

  IF v_status = 'PROCESSING' THEN
    BEGIN
      v_claimed_at := NULLIF(v_snapshot->>'claimedAt', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_claimed_at := NULL;
    END;

    IF v_claimed_at IS NOT NULL
       AND v_claimed_at > v_now - make_interval(secs => v_lease_seconds) THEN
      RETURN jsonb_build_object('action', 'PROCESSING', 'resultSnapshot', v_snapshot);
    END IF;
  ELSIF v_status = 'UNAVAILABLE' THEN
    BEGIN
      v_retry_after := NULLIF(v_snapshot->>'retryAfter', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_retry_after := NULL;
    END;

    IF v_retry_after IS NOT NULL AND v_retry_after > v_now THEN
      RETURN jsonb_build_object('action', 'EXISTS', 'resultSnapshot', v_snapshot);
    END IF;
  END IF;

  v_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'overallStatus', 'PROCESSING',
    'leaseToken', p_lease_token,
    'claimedAt', v_now
  );

  UPDATE public.ai_reports
  SET
    result_snapshot = v_snapshot,
    model_name = 'pending',
    prompt_version = 'feedback-reconstruction-v1.0'
  WHERE id = v_report.id;

  RETURN jsonb_build_object('action', 'CLAIMED', 'resultSnapshot', v_snapshot);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_feedback_reconstruction_v13(
  p_room_id TEXT,
  p_round_id TEXT,
  p_lease_token TEXT,
  p_input_snapshot JSONB,
  p_result_snapshot JSONB,
  p_model_name TEXT,
  p_prompt_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.ai_reports%ROWTYPE;
  v_current_token TEXT;
  v_status TEXT;
  v_clean_result JSONB;
BEGIN
  SELECT *
  INTO v_report
  FROM public.ai_reports
  WHERE room_id = p_room_id
    AND round_id = p_round_id
    AND report_type = 'FEEDBACK_RECONSTRUCTION'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback reconstruction report does not exist';
  END IF;

  v_current_token := COALESCE(v_report.result_snapshot->>'leaseToken', '');
  IF v_current_token <> COALESCE(p_lease_token, '') THEN
    RAISE EXCEPTION 'feedback reconstruction lease is no longer valid';
  END IF;

  v_status := COALESCE(p_result_snapshot->>'overallStatus', '');
  IF v_status NOT IN ('READY', 'INSUFFICIENT_EVIDENCE', 'UNAVAILABLE') THEN
    RAISE EXCEPTION 'invalid feedback reconstruction completion status';
  END IF;

  v_clean_result := COALESCE(p_result_snapshot, '{}'::jsonb) - 'leaseToken' - 'claimedAt';

  UPDATE public.ai_reports
  SET
    report_text = '탈락 아이디어 익명 피드백 재구성',
    input_snapshot = COALESCE(p_input_snapshot, '{}'::jsonb),
    result_snapshot = v_clean_result,
    model_name = COALESCE(NULLIF(BTRIM(p_model_name), ''), 'unknown'),
    prompt_version = COALESCE(NULLIF(BTRIM(p_prompt_version), ''), 'feedback-reconstruction-v1.0')
  WHERE id = v_report.id;

  RETURN v_clean_result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_feedback_reconstruction_v13(TEXT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_feedback_reconstruction_v13(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_feedback_reconstruction_v13(TEXT, TEXT, TEXT, INT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_feedback_reconstruction_v13(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT)
  TO service_role;

COMMIT;

