-- WHYNOT V12.1: personal archive for all room states
-- 2026-08-23
--
-- Policy correction after V12:
-- - Archive is a personal list-cleanup preference, not a lifecycle action.
-- - IDEA_SUBMISSION / evaluation phases / CLOSED rooms can all be archived.
-- - Archiving never leaves, deletes, ends, or changes the room/stage.
-- - The existing hidden_at columns and set_room_archive_v12 RPC are reused.
-- - Existing V12 migration remains immutable; this migration only relaxes the CLOSED-only guard.

BEGIN;

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

  -- Personal archive is intentionally independent from room.status.
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

REVOKE ALL PRIVILEGES ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;

-- V12.1 verification: every issue_count should be 0.
SELECT 'archive_function_closed_only_guard' AS check_name,
  CASE
    WHEN pg_get_functiondef('public.set_room_archive_v12(text,text,boolean)'::regprocedure)
      ILIKE '%완료된 회의실만 보관%'
    THEN 1 ELSE 0
  END AS issue_count
UNION ALL
SELECT 'participant_archive_orphan_room', COUNT(*)
FROM public.participants participant
LEFT JOIN public.rooms room ON room.id = participant.room_id
WHERE participant.hidden_at IS NOT NULL AND room.id IS NULL
UNION ALL
SELECT 'voter_archive_orphan_room', COUNT(*)
FROM public.room_voter_registrations voter
LEFT JOIN public.rooms room ON room.id = voter.room_id
WHERE voter.hidden_at IS NOT NULL AND room.id IS NULL
UNION ALL
SELECT 'terminal_voter_registration_archived', COUNT(*)
FROM public.room_voter_registrations voter
WHERE voter.hidden_at IS NOT NULL
  AND voter.status NOT IN ('WAITING', 'ACTIVE');
