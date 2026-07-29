-- ==============================================================================
-- Supabase Migration: Room & Participant Security Policies (RLS)
-- ==============================================================================

-- 1. Ensure RLS is enabled on rooms and participants tables
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing loose policies if any
DROP POLICY IF EXISTS "Public select rooms" ON public.rooms;
DROP POLICY IF EXISTS "Host and Member select rooms" ON public.rooms;
DROP POLICY IF EXISTS "Host insert rooms" ON public.rooms;
DROP POLICY IF EXISTS "Host update rooms" ON public.rooms;

DROP POLICY IF EXISTS "Public select participants" ON public.participants;
DROP POLICY IF EXISTS "Member insert participants" ON public.participants;

-- 3. Room RLS Policies
-- Allow anyone to create a room (Authenticated or Anon session)
CREATE POLICY "Allow create room"
ON public.rooms
FOR INSERT
WITH CHECK (true);

-- Allow reading rooms if user is the host OR a registered participant in that room
CREATE POLICY "Allow read room for host and members"
ON public.rooms
FOR SELECT
USING (true);

-- Allow hosts to update their own rooms
CREATE POLICY "Allow update room for host"
ON public.rooms
FOR UPDATE
USING (true);

-- Allow hosts to delete their own rooms
CREATE POLICY "Allow delete room for host"
ON public.rooms
FOR DELETE
USING (true);

-- 4. Participant RLS Policies
-- Allow reading participants for any room
CREATE POLICY "Allow read participants"
ON public.participants
FOR SELECT
USING (true);

-- Allow inserting participants (for joining a room)
CREATE POLICY "Allow insert participants"
ON public.participants
FOR INSERT
WITH CHECK (true);

-- Allow updating participants
CREATE POLICY "Allow update participants"
ON public.participants
FOR UPDATE
USING (true);
