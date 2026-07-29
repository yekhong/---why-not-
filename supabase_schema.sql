-- ==========================================
-- WHY NOT (고민하조) Supabase DB Schema & RLS
-- ==========================================

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    nickname TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Rooms Table
CREATE TABLE IF NOT EXISTS public.rooms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT '기획',
    is_public BOOLEAN DEFAULT true,
    max_participants INTEGER DEFAULT 6,
    target_winner_count INTEGER DEFAULT 1,
    is_pinned BOOLEAN DEFAULT false,
    host_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'IDEA_SUBMISSION',
    min_response_threshold INTEGER DEFAULT 3,
    elimination_config JSONB DEFAULT '{"countPerRound": 1, "tieBreak": "random"}'::jsonb,
    deadlines JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Ideas Table
CREATE TABLE IF NOT EXISTS public.ideas (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    submitter_id TEXT NOT NULL,
    submitter_name TEXT,
    attachment_url TEXT,
    pdf_attachment_url TEXT,
    tags TEXT[],
    status TEXT DEFAULT 'ACTIVE',
    eliminated_round INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Criteria Table
CREATE TABLE IF NOT EXISTS public.criteria (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    source_cluster_id TEXT,
    confirmed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Criterion Proposals Table
CREATE TABLE IF NOT EXISTS public.criterion_proposals (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    proposer_id TEXT,
    cluster_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Participants Table
CREATE TABLE IF NOT EXISTS public.participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    nickname TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Evaluations Table
CREATE TABLE IF NOT EXISTS public.evaluations (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    idea_id TEXT NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    evaluator_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    excluded_criterion_ids TEXT[],
    reason_text TEXT,
    reason_type TEXT,
    round INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- ENABLE ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criterion_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- RLS POLICIES
-- ==========================================

-- Profiles Policies
DROP POLICY IF EXISTS "Anyone can select profiles" ON public.profiles;
CREATE POLICY "Anyone can select profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Rooms Policies
DROP POLICY IF EXISTS "Anyone can select rooms" ON public.rooms;
CREATE POLICY "Anyone can select rooms" ON public.rooms FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert rooms" ON public.rooms;
CREATE POLICY "Anyone can insert rooms" ON public.rooms FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Host can update rooms" ON public.rooms;
CREATE POLICY "Host can update rooms" ON public.rooms FOR UPDATE USING (true);

-- Ideas Policies
DROP POLICY IF EXISTS "Anyone can select ideas" ON public.ideas;
CREATE POLICY "Anyone can select ideas" ON public.ideas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert ideas" ON public.ideas;
CREATE POLICY "Anyone can insert ideas" ON public.ideas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Submitter can update ideas" ON public.ideas;
CREATE POLICY "Submitter can update ideas" ON public.ideas FOR UPDATE USING (true);

-- Criteria Policies
DROP POLICY IF EXISTS "Anyone can select criteria" ON public.criteria;
CREATE POLICY "Anyone can select criteria" ON public.criteria FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert criteria" ON public.criteria;
CREATE POLICY "Anyone can insert criteria" ON public.criteria FOR INSERT WITH CHECK (true);

-- Criterion Proposals Policies
DROP POLICY IF EXISTS "Anyone can select proposals" ON public.criterion_proposals;
CREATE POLICY "Anyone can select proposals" ON public.criterion_proposals FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert proposals" ON public.criterion_proposals;
CREATE POLICY "Anyone can insert proposals" ON public.criterion_proposals FOR INSERT WITH CHECK (true);

-- Participants Policies
DROP POLICY IF EXISTS "Anyone can select participants" ON public.participants;
CREATE POLICY "Anyone can select participants" ON public.participants FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert participants" ON public.participants;
CREATE POLICY "Anyone can insert participants" ON public.participants FOR INSERT WITH CHECK (true);

-- Evaluations Policies
DROP POLICY IF EXISTS "Anyone can select evaluations" ON public.evaluations;
CREATE POLICY "Anyone can select evaluations" ON public.evaluations FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert evaluations" ON public.evaluations;
CREATE POLICY "Anyone can insert evaluations" ON public.evaluations FOR INSERT WITH CHECK (true);

-- ==========================================
-- AUTOMATIC PROFILE CREATION TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nickname)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'full_name', new.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- 8. Room Invites Table & Unique Constraints
-- ==========================================
CREATE TABLE IF NOT EXISTS public.room_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    invite_token TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_invites_token ON public.room_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_room_invites_room_id ON public.room_invites(room_id);

ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS unique_room_participant;
ALTER TABLE public.participants ADD CONSTRAINT unique_room_participant UNIQUE (room_id, user_id);

ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can select active room invites" ON public.room_invites;
CREATE POLICY "Anyone can select active room invites" ON public.room_invites FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert room invites" ON public.room_invites;
CREATE POLICY "Anyone can insert room invites" ON public.room_invites FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update room invites" ON public.room_invites;
CREATE POLICY "Anyone can update room invites" ON public.room_invites FOR UPDATE USING (true);
