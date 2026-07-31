-- WhyNot authentication hotfix postflight (READ ONLY)

SELECT to_regclass('public.user_accounts') IS NOT NULL AS user_accounts_exists,
       to_regclass('public.user_sessions') IS NOT NULL AS user_sessions_exists;

SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('user_accounts', 'user_sessions')
ORDER BY c.relname;
-- Expected: both rows are true/true.

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('user_accounts', 'user_sessions')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;
-- Expected: zero rows.

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_accounts', 'user_sessions')
ORDER BY table_name, ordinal_position;

