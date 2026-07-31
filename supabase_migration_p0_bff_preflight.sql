-- WhyNot P0 BFF preflight (READ ONLY)
-- Export every result grid before applying the forward migration.

SELECT current_database() AS database_name, current_user AS execution_role, version();

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'user_accounts', 'rooms', 'participants', 'ideas', 'criterion_proposals',
    'criteria', 'evaluations', 'elimination_rounds', 'room_invites'
  )
ORDER BY table_name, ordinal_position;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       p.oid::regprocedure AS signature,
       p.prosecdef AS security_definer,
       p.proacl AS access_control
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, signature::TEXT;

SELECT
  (SELECT COUNT(*) FROM public.rooms) AS room_count,
  (SELECT COUNT(*) FROM public.participants) AS participant_count,
  (SELECT COUNT(*) FROM public.ideas) AS idea_count,
  (SELECT COUNT(*) FROM public.user_accounts) AS account_count;
