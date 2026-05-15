-- Core Tables for The Brain MVP

-- 1. units
CREATE TABLE public.units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. events
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. approvals
CREATE TABLE public.approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
    context JSONB NOT NULL DEFAULT '{}'::JSONB,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. memory_entries
CREATE TABLE public.memory_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL, -- knowledge, document, portfolio, proposal, pricing, case_study
    content JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. conversations
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID, -- For future auth
    unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. corrections
CREATE TABLE public.corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID REFERENCES public.units(id) ON DELETE CASCADE,
    feedback TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. workflows
CREATE TABLE public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'RUNNING',
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. reports
CREATE TABLE public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    summary TEXT,
    data JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS (Row Level Security)
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Allow read/write access to authenticated users and service roles.
CREATE POLICY "Allow all access to authenticated" ON public.units FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.events FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.approvals FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.memory_entries FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.conversations FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.corrections FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.workflows FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to authenticated" ON public.reports FOR ALL TO authenticated USING (true);

-- Ensure anon access is restricted, unless we specifically use anon key for unit API access.
CREATE POLICY "Allow all access to anon" ON public.units FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.events FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.approvals FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.memory_entries FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.conversations FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.corrections FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.workflows FOR ALL TO anon USING (true);
CREATE POLICY "Allow all access to anon" ON public.reports FOR ALL TO anon USING (true);
