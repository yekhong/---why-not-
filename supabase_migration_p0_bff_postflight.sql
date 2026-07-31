-- WhyNot P0 BFF postflight (READ ONLY)

SELECT table_name, privilege_type, grantee
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'user_accounts', 'user_sessions', 'rooms', 'participants', 'ideas',
    'criterion_proposals', 'criteria', 'evaluations', 'elimination_rounds',
    'room_invites', 'phase_completions', 'star_votes'
  )
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;
-- Expected result: zero rows.

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'user_accounts', 'user_sessions', 'rooms', 'participants', 'ideas',
    'criterion_proposals', 'criteria', 'evaluations', 'elimination_rounds',
    'room_invites', 'phase_completions', 'star_votes'
  )
ORDER BY c.relname;
-- Expected: rls_enabled=true and rls_forced=true for every listed table.

SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'bff_recover_account',
    'bff_join_room_via_invite',
    'bff_finalize_star_vote',
    'bff_apply_elimination_round'
  )
ORDER BY p.proname;
-- Expected: anon=false, authenticated=false, service_role=true.

SELECT
  to_regclass('public.user_sessions') IS NOT NULL AS user_sessions_exists,
  to_regclass('public.phase_completions') IS NOT NULL AS phase_completions_exists,
  to_regclass('public.star_votes') IS NOT NULL AS star_votes_exists,
  to_regclass('public.elimination_rounds') IS NOT NULL AS elimination_rounds_exists;
