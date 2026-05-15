-- Add end_time and debrief_sent to tasks table
ALTER TABLE public.tasks 
ADD COLUMN end_time timestamp with time zone,
ADD COLUMN debrief_sent boolean DEFAULT false;

-- For existing tasks, just set end_time to original_time + 1 hour
UPDATE public.tasks SET end_time = original_time + interval '1 hour' WHERE end_time IS NULL;
ALTER TABLE public.tasks ALTER COLUMN end_time SET NOT NULL;

-- Add last_briefing_date to admin_session table
ALTER TABLE public.admin_session 
ADD COLUMN last_briefing_date date;
