-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Update memory_entries
ALTER TABLE public.memory_entries 
ADD COLUMN title TEXT,
ADD COLUMN summary TEXT,
ADD COLUMN tags JSONB DEFAULT '[]'::JSONB,
ADD COLUMN source_type TEXT,
ADD COLUMN source_reference TEXT,
ADD COLUMN related_unit UUID REFERENCES public.units(id) ON DELETE SET NULL,
ADD COLUMN importance_level INTEGER DEFAULT 1,
ADD COLUMN created_by UUID,
ADD COLUMN embedding vector(768);

-- Create knowledge_sources
CREATE TABLE public.knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'PENDING',
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update corrections table to match new schema
DROP TABLE IF EXISTS public.corrections;
CREATE TABLE public.corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_unit UUID REFERENCES public.units(id) ON DELETE CASCADE,
    correction_type TEXT NOT NULL,
    original_content TEXT,
    corrected_content TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS logic
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to authenticated" ON public.knowledge_sources FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all access to anon" ON public.knowledge_sources FOR ALL TO anon USING (true);

-- Create a function to search memory
CREATE OR REPLACE FUNCTION match_memory_entries (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  title text,
  content jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    memory_entries.id,
    memory_entries.title,
    memory_entries.content,
    1 - (memory_entries.embedding <=> query_embedding) AS similarity
  FROM memory_entries
  WHERE 1 - (memory_entries.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
