-- ==============================================================================
-- Supabase Migration: Auto Purge Function for Dead Rooms
-- ==============================================================================

-- 1. Ensure hidden_at column exists on participants
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ NULL;

-- 2. Function to purge rooms where ALL participants have hidden/deleted for over 30 days
CREATE OR REPLACE FUNCTION public.purge_dead_rooms()
RETURNS integer AS $$
DECLARE
  purged_count integer := 0;
BEGIN
  -- Delete rooms where all members have left/hidden > 30 days ago
  DELETE FROM public.rooms
  WHERE id IN (
    SELECT r.id
    FROM public.rooms r
    JOIN public.participants p ON r.id = p.room_id
    GROUP BY r.id
    HAVING COUNT(p.user_id) > 0 
       AND COUNT(CASE WHEN p.hidden_at IS NULL THEN 1 END) = 0
       AND MAX(p.hidden_at) < (NOW() - INTERVAL '30 days')
  );

  GET DIAGNOSTICS purged_count = ROW_COUNT;
  RETURN purged_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
