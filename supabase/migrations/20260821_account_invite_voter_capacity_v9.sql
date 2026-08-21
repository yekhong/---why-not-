-- =============================================================================
-- WhyNot V9: 계정 초대, 참여자/외부 투표자 분리, 최종 투표 명단 고정,
--             가벼운 상태 동기화를 위한 state_version
--
-- 기존 투표 계산식과 완료된 회차 결과는 변경하지 않는다.
-- =============================================================================

BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS external_voters_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS required_voter_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_vote_roster_locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_required_voter_count_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_required_voter_count_check
  CHECK (required_voter_count BETWEEN 0 AND 30);
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_external_voter_settings_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_external_voter_settings_check CHECK (
  (external_voters_enabled AND required_voter_count BETWEEN 1 AND 30)
  OR (NOT external_voters_enabled AND required_voter_count = 0)
);

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'PARTICIPANT';
UPDATE public.participants SET role = 'PARTICIPANT'
WHERE role IS NULL OR role NOT IN ('PARTICIPANT', 'VOTER');
ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_role_check;
ALTER TABLE public.participants ADD CONSTRAINT participants_role_check
  CHECK (role IN ('PARTICIPANT', 'VOTER'));

ALTER TABLE public.room_invites
  ADD COLUMN IF NOT EXISTS invite_type TEXT NOT NULL DEFAULT 'PARTICIPANT';
ALTER TABLE public.room_invites DROP CONSTRAINT IF EXISTS room_invites_type_check;
ALTER TABLE public.room_invites ADD CONSTRAINT room_invites_type_check
  CHECK (invite_type IN ('PARTICIPANT', 'VOTER'));

-- 이전 버전에서 같은 유형의 활성 링크가 여러 개 생성되었을 수 있다.
-- 가장 최근 링크 하나만 남긴 뒤 유형별 활성 링크를 하나로 제한한다.
WITH ranked_active_invites AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY room_id, invite_type ORDER BY created_at DESC, id DESC
  ) AS row_number
  FROM public.room_invites
  WHERE is_active = TRUE
)
UPDATE public.room_invites target
SET is_active = FALSE
FROM ranked_active_invites ranked
WHERE target.id = ranked.id AND ranked.row_number > 1;
CREATE UNIQUE INDEX IF NOT EXISTS room_invites_one_active_type_idx
  ON public.room_invites(room_id, invite_type)
  WHERE is_active = TRUE;

ALTER TABLE public.room_phase_participants
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'PARTICIPANT';
ALTER TABLE public.room_phase_participants DROP CONSTRAINT IF EXISTS room_phase_participants_role_check;
ALTER TABLE public.room_phase_participants ADD CONSTRAINT room_phase_participants_role_check
  CHECK (role IN ('PARTICIPANT', 'VOTER'));

