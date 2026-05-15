CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    description text NOT NULL,
    original_time timestamp with time zone NOT NULL,
    trigger_time timestamp with time zone NOT NULL,
    is_completed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS and add policy for service_role and anon
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon access to tasks" 
ON public.tasks 
FOR ALL 
TO anon
USING (true)
WITH CHECK (true);
