-- =============================================================================
-- WHYNOT V14 RELEASE HARDENING
-- 1) Real PDF reference assets (private Supabase Storage)
-- 2) Backward-compatible idea metadata columns
--
-- IMPORTANT
-- - Apply this forward migration to the existing Supabase project.
-- - Do NOT re-run supabase_master_migration_full.sql on an existing production DB.
-- =============================================================================

BEGIN;

ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS pdf_attachment_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_attachment_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_attachment_size BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ideas_pdf_attachment_size_v14_check'
      AND conrelid = 'public.ideas'::regclass
  ) THEN
    ALTER TABLE public.ideas
      ADD CONSTRAINT ideas_pdf_attachment_size_v14_check
      CHECK (
        pdf_attachment_size IS NULL
        OR (pdf_attachment_size > 0 AND pdf_attachment_size <= 10485760)
      );
  END IF;
END $$;

-- Private bucket. Files are never exposed with a permanent public URL.
-- Uploads use short-lived signed upload URLs issued by the application server.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'idea-pdfs',
  'idea-pdfs',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON COLUMN public.ideas.pdf_attachment_path IS
  'V14: private Supabase Storage path for a real PDF reference file';
COMMENT ON COLUMN public.ideas.pdf_attachment_name IS
  'V14: original PDF display name; server redacts it for non-authors to protect anonymity';
COMMENT ON COLUMN public.ideas.pdf_attachment_size IS
  'V14: PDF size in bytes; max 10 MiB';

COMMIT;
