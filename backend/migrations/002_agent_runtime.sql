-- FairSprint AI M3: agent runtime additions. Run in the Supabase SQL Editor after 001. Idempotent.

-- Durable run state so a paused (awaiting approval) or failed run can be resumed without relying on process memory.
alter table agent_runs add column if not exists sprint_id text references sprints(sprint_id) on delete set null;
alter table agent_runs add column if not exists phase text;
alter table agent_runs add column if not exists plan jsonb not null default '{}';
alter table agent_runs add column if not exists state jsonb not null default '{}';
alter table agent_runs add column if not exists llm_calls jsonb not null default '[]';
alter table agent_runs add column if not exists requested_by text;

-- Mentors authenticate with an opaque bearer token; only its SHA-256 hash is stored.
create table if not exists mentors (
  mentor_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_mentors_team on mentors(team_id);
alter table mentors enable row level security;

create index if not exists idx_runs_sprint on agent_runs(sprint_id);
