-- WhyNot P0 BFF containment migration
-- REVIEW FIRST. Run preflight before this file. Do not run automatically.
--
-- This migration intentionally affects only the WhyNot relations and functions
-- named in this file. It does not delete existing rows or existing RLS policies.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.rooms') IS NULL
     OR to_regclass('public.participants') IS NULL
     OR to_regclass('public.user_accounts') IS NULL
     OR to_regclass('public.room_invites') IS NULL THEN
    RAISE EXCEPTION 'WhyNot sentinel tables are missing. Stop: this may be the wrong Supabase project.';
  END IF;

  IF (
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_accounts'
      AND column_name = 'id'
  ) <> 'uuid' THEN
    RAISE EXCEPTION 'public.user_accounts.id must be UUID before applying this migration.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
  ON public.user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.phase_completions (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  user_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, phase, user_id)
);

CREATE INDEX IF NOT EXISTS idx_phase_completions_room_phase
  ON public.phase_completions(room_id, phase);

CREATE TABLE IF NOT EXISTS public.star_votes (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selected_idea_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id),
  CHECK (jsonb_typeof(selected_idea_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_star_votes_room_id
  ON public.star_votes(room_id);

CREATE TABLE IF NOT EXISTS public.elimination_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  eliminated_idea_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_summary_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, round_number),
  CHECK (jsonb_typeof(eliminated_idea_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_elimination_rounds_room_number
  ON public.elimination_rounds(room_id, round_number);

ALTER TABLE public.criterion_proposals
  ADD COLUMN IF NOT EXISTS is_ai_suggested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.room_invites
  ADD COLUMN IF NOT EXISTS invite_token_hash TEXT;
ALTER TABLE public.room_invites
  ALTER COLUMN invite_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_invites_token_hash
  ON public.room_invites(invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

-- Every old plaintext/public token is invalidated. New tokens are stored only
-- as SHA-256 hashes by the BFF.
UPDATE public.room_invites
SET is_active = FALSE
WHERE is_active = TRUE;

UPDATE public.rooms SET is_public = FALSE WHERE is_public IS DISTINCT FROM FALSE;
ALTER TABLE public.rooms ALTER COLUMN is_public SET DEFAULT FALSE;

-- Atomic password recovery: rotate password/recovery hash and revoke every
-- previous session in one database transaction.
CREATE OR REPLACE FUNCTION public.bff_recover_account(
  p_user_id UUID,
  p_expected_recovery_hash TEXT,
  p_new_password_hash TEXT,
  p_new_recovery_hash TEXT,
  p_updated_at TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_accounts
  SET password_hash = p_new_password_hash,
      recovery_code_hash = p_new_recovery_hash,
      failed_recovery_attempts = 0,
      updated_at = p_updated_at
  WHERE id = p_user_id
    AND recovery_code_hash = p_expected_recovery_hash
    AND status = 'ACTIVE';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.user_sessions WHERE user_id = p_user_id;
  RETURN TRUE;
END;
$$;

-- Atomic invite join: the token, expiry, room state and capacity are checked
-- under row locks before the participant row is inserted.
CREATE OR REPLACE FUNCTION public.bff_join_room_via_invite(
  p_token_hash TEXT,
  p_user_id TEXT,
  p_nickname TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite public.room_invites%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_participant_count INTEGER;
  v_already_member BOOLEAN;
BEGIN
  SELECT * INTO v_invite
  FROM public.room_invites
  WHERE invite_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'NOT_FOUND', 'error_message', '존재하지 않는 초대 링크입니다.');
  END IF;
  IF NOT v_invite.is_active THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'DEACTIVATED', 'error_message', '비활성화된 초대 링크입니다.');
  END IF;
  IF v_invite.expires_at <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'EXPIRED', 'error_message', '만료된 초대 링크입니다.');
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_invite.room_id
  FOR UPDATE;
  IF NOT FOUND OR v_room.status = 'CLOSED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'ROOM_UNAVAILABLE', 'error_message', '참여할 수 없는 회의실입니다.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.participants
    WHERE room_id = v_room.id AND user_id = p_user_id
  ) INTO v_already_member;

  SELECT COUNT(*) INTO v_participant_count
  FROM public.participants
  WHERE room_id = v_room.id;

  IF NOT v_already_member AND v_participant_count >= COALESCE(v_room.max_participants, 6) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CAPACITY_FULL', 'error_message', '회의실 정원이 가득 찼습니다.');
  END IF;

  INSERT INTO public.participants (room_id, user_id, nickname)
  VALUES (v_room.id, p_user_id, LEFT(p_nickname, 30))
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET nickname = EXCLUDED.nickname;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'room_id', v_room.id,
    'already_member', v_already_member
  );
END;
$$;

-- Atomic final result write. The BFF calculates the completed vote outcome;
-- this function prevents a partial room/idea update.
CREATE OR REPLACE FUNCTION public.bff_finalize_star_vote(
  p_room_id TEXT,
  p_expected_status TEXT,
  p_winner_ids TEXT[]
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_active_count INTEGER;
  v_requested_winner_count INTEGER;
  v_matching_winner_count INTEGER;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_room.status <> p_expected_status
     OR p_expected_status NOT IN ('ELIMINATION', 'FINAL_VOTE', 'EVALUATION_ROUND_2') THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.ideas
  WHERE room_id = p_room_id
    AND status = 'ACTIVE';

  v_requested_winner_count := COALESCE(array_length(p_winner_ids, 1), 0);
  IF v_active_count < 1
     OR v_requested_winner_count <> LEAST(COALESCE(v_room.target_winner_count, 1), v_active_count) THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_matching_winner_count
  FROM public.ideas
  WHERE room_id = p_room_id
    AND status = 'ACTIVE'
    AND id = ANY(COALESCE(p_winner_ids, ARRAY[]::TEXT[]));
  IF v_matching_winner_count <> v_requested_winner_count THEN
    RETURN FALSE;
  END IF;

  UPDATE public.ideas
  SET status = CASE
    WHEN id = ANY(p_winner_ids) THEN 'WINNER'
    ELSE 'ELIMINATED'
  END
  WHERE room_id = p_room_id
    AND status = 'ACTIVE';

  UPDATE public.rooms
  SET status = 'CLOSED'
  WHERE id = p_room_id
    AND status = p_expected_status;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

-- Atomic elimination write. This keeps the room status, candidate statuses and
-- round history consistent even if two host requests arrive at the same time.
CREATE OR REPLACE FUNCTION public.bff_apply_elimination_round(
  p_room_id TEXT,
  p_expected_status TEXT,
  p_eliminated_idea_ids TEXT[],
  p_round_id TEXT,
  p_round_number INTEGER,
  p_ai_summary_text TEXT,
  p_winner_ids TEXT[]
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_status TEXT;
  v_target_winner_count INTEGER;
  v_active_count INTEGER;
  v_requested_count INTEGER;
  v_matching_count INTEGER;
  v_winner_count INTEGER;
BEGIN
  SELECT status, COALESCE(target_winner_count, 1)
  INTO v_room_status, v_target_winner_count
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND OR v_room_status <> p_expected_status OR p_expected_status <> 'ELIMINATION' THEN
    RETURN FALSE;
  END IF;

  v_requested_count := COALESCE(array_length(p_eliminated_idea_ids, 1), 0);
  IF v_requested_count < 1 OR p_round_number < 1 THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.ideas
  WHERE room_id = p_room_id
    AND status = 'ACTIVE';

  -- An elimination round must always leave at least one candidate. This check
  -- is repeated in the database so a forged request cannot bypass the UI or
  -- Express validation.
  IF v_requested_count >= v_active_count THEN
    RETURN FALSE;
  END IF;

  -- Manual requests may not eliminate below the winner count configured when
  -- the room was created.
  IF v_active_count - v_requested_count < LEAST(v_target_winner_count, v_active_count) THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_matching_count
  FROM public.ideas
  WHERE room_id = p_room_id
    AND status = 'ACTIVE'
    AND id = ANY(p_eliminated_idea_ids);
  IF v_matching_count <> v_requested_count THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_winner_count
  FROM public.ideas
  WHERE room_id = p_room_id
    AND status = 'ACTIVE'
    AND id = ANY(COALESCE(p_winner_ids, ARRAY[]::TEXT[]));
  IF v_winner_count <> COALESCE(array_length(p_winner_ids, 1), 0) THEN
    RETURN FALSE;
  END IF;

  -- The same idea cannot be both eliminated and selected as a winner.
  IF EXISTS (
    SELECT 1
    FROM unnest(p_eliminated_idea_ids) AS eliminated_id
    WHERE eliminated_id = ANY(COALESCE(p_winner_ids, ARRAY[]::TEXT[]))
  ) THEN
    RETURN FALSE;
  END IF;

  -- When this round closes the room, every candidate that survives this
  -- elimination must be included in the winner list. This prevents a caller
  -- from silently leaving an ACTIVE candidate outside the published result.
  IF COALESCE(array_length(p_winner_ids, 1), 0) > 0
     AND v_active_count - v_requested_count <> v_winner_count THEN
    RETURN FALSE;
  END IF;
  IF COALESCE(array_length(p_winner_ids, 1), 0) > 0
     AND v_winner_count <> LEAST(v_target_winner_count, v_active_count) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.elimination_rounds (
    id, room_id, round_number, eliminated_idea_ids, ai_summary_text
  ) VALUES (
    p_round_id,
    p_room_id,
    p_round_number,
    to_jsonb(p_eliminated_idea_ids),
    COALESCE(p_ai_summary_text, '')
  );

  UPDATE public.ideas
  SET status = 'ELIMINATED',
      eliminated_round = p_round_number
  WHERE room_id = p_room_id
    AND status = 'ACTIVE'
    AND id = ANY(p_eliminated_idea_ids);

  IF COALESCE(array_length(p_winner_ids, 1), 0) > 0 THEN
    UPDATE public.ideas
    SET status = 'WINNER'
    WHERE room_id = p_room_id
      AND status = 'ACTIVE'
      AND id = ANY(p_winner_ids);

    UPDATE public.rooms
    SET status = 'CLOSED'
    WHERE id = p_room_id
      AND status = p_expected_status;
  END IF;

  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

-- Browser roles must not access application storage directly. Existing RLS
-- policies are preserved for rollback/audit, but grants are removed and RLS is
-- forced on the explicit WhyNot table allow-list.
DO $$
DECLARE
  relation_name TEXT;
  relation_regclass REGCLASS;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'user_accounts', 'user_sessions', 'rooms', 'participants', 'ideas',
    'criterion_proposals', 'criteria', 'evaluations', 'elimination_rounds',
    'room_invites', 'phase_completions', 'star_votes'
  ]
  LOOP
    relation_regclass := to_regclass(format('public.%I', relation_name));
    IF relation_regclass IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated', relation_regclass);
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', relation_regclass);
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', relation_regclass);
    END IF;
  END LOOP;
END $$;

-- Revoke only known WhyNot browser-callable functions. Do not touch unrelated
-- public-schema functions belonging to another application.
DO $$
DECLARE
  function_record RECORD;
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure AS function_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'create_room_invite', 'deactivate_room_invite', 'get_invite_details',
        'join_room_via_invite', 'purge_dead_rooms',
        'update_criterion_proposal', 'delete_criterion_proposal',
        'propose_criterion_with_limit'
      ])
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_record.function_signature
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.bff_recover_account(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bff_join_room_via_invite(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bff_finalize_star_vote(TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bff_apply_elimination_round(TEXT, TEXT, TEXT[], TEXT, INTEGER, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bff_recover_account(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bff_join_room_via_invite(TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bff_finalize_star_vote(TEXT, TEXT, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bff_apply_elimination_round(TEXT, TEXT, TEXT[], TEXT, INTEGER, TEXT, TEXT[])
  TO service_role;

COMMIT;
