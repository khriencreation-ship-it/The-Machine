CREATE TABLE public.admin_session (
    id integer PRIMARY KEY DEFAULT 1,
    last_active_at timestamp with time zone DEFAULT now(),
    is_locked boolean DEFAULT false
);

-- Ensure only one row can ever exist (id = 1)
ALTER TABLE public.admin_session ADD CONSTRAINT admin_session_id_check CHECK (id = 1);

-- Insert the initial unlocked session row
INSERT INTO public.admin_session (id, last_active_at, is_locked) 
VALUES (1, now(), false)
ON CONFLICT (id) DO NOTHING;

-- Grant access to authenticated users (or anon if using service role, but we use anon locally and in API we use service_role)
-- The API uses anon key, but we don't have RLS enabled for this table right now.
-- Let's enable RLS and add a policy to allow anon to read/update it since the server uses the anon key.
ALTER TABLE public.admin_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon access to admin_session" 
ON public.admin_session 
FOR ALL 
TO anon
USING (true)
WITH CHECK (true);
