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

export interface ReplanCheck {
  key: 'capacity' | 'dependencies' | 'evidence'
  status: 'pass' | 'fail' | 'conditional'
  detail: string
}
export interface OwnerImpact {
  member_id: string
  open_hours_before: number
  open_hours_after: number
  capacity_hours: number
}
// What the proposal does to workload, validated by code (not by the model) before it is shown.
export interface ReplanImpact {
  task_estimate_hours: number
  from: OwnerImpact
  to: OwnerImpact
  checks: ReplanCheck[]
}

export interface Recommendation {
  impact: ReplanImpact
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

// One standup claim about one task, checked against stored evidence by deterministic rules.
export interface Claim {
  claim_id: string
  standup_id: string
  member_id: string
  task_id: string
  task_title: string
  task_owner_id: string
  task_status: string
  kind: 'completed' | 'worked_on'
  claim_text: string
  claimed_at: string
  verification: EvidenceStatus
  explanation: string
  gaps: string[]
  matched_evidence: EvidenceRecord[]
  source_label: SourceLabel
}

export type ParticipationState = 'submitted' | 'missing' | 'silent' | 'unavailable'
export interface ParticipationMember {
  member_id: string
  state: ParticipationState
  submitted_at: string | null
  // Consecutive days (ending on `date`) without a standup. 0 when submitted.
  missed_days: number
  // Other recorded signals on `date` (commits, reviews, worklogs...). Missing a standup is not inactivity.
  other_activity: { id: string; source_type: EvidenceRecord['source_type']; title: string }[]
  last_activity_at: string | null
  reminder_sent: boolean
}
export interface StandupStatus {
  date: string
  min_date: string
  max_date: string
  expected: number
  submitted: number
  members: ParticipationMember[]
}

export interface ReplanRequest {
  member_id: string
  reason?: string
}
export interface ReplanResult {
  proposals: Recommendation[]
  // Open tasks with no eligible teammate under the capacity rules. They are listed, never silently dropped.
  unassigned_task_ids: string[]
}

// One real operation by an allowlisted tool adapter. A model call is not a tool call.
export interface ToolCall {
  tool_call_id: string
  run_id: string
  tool_name: string
  operation: string
  status: 'success' | 'failed'
  http_status: number | null
  latency_ms: number
  retries: number
  // Rows or events returned. Null when the call failed (unknown, never zero).
  result_count: number | null
  scope: string
  started_at: string
  error: string | null
  source_label: SourceLabel
}

export interface LlmAttempt {
  provider: string
  model: string
  outcome: 'success' | 'timeout' | 'rate_limited' | 'server_error' | 'invalid_schema' | 'auth_error'
  latency_ms: number
}
export interface LlmCall {
  llm_call_id: string
  run_id: string
  purpose: 'planner' | 'assessor' | 'report_writer'
  started_at: string
  final_provider: string | null
  final_model: string | null
  status: 'success' | 'failed'
  latency_ms: number
  attempts: LlmAttempt[]
  fallback_reason: string | null
  schema_valid: boolean
  // Null when the provider did not report usage. Never invented.
  tokens_in: number | null
  tokens_out: number | null
  source_label: SourceLabel
}
