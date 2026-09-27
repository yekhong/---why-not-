-- Forward-only V17: keep recovery rotation and replacement session in one
-- transaction. Existing V10-V12 migrations and their recorded names are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.recover_user_account_with_session_v17(
  p_recovery_code_hashes TEXT[],
  p_new_password_hash TEXT,
  p_new_recovery_code_hash TEXT,
  p_session_token_hash TEXT,
  p_session_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_accounts%ROWTYPE;
BEGIN
  IF COALESCE(CARDINALITY(p_recovery_code_hashes), 0) < 1
     OR NULLIF(p_new_password_hash, '') IS NULL
     OR NULLIF(p_new_recovery_code_hash, '') IS NULL
     OR NULLIF(p_session_token_hash, '') IS NULL
     OR p_session_expires_at IS NULL
     OR p_session_expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invalid recovery request' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_account
  FROM public.user_accounts
  WHERE recovery_code_hash = ANY(p_recovery_code_hashes)
    AND status = 'ACTIVE'
  ORDER BY id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid recovery code' USING ERRCODE = 'P0001';
  END IF;
  IF v_account.failed_recovery_attempts >= 5 THEN
    RAISE EXCEPTION 'Recovery attempts exceeded' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_accounts SET
    password_hash = p_new_password_hash,
    recovery_code_hash = p_new_recovery_code_hash,
    failed_recovery_attempts = 0,
    updated_at = NOW()
  WHERE id = v_account.id;

  DELETE FROM public.user_sessions WHERE user_id = v_account.id;
  INSERT INTO public.user_sessions(token_hash, user_id, expires_at, created_at)
  VALUES (p_session_token_hash, v_account.id, p_session_expires_at, NOW());

  RETURN jsonb_build_object('id', v_account.id, 'loginId', v_account.login_id,
                            'nickname', v_account.nickname);
END;
$$;

REVOKE ALL ON FUNCTION public.recover_user_account_with_session_v17(TEXT[], TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_user_account_with_session_v17(TEXT[], TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

-- Reassert the final intended policies for databases where same-day legacy
-- files were replayed in lexical (V12.1, V11, V12, V10) order. This cannot
-- recover hidden_at values erased by an earlier V12 run.
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
REVOKE ALL ON FUNCTION public.accept_participant_account_invites_v10(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_participant_account_invites_v10(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.set_room_archive_v12(
  p_room_id TEXT, p_user_id TEXT, p_hidden BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hidden_at TIMESTAMPTZ := CASE WHEN p_hidden THEN NOW() ELSE NULL END;
  v_participant_rows INT := 0;
  v_voter_rows INT := 0;
BEGIN
  PERFORM 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.participants SET hidden_at = v_hidden_at
  WHERE room_id = p_room_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_participant_rows = ROW_COUNT;
  UPDATE public.room_voter_registrations SET hidden_at = v_hidden_at
  WHERE room_id = p_room_id AND user_id = p_user_id
    AND status IN ('WAITING', 'ACTIVE');
  GET DIAGNOSTICS v_voter_rows = ROW_COUNT;
  IF v_participant_rows + v_voter_rows = 0 THEN
    RAISE EXCEPTION '이 회의실을 보관할 권한이 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'archived', p_hidden, 'roomId', p_room_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_archive_v12(TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;
