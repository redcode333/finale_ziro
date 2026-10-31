-- FairSprint AI: record when each tool call started so the run trace can show real times. Run after 002. Idempotent.
-- Older rows keep NULL; the API then falls back to created_at.
ALTER TABLE public.tool_call_logs
ADD COLUMN IF NOT EXISTS started_at timestamptz;
