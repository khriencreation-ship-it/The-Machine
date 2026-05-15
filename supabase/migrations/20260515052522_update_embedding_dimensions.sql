-- Update the column to 3072 dimensions
ALTER TABLE public.memory_entries 
ALTER COLUMN embedding TYPE vector(3072);

-- Update the search function to match 3072 dimensions
CREATE OR REPLACE FUNCTION match_memory_entries (
  query_embedding vector(3072),
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
