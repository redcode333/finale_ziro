// Shared shapes from docs/API_CONTRACT.md. Delimited CSV fields become arrays.

export type SourceLabel = 'synthetic' | 'live'
export type Role = 'ADMIN' | 'CONTRIBUTOR'

export type ApprovalStatus =
  | 'pending_review'
  | 'approved_execution_pending'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'expired'
  | 'superseded'

export type EvidenceStatus = 'verified' | 'partially_verified' | 'unverified' | 'insufficient_evidence'
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type RunStage = 'plan' | 'act' | 'observe' | 'replan' | 'approval' | 'execute' | 'report'
export type EventStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
export type EventCategory =
  | 'planning' | 'retrieval' | 'analysis' | 'risk' | 'decision'
  | 'approval' | 'execution' | 'completion' | 'failure'

export interface Membership {
  project_id: string
  team_id: string
  role: Role
  status: 'INVITED' | 'ACTIVE'
}
export interface Me {
  user_id: string
  name: string
  email: string
  member_id: string | null
  memberships: Membership[]
}

export interface Member {
  member_id: string
  team_id: string
  name: string
  email: string
  github_username: string
  role: string
  skills: string[]
  weekly_capacity_hours: number
  availability_status: string
}
export interface Sprint {
  sprint_id: string
  team_id: string
  project_id: string
  name: string
  goal: string
  start_date: string
  end_date: string
  status: string
  capacity_hours: number
}
export interface Task {
  task_id: string
  team_id: string
  project_id: string
  sprint_id: string
  title: string
  assignee_id: string
  status: string
  priority: string
  estimate_hours: number
  due_date: string
  dependency_task_ids: string[]
  workstream: string
  version: number
}

export interface EvidenceRecord {
  id: string
  source_type: 'commit' | 'pull_request' | 'review' | 'issue' | 'worklog' | 'standup' | 'task'
  task_id: string | null
  member_id: string | null
  title: string
  source_url: string | null
  observed_at: string
  source_label: SourceLabel
}

export interface RiskAssessment {
  assessment_id: string
  member_id: string
  run_id: string
  status: string
  risk_level: string
  summary: string
  evidence_ids: string[]
  missing_context: string
  recommended_action: string
}

export interface Recommendation {
  recommendation_id: string // shares ID with its approval
  approval_id: string
  run_id: string
  task_id: string
  type: 'task_reassignment'
  trigger_reason: string
  rationale: string
  current_assignee_id: string
  proposed_assignee_id: string
  capacity_check: string
  dependency_check: string
  status: ApprovalStatus
  version: number
  created_at: string
  decided_at: string | null
  reviewer_id: string | null
  decision_reason: string | null
  manager_note: string | null
  execution_status: 'pending' | 'executing' | 'completed' | 'failed' | null
  expected_impact: string
  potential_downside: string
  evidence_ids: string[]
  superseded_by: string | null
  source_label: SourceLabel
}

export interface AgentRun {
  run_id: string
  team_id: string
  sprint_id: string
  status: RunStatus
  stage: RunStage
  started_at: string
  completed_at: string | null
  initiated_by: string
  tasks_analyzed: number
  evidence_collected: number
}
export interface AgentEvent {
  id: string
  run_id: string
  parent_event_id: string | null
  cursor: string
  category: EventCategory
  title: string
  status: EventStatus
  timestamp: string
  duration_ms: number | null
  retries: number
  tool: string | null
  input_summary: string | null
  output_summary: string | null
  evidence_ids: string[]
  error: string | null
  source_label: SourceLabel
}

export interface AuditEvent {
  audit_event_id: string
  run_id: string
  actor_id: string
  action: string
  target_id: string
  before_json: Record<string, unknown>
  after_json: Record<string, unknown>
  reason: string
  created_at: string
  request_id: string | null
}
export interface AppNotification {
  notification_id: string
  member_id: string
  type: string
  status: string
  message: string
  created_at: string
}

export interface Dashboard {
  team_id: string
  sprint: Sprint
  kpis: {
    tasks_analyzed: number
    evidence_collected: number
    risks_detected: number
    actions_pending: number
    evidence_coverage: number
  }
  agent_status: { state: 'idle' | RunStatus; last_heartbeat: string | null; run_id: string | null }
  risks: RiskAssessment[]
  pending_approvals: number
}

export interface DecisionRequest {
  decision: 'approve' | 'reject' | 'modify'
  reason?: string
  manager_note?: string
  modified_assignee_id?: string
  expected_version: number
}

export interface ApiErrorBody {
  error: { code: string; message: string; request_id: string; retryable: boolean }
}
export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

export interface ReportSummary {
  // Each statement cites the stored records (tasks, evidence, assessments, approvals) it is based on.
  statements: { text: string; refs: string[] }[]
  generated_at: string
  provider: string
  model: string
  // True when produced by the mock backend, not a language model.
  sample: boolean
}

export interface WeeklyReport {
  summary: ReportSummary | null
  team_id: string
  sprint: Sprint
  generated_at: string
  basis: 'persisted_records'
  progress: { total: number; done: number; in_progress: number; blocked: number; todo: number }
  blockers: { task_id: string; title: string; assignee_id: string; dependency_task_ids: string[] }[]
  discrepancies: RiskAssessment[]
  contributions: {
    member_id: string
    name: string
    evidence_by_type: Record<string, number>
    hours_logged: number
    tasks_done: number
    note: string
  }[]
  recommendations: { recommendation_id: string; task_id: string; status: ApprovalStatus; summary: string }[]
}

export interface EvaluationCase {
  case_id: string
  scenario: string
  expected_outcome: string
  assertion: string
  result: 'passed' | 'failed' | 'not_run'
}
export interface EvaluationResults {
  mode: 'mock' | 'live'
  ran_at: string | null
  cases: EvaluationCase[]
  // Null until a real run computes them. Never invented.
  metrics: Record<string, number | null>
}

export interface SimulationResult {
  scenario: string
  simulated: true
  title: string
  steps: { label: string; status: 'ok' | 'warn' | 'blocked' | 'failed'; detail: string }[]
  outcome: string
  assertions: { text: string; passed: boolean }[]
}

export interface Standup {
  standup_id: string
  team_id: string
  member_id: string
  date: string
  yesterday: string
  today: string
  blockers: string
  claimed_task_ids: string[]
  submitted_at: string
  source_label: SourceLabel
}
export interface StandupInput {
  yesterday: string
  today: string
  blockers: string
  claimed_task_ids: string[]
}
export interface Blocker {
  blocker_id: string
  team_id: string
  member_id: string
  task_id: string | null
  description: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at: string | null
}
export interface BlockerInput {
  task_id: string | null
  description: string
}

export interface Invitation {
  invitation_id: string
  project_id: string
  email: string
  role: 'CONTRIBUTOR'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string
  created_at: string
  expires_at: string
}

export type GithubScope = 'project' | 'me'
export interface GithubConnection {
  scope: GithubScope
  status: 'connected' | 'disconnected' | 'error'
  account_login: string | null
  repository_url: string | null
  connected_at: string | null
  last_synced_at: string | null
  error: string | null
}
