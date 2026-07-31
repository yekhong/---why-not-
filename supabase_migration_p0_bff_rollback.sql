-- WhyNot P0 containment rollback (FOR REVIEW ONLY — do not auto-run)
--
-- This rollback removes only the new supporting objects. It intentionally does
-- NOT restore the former USING(true) policies or anon/authenticated grants,
-- because doing so would reopen the verified P0 exposure.
--
-- To restore a pre-containment database, restore a reviewed Supabase backup
-- instead of recreating permissive policies by hand.

BEGIN;

DROP INDEX IF EXISTS public.idx_room_invites_token_hash;
ALTER TABLE public.room_invites DROP COLUMN IF EXISTS invite_token_hash;

ALTER TABLE public.criterion_proposals
  DROP COLUMN IF EXISTS is_ai_suggested;

DROP TABLE IF EXISTS public.phase_completions;
DROP TABLE IF EXISTS public.user_sessions;

-- Keep all existing rooms private after rollback.
ALTER TABLE public.rooms ALTER COLUMN is_public SET DEFAULT FALSE;

COMMIT;
