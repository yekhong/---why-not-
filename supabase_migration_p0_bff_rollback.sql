-- WhyNot P0 containment support-object rollback
-- REVIEW ONLY. This does not reopen the insecure browser access removed by the
-- forward migration. Restore reviewed grants from the preflight export only if
-- the former browser-direct architecture is intentionally restored.

BEGIN;

DROP FUNCTION IF EXISTS public.bff_finalize_star_vote(TEXT, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.bff_join_room_via_invite(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.bff_recover_account(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.bff_apply_elimination_round(
  TEXT, TEXT, TEXT[], TEXT, INTEGER, TEXT, TEXT[]
);

DROP TABLE IF EXISTS public.star_votes;
DROP TABLE IF EXISTS public.phase_completions;
DROP TABLE IF EXISTS public.user_sessions;

-- elimination_rounds is intentionally retained. It contains decision history
-- and may have existed before this migration because the forward script uses
-- CREATE TABLE IF NOT EXISTS. A rollback must not guess ownership and destroy
-- potentially pre-existing or newly-created audit data.

DROP INDEX IF EXISTS public.idx_room_invites_token_hash;
ALTER TABLE public.room_invites DROP COLUMN IF EXISTS invite_token_hash;

ALTER TABLE public.criterion_proposals
  DROP COLUMN IF EXISTS is_ai_suggested;

-- Intentionally keep rooms private. Old tokens remain inactive.
ALTER TABLE public.rooms ALTER COLUMN is_public SET DEFAULT FALSE;

COMMIT;
