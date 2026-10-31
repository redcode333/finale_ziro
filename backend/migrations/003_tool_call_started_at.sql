-- FairSprint AI: record when each tool call started so the run trace can show real times. Run after 002. Idempotent.
-- Older rows keep NULL; the API then falls back to created_at.
alter table tool_call_logs add column if not exists started_at timestamptz;