CREATE TABLE IF NOT EXISTS public.room_account_invites (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  invited_login_id TEXT NOT NULL,
  invited_user_id UUID NOT NULL REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  invite_role TEXT NOT NULL CHECK (invite_role IN ('PARTICIPANT', 'VOTER')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ NULL,
  canceled_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS room_account_invites_one_pending_idx
  ON public.room_account_invites(room_id, invited_login_id, invite_role)
  WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS room_account_invites_one_pending_user_idx
  ON public.room_account_invites(room_id, invited_user_id)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS room_account_invites_user_status_idx
  ON public.room_account_invites(invited_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.room_voter_registrations (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ACCOUNT', 'LINK', 'PARTICIPANT_FALLBACK')),
  status TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'ACTIVE', 'CANCELED')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS room_voter_registrations_room_status_idx
  ON public.room_voter_registrations(room_id, status, registered_at);

ALTER TABLE public.room_account_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_voter_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_account_invites FROM anon, authenticated;
REVOKE ALL ON public.room_voter_registrations FROM anon, authenticated;
GRANT ALL ON public.room_account_invites TO service_role;
GRANT ALL ON public.room_voter_registrations TO service_role;

-- 방과 방장 참여자를 하나의 트랜잭션으로 생성한다.
CREATE OR REPLACE FUNCTION public.create_room_with_host_v9(
  p_room JSONB,
  p_host_user_id TEXT,
  p_host_nickname TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.rooms(
    id, title, description, category, is_public, max_participants,
    target_winner_count, is_pinned, host_id, status, min_response_threshold,
    elimination_config, deadlines, engine_version, decision_mode,
    external_voters_enabled, required_voter_count,
    refinement_enabled, max_refinement_rounds
  ) VALUES (
    p_room->>'id', p_room->>'title', COALESCE(p_room->>'description', ''),
    COALESCE(p_room->>'category', '기획'), FALSE,
    (p_room->>'max_participants')::INT,
    (p_room->>'target_winner_count')::INT, FALSE, p_host_user_id,
    COALESCE(p_room->>'status', 'IDEA_SUBMISSION'),
    (p_room->>'min_response_threshold')::INT,
    COALESCE(p_room->'elimination_config', '{}'::JSONB),
    COALESCE(p_room->'deadlines', '{}'::JSONB),
    (p_room->>'engine_version')::INT,
    COALESCE(p_room->>'decision_mode', 'STRUCTURED'),
    COALESCE((p_room->>'external_voters_enabled')::BOOLEAN, FALSE),
    COALESCE((p_room->>'required_voter_count')::INT, 0),
    COALESCE((p_room->>'refinement_enabled')::BOOLEAN, FALSE),
    COALESCE((p_room->>'max_refinement_rounds')::INT, 0)
  );
  INSERT INTO public.participants(room_id, user_id, nickname, role)
  VALUES (p_room->>'id', p_host_user_id, LEFT(COALESCE(NULLIF(BTRIM(p_host_nickname), ''), '방장'), 6), 'PARTICIPANT');

  IF NULLIF(p_room->>'participant_invite_token_hash', '') IS NOT NULL THEN
    INSERT INTO public.room_invites(
      room_id, invite_token, invite_token_hash, created_by, expires_at, is_active, invite_type
    ) VALUES (
      p_room->>'id', NULL, p_room->>'participant_invite_token_hash', p_host_user_id,
      (p_room->>'participant_invite_expires_at')::TIMESTAMPTZ, TRUE, 'PARTICIPANT'
    );
  END IF;
  IF COALESCE((p_room->>'external_voters_enabled')::BOOLEAN, FALSE)
     AND NULLIF(p_room->>'voter_invite_token_hash', '') IS NOT NULL THEN
    INSERT INTO public.room_invites(
      room_id, invite_token, invite_token_hash, created_by, expires_at, is_active, invite_type
    ) VALUES (
      p_room->>'id', NULL, p_room->>'voter_invite_token_hash', p_host_user_id,
      (p_room->>'voter_invite_expires_at')::TIMESTAMPTZ, TRUE, 'VOTER'
    );
  END IF;
  RETURN jsonb_build_object(
    'success', TRUE,
    'roomId', p_room->>'id',
    'stateVersion', (SELECT state_version::TEXT FROM public.rooms WHERE id = p_room->>'id')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_invite_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_invite_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_invite_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_type TEXT := UPPER(BTRIM(COALESCE(p_invite_type, 'PARTICIPANT')));
  v_id UUID;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 초대 링크를 만들 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_type NOT IN ('PARTICIPANT', 'VOTER') THEN
    RAISE EXCEPTION '지원하지 않는 초대 유형입니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_type = 'PARTICIPANT' AND v_room.status <> 'IDEA_SUBMISSION' THEN
    RAISE EXCEPTION '참여자 링크는 아이디어 등록 단계에서만 만들 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_type = 'VOTER' AND (
    NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1
    OR v_room.final_vote_roster_locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '현재는 외부 투표자 링크를 만들 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at <= NOW() OR NULLIF(BTRIM(p_invite_token_hash), '') IS NULL THEN
    RAISE EXCEPTION '초대 링크 정보가 올바르지 않습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.room_invites SET is_active = FALSE
  WHERE room_id = p_room_id AND invite_type = v_type AND is_active = TRUE;
  INSERT INTO public.room_invites(
    room_id, invite_token, invite_token_hash, created_by, expires_at, is_active, invite_type
  ) VALUES (
    p_room_id, NULL, p_invite_token_hash, p_host_user_id, p_expires_at, TRUE, v_type
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', TRUE, 'id', v_id, 'inviteType', v_type);
END;
$$;

-- 회의실 자체 변경은 상태 버전을 한 번 올린다. 호출자가 이미 더 큰 버전을
-- 지정한 경우에는 그 값을 보존해 자식 트리거와 중복 증가하지 않는다.
CREATE OR REPLACE FUNCTION public.bump_room_row_state_version_v9()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.state_version IS NOT DISTINCT FROM OLD.state_version THEN
    NEW.state_version := OLD.state_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_bump_state_version_v9 ON public.rooms;
CREATE TRIGGER rooms_bump_state_version_v9
BEFORE UPDATE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.bump_room_row_state_version_v9();

CREATE OR REPLACE FUNCTION public.bump_parent_room_state_version_v9()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id TEXT;
BEGIN
  v_room_id := COALESCE(to_jsonb(NEW)->>TG_ARGV[0], to_jsonb(OLD)->>TG_ARGV[0]);
  IF v_room_id IS NOT NULL THEN
    UPDATE public.rooms SET state_version = state_version + 1 WHERE id = v_room_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'participants', 'ideas', 'criteria', 'criterion_proposals',
    'criterion_approvals', 'phase_completions', 'room_phase_participants',
    'evaluations', 'evaluation_rounds', 'evaluation_round_participants',
    'round_candidates', 'decision_votes', 'ai_reports', 'idea_versions',
    'candidate_feedback', 'refinement_cycles', 'refinement_cycle_votes',
    'round_deadline_audit', 'final_vote_cycles',
    'final_vote_ballots', 'final_roulette_consents', 'final_roulette_draws',
    'room_invites', 'room_account_invites', 'room_voter_registrations'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_bump_room_v9', v_table);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.bump_parent_room_state_version_v9(''room_id'')',
        v_table || '_bump_room_v9', v_table
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_account_invite_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_login_id TEXT,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_account public.user_accounts%ROWTYPE;
  v_login_id TEXT := LOWER(BTRIM(p_login_id));
  v_role TEXT := UPPER(BTRIM(p_role));
  v_used INT;
  v_invite public.room_account_invites%ROWTYPE;
BEGIN
  IF v_role NOT IN ('PARTICIPANT', 'VOTER') THEN
    RAISE EXCEPTION '지원하지 않는 초대 역할입니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 계정 초대를 만들 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 초대를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_account FROM public.user_accounts
  WHERE login_id = v_login_id AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION '가입되어 있는 활성 계정을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_account.id::TEXT = v_room.host_id THEN
    RAISE EXCEPTION '방장 계정은 다시 초대할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.room_account_invites
    WHERE room_id = p_room_id AND invited_user_id = v_account.id AND status = 'PENDING'
  ) THEN
    RAISE EXCEPTION '이 계정에는 이미 대기 중인 초대가 있습니다.' USING ERRCODE = 'P0001';
  END IF;

  IF v_role = 'PARTICIPANT' THEN
    IF v_room.status <> 'IDEA_SUBMISSION' THEN
      RAISE EXCEPTION '참여자 계정 초대는 아이디어 등록 단계에서만 가능합니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.participants
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT AND role = 'PARTICIPANT') THEN
      RAISE EXCEPTION '이미 이 회의실에 참여 중인 계정입니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.room_voter_registrations
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT
        AND status IN ('WAITING', 'ACTIVE')) THEN
      RAISE EXCEPTION '이미 외부 투표자로 등록된 계정입니다.' USING ERRCODE = 'P0001';
    END IF;
    SELECT
      (SELECT COUNT(*) FROM public.participants
       WHERE room_id = p_room_id AND role = 'PARTICIPANT')
      +
      (SELECT COUNT(*) FROM public.room_account_invites
       WHERE room_id = p_room_id AND invite_role = 'PARTICIPANT' AND status = 'PENDING')
    INTO v_used;
    IF v_used >= v_room.max_participants THEN
      RAISE EXCEPTION '참여자 정원과 예약 좌석이 모두 찼습니다.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1 THEN
      RAISE EXCEPTION '외부 투표자 사용이 활성화되지 않았습니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.participants
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT AND role = 'PARTICIPANT') THEN
      RAISE EXCEPTION '기존 참여자는 외부 투표자로 중복 등록할 수 없습니다.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.room_voter_registrations
      WHERE room_id = p_room_id AND user_id = v_account.id::TEXT
        AND status IN ('WAITING', 'ACTIVE')) THEN
      RAISE EXCEPTION '이미 외부 투표자로 등록된 계정입니다.' USING ERRCODE = 'P0001';
    END IF;
    SELECT
      (SELECT COUNT(*) FROM public.room_voter_registrations
       WHERE room_id = p_room_id AND status IN ('WAITING', 'ACTIVE'))
      +
      (SELECT COUNT(*) FROM public.room_account_invites
       WHERE room_id = p_room_id AND invite_role = 'VOTER' AND status = 'PENDING')
    INTO v_used;
    IF v_used >= v_room.required_voter_count THEN
      RAISE EXCEPTION '설정한 외부 투표자 인원이 모두 예약되었습니다.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.room_account_invites(
    id, room_id, invited_login_id, invited_user_id, invite_role, status, created_by
  ) VALUES (
    'account-invite-' || gen_random_uuid()::TEXT, p_room_id, v_login_id,
    v_account.id, v_role, 'PENDING', p_host_user_id
  ) RETURNING * INTO v_invite;

  RETURN jsonb_build_object(
    'id', v_invite.id, 'roomId', v_invite.room_id,
    'loginId', v_invite.invited_login_id, 'role', v_invite.invite_role,
    'status', v_invite.status, 'createdAt', v_invite.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_room_account_invite_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_invite_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 초대를 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 초대를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.room_account_invites
  SET status = 'CANCELED', canceled_at = NOW()
  WHERE id = p_invite_id AND room_id = p_room_id AND status = 'PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION '취소할 대기 초대를 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('success', TRUE, 'inviteId', p_invite_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_room_account_invites_v9(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_accounts%ROWTYPE;
  v_invite public.room_account_invites%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_participant_count INT;
  v_matched JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_account FROM public.user_accounts
  WHERE id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RETURN v_matched; END IF;

  FOR v_invite IN
    SELECT * FROM public.room_account_invites
    WHERE invited_user_id = p_user_id AND status = 'PENDING'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_room FROM public.rooms WHERE id = v_invite.room_id FOR UPDATE;
    IF NOT FOUND OR v_room.status = 'CLOSED' THEN
      UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
      WHERE id = v_invite.id;
      CONTINUE;
    END IF;

    IF v_invite.invite_role = 'PARTICIPANT' THEN
      IF v_room.status <> 'IDEA_SUBMISSION' THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      SELECT COUNT(*) INTO v_participant_count FROM public.participants
      WHERE room_id = v_room.id AND role = 'PARTICIPANT';
      IF v_participant_count >= v_room.max_participants THEN
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.room_voter_registrations
        WHERE room_id = v_room.id AND user_id = p_user_id::TEXT
          AND status IN ('WAITING', 'ACTIVE')) THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      INSERT INTO public.participants(room_id, user_id, nickname, role)
      VALUES (v_room.id, p_user_id::TEXT, v_account.nickname, 'PARTICIPANT')
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname, role = 'PARTICIPANT';
    ELSE
      IF NOT v_room.external_voters_enabled OR v_room.final_vote_roster_locked_at IS NOT NULL THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.participants
        WHERE room_id = v_room.id AND user_id = p_user_id::TEXT AND role = 'PARTICIPANT') THEN
        UPDATE public.room_account_invites SET status = 'EXPIRED', canceled_at = NOW()
        WHERE id = v_invite.id;
        CONTINUE;
      END IF;
      SELECT COUNT(*) INTO v_participant_count FROM public.room_voter_registrations
      WHERE room_id = v_room.id AND status IN ('WAITING', 'ACTIVE')
        AND user_id <> p_user_id::TEXT;
      IF v_participant_count >= v_room.required_voter_count THEN
        CONTINUE;
      END IF;
      INSERT INTO public.room_voter_registrations(room_id, user_id, nickname, source, status)
      VALUES (v_room.id, p_user_id::TEXT, v_account.nickname, 'ACCOUNT', 'WAITING')
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname, source = 'ACCOUNT', status = 'WAITING';
    END IF;

    UPDATE public.room_account_invites
    SET status = 'ACCEPTED', accepted_at = NOW()
    WHERE id = v_invite.id;
    v_matched := v_matched || jsonb_build_array(jsonb_build_object(
      'roomId', v_room.id, 'role', v_invite.invite_role,
      'waiting', v_invite.invite_role = 'VOTER'
    ));
  END LOOP;
  RETURN v_matched;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room_v9(
  p_room_id TEXT,
  p_user_id TEXT,
  p_nickname TEXT,
  p_invite_type TEXT,
  p_allow_voter_fallback BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_role TEXT := UPPER(BTRIM(COALESCE(p_invite_type, 'PARTICIPANT')));
  v_existing_role TEXT;
  v_existing_voter_status TEXT;
  v_participant_count INT;
  v_reserved_count INT;
  v_voter_count INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001'; END IF;
  IF v_room.status = 'CLOSED' THEN RAISE EXCEPTION '이미 종료된 회의실입니다.' USING ERRCODE = 'P0001'; END IF;

  SELECT role INTO v_existing_role FROM public.participants
  WHERE room_id = p_room_id AND user_id = p_user_id;
  SELECT status INTO v_existing_voter_status FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND user_id = p_user_id
    AND status IN ('WAITING', 'ACTIVE');
  IF v_existing_role = 'PARTICIPANT' THEN
    RETURN jsonb_build_object('success', TRUE, 'alreadyMember', TRUE, 'role', 'PARTICIPANT', 'waiting', FALSE);
  END IF;
  IF v_existing_voter_status IN ('WAITING', 'ACTIVE') THEN
    RETURN jsonb_build_object(
      'success', TRUE, 'alreadyMember', TRUE, 'role', 'VOTER',
      'waiting', v_existing_voter_status = 'WAITING'
    );
  END IF;

  IF v_role = 'PARTICIPANT' THEN
    IF v_room.status <> 'IDEA_SUBMISSION' THEN
      RAISE EXCEPTION '새 참여자는 아이디어 등록 단계에서만 참가할 수 있습니다.' USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_participant_count FROM public.participants
    WHERE room_id = p_room_id AND role = 'PARTICIPANT';
    SELECT COUNT(*) INTO v_reserved_count FROM public.room_account_invites
    WHERE room_id = p_room_id AND invite_role = 'PARTICIPANT' AND status = 'PENDING'
      AND invited_user_id::TEXT <> p_user_id;
    IF v_participant_count + v_reserved_count >= v_room.max_participants THEN
      IF NOT p_allow_voter_fallback OR NOT v_room.external_voters_enabled THEN
        RAISE EXCEPTION 'PARTICIPANT_FULL_VOTER_AVAILABLE' USING ERRCODE = 'P0001';
      END IF;
      v_role := 'VOTER';
    ELSE
      INSERT INTO public.participants(room_id, user_id, nickname, role)
      VALUES (p_room_id, p_user_id, p_nickname, 'PARTICIPANT')
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname, role = 'PARTICIPANT';
      UPDATE public.room_account_invites
      SET status = 'ACCEPTED', accepted_at = NOW()
      WHERE room_id = p_room_id AND invited_user_id::TEXT = p_user_id
        AND invite_role = 'PARTICIPANT' AND status = 'PENDING';
      RETURN jsonb_build_object('success', TRUE, 'alreadyMember', FALSE, 'role', 'PARTICIPANT', 'waiting', FALSE);
    END IF;
  END IF;

  IF v_role <> 'VOTER' THEN
    RAISE EXCEPTION '지원하지 않는 초대 유형입니다.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_room.external_voters_enabled OR v_room.required_voter_count < 1 THEN
    RAISE EXCEPTION '외부 투표자 모집이 활성화되지 않았습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 이미 확정되었습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.participants
    WHERE room_id = p_room_id AND user_id = p_user_id AND role = 'PARTICIPANT') THEN
    RAISE EXCEPTION '기존 참여자는 외부 투표자로 중복 등록할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_voter_count FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status IN ('WAITING', 'ACTIVE') AND user_id <> p_user_id;
  SELECT COUNT(*) INTO v_reserved_count FROM public.room_account_invites
  WHERE room_id = p_room_id AND invite_role = 'VOTER' AND status = 'PENDING'
    AND invited_user_id::TEXT <> p_user_id;
  IF v_voter_count + v_reserved_count >= v_room.required_voter_count THEN
    RAISE EXCEPTION '설정한 외부 투표자 인원이 모두 등록되었습니다.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.room_voter_registrations(room_id, user_id, nickname, source, status)
  VALUES (
    p_room_id, p_user_id, p_nickname,
    CASE WHEN p_allow_voter_fallback THEN 'PARTICIPANT_FALLBACK' ELSE 'LINK' END,
    'WAITING'
  ) ON CONFLICT (room_id, user_id) DO UPDATE
  SET nickname = EXCLUDED.nickname, source = EXCLUDED.source, status = 'WAITING';
  UPDATE public.room_account_invites
  SET status = 'ACCEPTED', accepted_at = NOW()
  WHERE room_id = p_room_id AND invited_user_id::TEXT = p_user_id
    AND invite_role = 'VOTER' AND status = 'PENDING';
  RETURN jsonb_build_object('success', TRUE, 'alreadyMember', FALSE, 'role', 'VOTER', 'waiting', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_room_voter_registration_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_voter_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 외부 투표자 등록을 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    RAISE EXCEPTION '최종 투표 명단이 확정되어 외부 투표자를 변경할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.room_voter_registrations
  SET status = 'CANCELED', activated_at = NULL
  WHERE room_id = p_room_id AND user_id = p_voter_user_id AND status = 'WAITING';
  IF NOT FOUND THEN
    RAISE EXCEPTION '취소할 대기 외부 투표자를 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'userId', p_voter_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_final_vote_roster_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_phase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_registered INT;
  v_expected INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 최종 투표를 시작할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_room.final_vote_roster_locked_at IS NOT NULL THEN
    SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
    WHERE room_id = p_room_id AND phase = p_phase;
    RETURN jsonb_build_object('success', TRUE, 'alreadyLocked', TRUE, 'expectedCount', v_expected);
  END IF;
  IF v_room.status NOT IN ('IDEA_SUBMISSION', 'ELIMINATION') THEN
    RAISE EXCEPTION '현재 단계에서는 최종 투표를 시작할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_registered FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status = 'WAITING';
  IF v_room.external_voters_enabled AND v_registered <> v_room.required_voter_count THEN
    RAISE EXCEPTION '설정한 외부 투표자 전원이 등록되어야 시작할 수 있습니다. (%/%명)',
      v_registered, v_room.required_voter_count USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_room.external_voters_enabled AND v_registered > 0 THEN
    RAISE EXCEPTION '외부 투표자 설정을 확인해 주세요.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.participants(room_id, user_id, nickname, role)
  SELECT room_id, user_id, nickname, 'VOTER'
  FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status = 'WAITING'
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET nickname = EXCLUDED.nickname, role = 'VOTER';

  UPDATE public.room_voter_registrations
  SET status = 'ACTIVE', activated_at = NOW()
  WHERE room_id = p_room_id AND status = 'WAITING';

  DELETE FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = p_phase;
  INSERT INTO public.room_phase_participants(room_id, phase, user_id, role)
  SELECT p_room_id, p_phase, user_id, 'PARTICIPANT'
  FROM public.participants
  WHERE room_id = p_room_id AND role = 'PARTICIPANT'
  UNION ALL
  SELECT p_room_id, p_phase, user_id, 'VOTER'
  FROM public.room_voter_registrations
  WHERE room_id = p_room_id AND status = 'ACTIVE';

  UPDATE public.rooms
  SET final_vote_roster_locked_at = NOW(), final_vote_status = 'VOTING'
  WHERE id = p_room_id;
  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = p_phase;
  RETURN jsonb_build_object('success', TRUE, 'expectedCount', v_expected, 'registeredVoterCount', v_registered);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_incomplete_final_vote_cycle_v9(
  p_room_id TEXT,
  p_host_user_id TEXT,
  p_cycle_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_cycle public.final_vote_cycles%ROWTYPE;
  v_expected INT;
  v_submitted INT;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.host_id <> p_host_user_id THEN
    RAISE EXCEPTION '방장만 미완료 회차를 취소할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cycle FROM public.final_vote_cycles
  WHERE id = p_cycle_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_cycle.status <> 'VOTING' THEN
    RAISE EXCEPTION '취소할 수 있는 진행 중 회차가 아닙니다.' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_expected FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  SELECT COUNT(*) INTO v_submitted FROM public.final_vote_ballots WHERE cycle_id = p_cycle_id;
  IF v_submitted >= v_expected THEN
    RAISE EXCEPTION '전원 제출이 끝난 회차는 취소할 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.final_vote_cycles
  SET status = 'COMPLETED', completed_at = NOW(),
      result_snapshot = COALESCE(result_snapshot, '{}'::JSONB)
        || jsonb_build_object('canceled', TRUE, 'submittedCount', v_submitted, 'expectedCount', v_expected)
  WHERE id = p_cycle_id;
  DELETE FROM public.room_phase_participants
  WHERE room_id = p_room_id AND phase = 'FINAL_VOTE:' || v_cycle.decision_round_id;
  -- 과거 투표 용지는 participants(room_id,user_id)를 참조하므로 참여자 행은
  -- 보존한다. 활성 여부는 room_voter_registrations.status로만 판정한다.
  UPDATE public.room_voter_registrations
  SET status = 'WAITING', activated_at = NULL
  WHERE room_id = p_room_id AND status = 'ACTIVE';
  UPDATE public.rooms SET
    current_final_vote_cycle_id = NULL,
    final_vote_status = 'NOT_STARTED',
    final_vote_roster_locked_at = NULL,
    tie_candidate_idea_ids = ARRAY[]::TEXT[],
    tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object('success', TRUE, 'submittedCount', v_submitted, 'expectedCount', v_expected);
END;
$$;

-- 최종 후보와 방 상태를 한 트랜잭션에서 확정한다. 기존 소거 후보는
-- 그대로 보존하고 현재 활성 후보만 최종 선정/소거로 전환한다.
CREATE OR REPLACE FUNCTION public.finalize_room_winners_v9(
  p_room_id TEXT,
  p_winner_idea_ids TEXT[],
  p_selection_methods JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_winner_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE) THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.ideas
  SET
    status = CASE
      WHEN id = ANY(COALESCE(p_winner_idea_ids, ARRAY[]::TEXT[])) THEN 'WINNER'
      WHEN status = 'ACTIVE' THEN 'ELIMINATED'
      ELSE status
    END,
    winner_selection_method = CASE
      WHEN id = ANY(COALESCE(p_winner_idea_ids, ARRAY[]::TEXT[]))
        THEN COALESCE(p_selection_methods ->> id, 'CUMULATIVE_STAR')
      WHEN status = 'ACTIVE' THEN NULL
      ELSE winner_selection_method
    END
  WHERE room_id = p_room_id;
  GET DIAGNOSTICS v_winner_count = ROW_COUNT;

  UPDATE public.rooms
  SET status = 'CLOSED', final_vote_status = 'FINALIZED',
      tie_candidate_idea_ids = ARRAY[]::TEXT[], tie_slots = 0
  WHERE id = p_room_id;
  RETURN jsonb_build_object('success', TRUE, 'updatedIdeaCount', v_winner_count);
END;
$$;

-- 폴링 한 번에 접근 권한과 변경 버전을 함께 확인한다. 일반 권한 미들웨어의
-- 다중 SELECT를 우회하므로 참여자·투표자가 늘어도 상태 확인은 DB 1회다.
CREATE OR REPLACE FUNCTION public.get_room_state_v9(
  p_room_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_allowed := v_room.host_id = p_user_id
    OR EXISTS (
      SELECT 1 FROM public.participants
      WHERE room_id = p_room_id AND user_id = p_user_id AND role = 'PARTICIPANT'
    )
    OR EXISTS (
      SELECT 1 FROM public.room_voter_registrations
      WHERE room_id = p_room_id AND user_id = p_user_id
        AND status IN ('WAITING', 'ACTIVE')
    );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'ROOM_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'finalVoteStatus', v_room.final_vote_status,
    'currentRoundId', v_room.current_round_id,
    'currentFinalVoteCycleId', v_room.current_final_vote_cycle_id,
    'stateVersion', v_room.state_version::TEXT
  );
END;
$$;

-- 참여자 계정 초대의 좌석 예약은 1단계 종료 시 자동 만료된다.
CREATE OR REPLACE FUNCTION public.expire_participant_invites_v9()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'IDEA_SUBMISSION' AND NEW.status <> 'IDEA_SUBMISSION' THEN
    UPDATE public.room_account_invites
    SET status = 'EXPIRED', canceled_at = NOW()
    WHERE room_id = NEW.id AND invite_role = 'PARTICIPANT' AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rooms_expire_participant_invites_v9 ON public.rooms;
CREATE TRIGGER rooms_expire_participant_invites_v9
AFTER UPDATE OF status ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.expire_participant_invites_v9();

-- V9 RPCs are server-only. Revoking PUBLIC alone does not remove grants that
-- were assigned directly to Supabase's anon/authenticated roles.
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_parent_room_state_version_v9() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_room_row_state_version_v9() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.expire_participant_invites_v9() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_room_account_invite_v9(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_room_with_host_v9(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_room_invite_v9(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_room_account_invite_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.accept_room_account_invites_v9(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.join_room_v9(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_room_voter_registration_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.start_final_vote_roster_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_incomplete_final_vote_cycle_v9(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_room_winners_v9(TEXT, TEXT[], JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_room_state_v9(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_account_invite_v9(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_room_with_host_v9(JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_room_invite_v9(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_room_account_invite_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_room_account_invites_v9(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_room_v9(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_room_voter_registration_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_final_vote_roster_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_incomplete_final_vote_cycle_v9(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_room_winners_v9(TEXT, TEXT[], JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_room_state_v9(TEXT, TEXT) TO service_role;

COMMIT;

-- 검증 결과는 모두 0이어야 한다.
SELECT 'invalid_external_voter_settings' AS check_name, COUNT(*) AS issue_count
FROM public.rooms
WHERE (external_voters_enabled AND required_voter_count NOT BETWEEN 1 AND 30)
   OR (NOT external_voters_enabled AND required_voter_count <> 0)
UNION ALL
SELECT 'invalid_participant_roles', COUNT(*) FROM public.participants
WHERE role NOT IN ('PARTICIPANT', 'VOTER')
UNION ALL
SELECT 'duplicate_active_account_invites', COUNT(*) FROM (
  SELECT room_id, invited_login_id, invite_role
  FROM public.room_account_invites WHERE status = 'PENDING'
  GROUP BY room_id, invited_login_id, invite_role HAVING COUNT(*) > 1
) duplicate_rows
UNION ALL
SELECT 'locked_rooms_without_final_snapshot', COUNT(*)
FROM public.rooms room
WHERE room.final_vote_roster_locked_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.room_phase_participants participant
    WHERE participant.room_id = room.id AND participant.phase LIKE 'FINAL_VOTE:%'
  );
