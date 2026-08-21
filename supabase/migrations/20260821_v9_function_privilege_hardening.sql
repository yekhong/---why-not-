-- WHY-NOT V9 function privilege hardening
-- Purpose: remove direct browser execution from server-only SECURITY DEFINER
-- RPCs and internal trigger functions. This migration changes privileges only.

BEGIN;

-- The endpoint that called this legacy SECURITY DEFINER function was removed.
-- It is absent from the current master schema, so remove the remaining direct
-- RPC surface from the live database as well.
DROP FUNCTION IF EXISTS public.purge_dead_rooms();

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

-- All three issue_count values must be 0.
WITH target_functions(function_name) AS (
  VALUES
    ('bump_parent_room_state_version_v9'),
    ('bump_room_row_state_version_v9'),
    ('expire_participant_invites_v9'),
    ('create_room_account_invite_v9'),
    ('create_room_with_host_v9'),
    ('create_room_invite_v9'),
    ('cancel_room_account_invite_v9'),
    ('accept_room_account_invites_v9'),
    ('join_room_v9'),
    ('cancel_room_voter_registration_v9'),
    ('start_final_vote_roster_v9'),
    ('cancel_incomplete_final_vote_cycle_v9'),
    ('finalize_room_winners_v9'),
    ('get_room_state_v9')
), server_rpcs(function_name) AS (
  VALUES
    ('create_room_account_invite_v9'),
    ('create_room_with_host_v9'),
    ('create_room_invite_v9'),
    ('cancel_room_account_invite_v9'),
    ('accept_room_account_invites_v9'),
    ('join_room_v9'),
    ('cancel_room_voter_registration_v9'),
    ('start_final_vote_roster_v9'),
    ('cancel_incomplete_final_vote_cycle_v9'),
    ('finalize_room_winners_v9'),
    ('get_room_state_v9')
)
SELECT 'browser_execute_on_v9_functions' AS check_name, COUNT(*)::BIGINT AS issue_count
FROM information_schema.routine_privileges privilege
JOIN target_functions target ON target.function_name = privilege.routine_name
WHERE privilege.specific_schema = 'public'
  AND privilege.privilege_type = 'EXECUTE'
  AND privilege.grantee IN ('PUBLIC', 'anon', 'authenticated')
UNION ALL
SELECT 'service_role_missing_v9_rpc_access', COUNT(*)::BIGINT
FROM server_rpcs rpc
WHERE NOT EXISTS (
  SELECT 1
  FROM information_schema.routine_privileges privilege
  WHERE privilege.specific_schema = 'public'
    AND privilege.routine_name = rpc.function_name
    AND privilege.privilege_type = 'EXECUTE'
    AND privilege.grantee = 'service_role'
)
UNION ALL
SELECT 'legacy_purge_function_present', COUNT(*)::BIGINT
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'purge_dead_rooms';
