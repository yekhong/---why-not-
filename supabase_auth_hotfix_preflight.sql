-- WhyNot authentication hotfix preflight (READ ONLY)
-- Run in the Supabase project actually used by WhyNot. Do not run the
-- forward file if rooms/participants are missing: that means the wrong
-- project is open.

SELECT current_database() AS database_name,
       current_user AS execution_role,
       NOW() AS checked_at;

SELECT to_regclass('public.rooms') AS rooms,
       to_regclass('public.participants') AS participants,
       to_regclass('public.user_accounts') AS user_accounts,
       to_regclass('public.user_sessions') AS user_sessions;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_accounts', 'user_sessions')
ORDER BY table_name, ordinal_position;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_accounts', 'user_sessions')
ORDER BY tablename, policyname;

