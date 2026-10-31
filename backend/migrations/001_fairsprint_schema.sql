-- FairSprint AI M2 schema. Run in the Supabase SQL Editor. Idempotent (IF NOT EXISTS).
-- IDs are text so dataset IDs (team_fs_001, M001, T001, GH001...) are preserved; new rows default to UUID strings.
-- source_label separates 'synthetic' fixtures from 'live' data everywhere.

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create table if not exists teams (
  team_id text primary key,
  name text not null,
  description text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  project_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  name text not null,
  description text,
  repository_url text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_members (
  member_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  name text not null,
  email text,
  github_username text,
  role text,
  skills text[] not null default '{}',
  weekly_capacity_hours numeric not null default 0 check (weekly_capacity_hours >= 0),
  availability_status text not null default 'available'
    check (availability_status in ('available','temporarily_unavailable','unavailable')),
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sprints (
  sprint_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  project_id text not null references projects(project_id) on delete cascade,
  name text not null,
  goal text,
  start_date date,
  end_date date,
  status text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  capacity_hours numeric check (capacity_hours >= 0),
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  task_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  project_id text not null references projects(project_id) on delete cascade,
  sprint_id text references sprints(sprint_id) on delete set null,
  title text not null,
  assignee_id text references team_members(member_id) on delete set null,
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  estimate_hours numeric check (estimate_hours >= 0),
  due_date date,
  dependency_task_ids text[] not null default '{}',
  workstream text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists standups (
  standup_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  member_id text not null references team_members(member_id) on delete cascade,
  date date not null,
  yesterday text,
  today text,
  blockers text,
  claimed_task_ids text[] not null default '{}',
  submitted_at timestamptz,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists worklogs (
  worklog_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  member_id text not null references team_members(member_id) on delete cascade,
  task_id text references tasks(task_id) on delete set null,
  hours numeric not null check (hours >= 0),
  description text,
  work_date date not null,
  evidence_url text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Raw GitHub-style events. source_label='synthetic' rows are fixtures, NOT GitHub API results.
create table if not exists github_events (
  event_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  member_id text references team_members(member_id) on delete set null,
  github_username text,
  event_type text not null
    check (event_type in ('commit','pull_request','pull_request_review','issue','issue_comment')),
  task_id text references tasks(task_id) on delete set null,
  title_or_message text,
  occurred_at timestamptz,
  repository_url text,
  source_url text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now()
);

-- Normalized evidence from any source (github fixtures, worklogs, live GitHub API).
create table if not exists evidence (
  evidence_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  project_id text references projects(project_id) on delete set null,
  member_id text references team_members(member_id) on delete set null,
  task_id text references tasks(task_id) on delete set null,
  source text not null check (source in ('github_synthetic','github_api','worklog','standup')),
  evidence_type text not null,
  github_username text,
  title text,
  url text,
  hours numeric,
  occurred_at timestamptz,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists agent_runs (
  run_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  workflow text not null default 'evidence_assessment',
  status text not null default 'pending' check (status in ('pending','running','awaiting_approval','completed','failed')),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists risk_assessments (
  assessment_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  member_id text references team_members(member_id) on delete set null,
  run_id text references agent_runs(run_id) on delete set null,
  status text not null
    check (status in ('verified','verified_contribution','partially_verified','unverified','insufficient_evidence','availability_change')),
  risk_level text not null default 'none' check (risk_level in ('none','low','planning_attention','review_required','high')),
  summary text,
  evidence_ids text[] not null default '{}',
  missing_context text,
  recommended_action text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sprint_replans (
  replan_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  sprint_id text references sprints(sprint_id) on delete set null,
  run_id text references agent_runs(run_id) on delete set null,
  trigger_member_id text references team_members(member_id) on delete set null,
  trigger_reason text,
  task_id text references tasks(task_id) on delete set null,
  current_assignee_id text references team_members(member_id) on delete set null,
  proposed_assignee_id text references team_members(member_id) on delete set null,
  proposal_status text not null default 'draft'
    check (proposal_status in ('draft','pending_approval','approved','rejected','applied')),
  capacity_check text,
  dependency_check text,
  rationale text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approval_queue (
  approval_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  run_id text references agent_runs(run_id) on delete set null,
  replan_id text references sprint_replans(replan_id) on delete cascade,
  requested_by text,
  reviewer_id text,  -- mentors are not team members; no FK
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  decision_reason text,
  decided_at timestamptz,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tool_call_logs (
  tool_call_id text primary key,
  run_id text references agent_runs(run_id) on delete cascade,
  team_id text references teams(team_id) on delete cascade,
  tool_name text not null,
  status text not null check (status in ('success','error','timeout','unavailable')),
  latency_ms integer check (latency_ms >= 0),
  result_count integer,
  error text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  audit_event_id text primary key,
  team_id text not null references teams(team_id) on delete cascade,
  run_id text references agent_runs(run_id) on delete set null,
  actor_id text,
  action text not null,
  target_id text,
  before_json jsonb not null default '{}',
  after_json jsonb not null default '{}',
  reason text,
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now()
);

create table if not exists mentor_reports (
  report_id text primary key default gen_random_uuid()::text,
  team_id text not null references teams(team_id) on delete cascade,
  sprint_id text references sprints(sprint_id) on delete set null,
  run_id text references agent_runs(run_id) on delete set null,
  period_start date,
  period_end date,
  summary text,
  body jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','published')),
  source_label text not null default 'live' check (source_label in ('synthetic','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes (team_id scoping + common lookups)
create index if not exists idx_projects_team on projects(team_id);
create index if not exists idx_members_team on team_members(team_id);
create index if not exists idx_members_github on team_members(github_username);
create index if not exists idx_sprints_team on sprints(team_id, status);
create index if not exists idx_tasks_team on tasks(team_id, status);
create index if not exists idx_tasks_assignee on tasks(assignee_id);
create index if not exists idx_tasks_sprint on tasks(sprint_id);
create index if not exists idx_standups_team_date on standups(team_id, date desc);
create index if not exists idx_standups_member on standups(member_id);
create index if not exists idx_worklogs_team on worklogs(team_id, work_date desc);
create index if not exists idx_worklogs_member on worklogs(member_id);
create index if not exists idx_ghevents_team on github_events(team_id, occurred_at desc);
create index if not exists idx_ghevents_member on github_events(member_id);
create index if not exists idx_evidence_team on evidence(team_id, occurred_at desc);
create index if not exists idx_evidence_member on evidence(member_id);
create index if not exists idx_evidence_task on evidence(task_id);
create index if not exists idx_runs_team on agent_runs(team_id);
create index if not exists idx_risk_team on risk_assessments(team_id);
create index if not exists idx_risk_member on risk_assessments(member_id);
create index if not exists idx_replans_team on sprint_replans(team_id, proposal_status);
create index if not exists idx_approvals_team on approval_queue(team_id, status);
create index if not exists idx_toolcalls_run on tool_call_logs(run_id);
create index if not exists idx_audit_team on audit_events(team_id, created_at desc);
create index if not exists idx_reports_team on mentor_reports(team_id);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['teams','projects','team_members','sprints','tasks','standups','worklogs',
    'agent_runs','risk_assessments','sprint_replans','approval_queue','mentor_reports']
  loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s', t);
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Lock tables from the public anon/authenticated API; only the backend service-role key can access them.
do $$
declare t text;
begin
  foreach t in array array['teams','projects','team_members','sprints','tasks','standups','worklogs',
    'github_events','evidence','agent_runs','risk_assessments','sprint_replans','approval_queue',
    'tool_call_logs','audit_events','mentor_reports']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
