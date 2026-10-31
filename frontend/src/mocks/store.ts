// In-memory mock backend state, built from data/synthetic_dataset/dataset.json.
// Behaviour is time-driven and lazy: runs reveal events and approvals advance
// through executing -> completed/failed when they are read, like a real backend would.
import dataset from '../../../data/synthetic_dataset/dataset.json'
import type {
  AgentEvent, AgentRun, AppNotification, ApprovalStatus, AuditEvent, EvidenceRecord, Me, Member,
  Recommendation, RiskAssessment, Sprint, Task,
} from '@/types'

const T = dataset.tables as Record<string, Record<string, unknown>[]>
const list = (v: unknown) => (v ? String(v).split(';').filter(Boolean) : [])
const parseJson = (v: unknown) => {
  try { return JSON.parse(String(v || '{}')) } catch { return {} }
}

export const TEAM_ID = dataset.project.team_id
export const PROJECT_ID = dataset.project.project_id
export const ADMIN_ID = 'MENTOR001'

export const members: Member[] = T.team_members.map((m) => ({
  ...(m as unknown as Member),
  skills: list(m.skills),
}))
export const sprints = T.sprints as unknown as Sprint[]
export const tasks: Task[] = T.tasks.map((t) => ({
  ...(t as unknown as Task),
  dependency_task_ids: list(t.dependency_task_ids),
  version: 1,
}))
export const risks = T.risk_assessments.map((r) => ({
  ...(r as unknown as RiskAssessment),
  evidence_ids: list(r.evidence_ids),
}))
export const notifications = T.notifications as unknown as AppNotification[]

export const evidence: EvidenceRecord[] = [
  ...T.github_events.map((g) => ({
    id: String(g.event_id),
    source_type: (g.event_type === 'review' ? 'review' : g.event_type === 'issue' ? 'issue'
      : g.event_type === 'pull_request' ? 'pull_request' : 'commit') as EvidenceRecord['source_type'],
    task_id: (g.task_id as string) || null,
    member_id: g.member_id as string,
    title: (g.title_or_message as string) || '(empty message)',
    source_url: g.source_url as string,
    observed_at: g.occurred_at as string,
    source_label: 'synthetic' as const,
  })),
  ...T.worklogs.map((w) => ({
    id: String(w.worklog_id),
    source_type: 'worklog' as const,
    task_id: (w.task_id as string) || null,
    member_id: w.member_id as string,
    title: `${w.hours}h — ${w.description}`,
    source_url: (w.evidence_url as string) || null,
    observed_at: `${w.work_date}T00:00:00Z`,
    source_label: 'synthetic' as const,
  })),
]

export const mockUsers: (Me & { label: string })[] = [
  {
    user_id: ADMIN_ID, label: 'Mentor (Admin)', name: 'Mentor One', email: 'mentor@example.test',
    member_id: null, memberships: [{ project_id: PROJECT_ID, team_id: TEAM_ID, role: 'ADMIN', status: 'ACTIVE' }],
  },
  ...members.map((m) => ({
    user_id: m.member_id, label: `${m.name} (Contributor)`, name: m.name, email: m.email, member_id: m.member_id,
    memberships: [{ project_id: PROJECT_ID, team_id: TEAM_ID, role: 'CONTRIBUTOR' as const, status: 'ACTIVE' as const }],
  })),
]

// ---- approvals / recommendations ------------------------------------------------------------
export const auditEvents: AuditEvent[] = T.audit_events.map((a) => ({
  audit_event_id: String(a.audit_event_id),
  run_id: String(a.run_id),
  actor_id: String(a.actor_id),
  action: String(a.action),
  target_id: String(a.target_id),
  before_json: parseJson(a.before_json),
  after_json: parseJson(a.after_json),
  reason: String(a.reason ?? ''),
  created_at: String(a.created_at),
  request_id: null,
}))

interface Internal extends Recommendation { stateSince: number }
const replans = new Map(T.sprint_replans.map((r) => [String(r.replan_id), r]))

export const approvals: Internal[] = T.approval_queue.map((a) => {
  const rp = replans.get(String(a.replan_id)) as Record<string, string>
  const risk = risks.find((r) => r.run_id === a.run_id && r.member_id === rp.trigger_member_id)
  return {
    recommendation_id: String(a.approval_id),
    approval_id: String(a.approval_id),
    run_id: String(a.run_id),
    task_id: rp.task_id,
    type: 'task_reassignment' as const,
    trigger_reason: rp.trigger_reason,
    rationale: rp.rationale,
    current_assignee_id: rp.current_assignee_id,
    proposed_assignee_id: rp.proposed_assignee_id,
    capacity_check: rp.capacity_check,
    dependency_check: rp.dependency_check,
    status: 'pending_review' as ApprovalStatus,
    version: 1,
    created_at: String(a.created_at),
    decided_at: null,
    reviewer_id: (a.reviewer_id as string) || null,
    decision_reason: null,
    manager_note: null,
    execution_status: null,
    expected_impact: 'Keeps the sprint on schedule by moving the task to a teammate with remaining capacity.',
    potential_downside: 'Context switch for the new owner; the original owner must hand off notes.',
    evidence_ids: risk?.evidence_ids ?? evidence.filter((e) => e.task_id === rp.task_id).map((e) => e.id),
    superseded_by: null,
    source_label: 'synthetic' as const,
    stateSince: Date.now(),
  }
})

// Dev toggle: localStorage.setItem('mock.failExecution', '1') makes the next execution fail.
const shouldFail = () => {
  try { return localStorage.getItem('mock.failExecution') === '1' } catch { return false }
}
const EXECUTING_AFTER_MS = 1500
const SETTLED_AFTER_MS = 3500

function audit(actor: string, action: string, target: string, before: object, after: object, reason: string, run: string) {
  auditEvents.push({
    audit_event_id: `AU${String(auditEvents.length + 1).padStart(3, '0')}`,
    run_id: run, actor_id: actor, action, target_id: target,
    before_json: before as Record<string, unknown>, after_json: after as Record<string, unknown>,
    reason, created_at: new Date().toISOString(), request_id: crypto.randomUUID(),
  })
}

/** Advance the execution state machine lazily. The task is only mutated on success. */
export function settle(a: Internal) {
  const age = Date.now() - a.stateSince
  if (a.status === 'approved_execution_pending' && age > EXECUTING_AFTER_MS) {
    a.status = 'executing'; a.execution_status = 'executing'
  }
  if (a.status === 'executing' && age > SETTLED_AFTER_MS) {
    if (shouldFail()) {
      a.status = 'failed'; a.execution_status = 'failed'
      audit(a.reviewer_id ?? ADMIN_ID, 'execution_failed', a.approval_id, {}, { error: 'task_update_failed' }, 'Simulated failure', a.run_id)
    } else {
      const task = tasks.find((t) => t.task_id === a.task_id)!
      const before = { assignee_id: task.assignee_id }
      task.assignee_id = a.proposed_assignee_id
      task.version += 1
      a.status = 'completed'; a.execution_status = 'completed'
      audit(a.reviewer_id ?? ADMIN_ID, 'task_reassigned', a.task_id, before, { assignee_id: task.assignee_id }, a.manager_note ?? 'Approved', a.run_id)
    }
  }
  return a
}

export function decide(
  id: string,
  d: { decision: 'approve' | 'reject' | 'modify'; reason?: string; manager_note?: string; modified_assignee_id?: string; expected_version: number },
  actor: string,
): { ok: true; rec: Internal } | { ok: false; status: number; code: string; message: string } {
  const a = approvals.find((x) => x.approval_id === id)
  if (!a) return { ok: false, status: 404, code: 'not_found', message: 'Approval not found' }
  settle(a)
  if (a.status !== 'pending_review' || a.version !== d.expected_version) {
    return { ok: false, status: 409, code: 'stale_proposal', message: 'This proposal changed or was already decided. Refresh and review again.' }
  }
  const assignee = members.find((m) => m.member_id === a.proposed_assignee_id)
  if (d.decision === 'approve' && assignee?.availability_status !== 'available') {
    a.status = 'superseded'; a.version += 1
    return { ok: false, status: 409, code: 'assignee_unavailable', message: 'Proposed assignee is no longer available.' }
  }
  a.reviewer_id = actor
  a.decided_at = new Date().toISOString()
  a.manager_note = d.manager_note ?? null
  a.stateSince = Date.now()
  a.version += 1
  if (d.decision === 'reject') {
    a.status = 'rejected'; a.decision_reason = d.reason ?? null; a.execution_status = null
    audit(actor, 'proposal_rejected', a.approval_id, { assignee_id: a.current_assignee_id }, { assignee_id: a.current_assignee_id }, d.reason ?? '', a.run_id)
  } else if (d.decision === 'approve') {
    a.status = 'approved_execution_pending'; a.execution_status = 'pending'
    audit(actor, 'proposal_approved', a.approval_id, { assignee_id: a.current_assignee_id }, { proposed_assignee_id: a.proposed_assignee_id }, d.manager_note ?? '', a.run_id)
  } else {
    // Modify: the old proposal is superseded; a new one returns to pending review.
    const newId = `${a.approval_id.split('-r')[0]}-r${approvals.filter((x) => x.approval_id.startsWith(a.approval_id.split('-r')[0])).length}`
    const fresh: Internal = {
      ...a, approval_id: newId, recommendation_id: newId, status: 'pending_review', version: 1,
      proposed_assignee_id: d.modified_assignee_id ?? a.proposed_assignee_id,
      decided_at: null, reviewer_id: null, manager_note: d.manager_note ?? null, decision_reason: null,
      execution_status: null, superseded_by: null, created_at: new Date().toISOString(), stateSince: Date.now(),
    }
    a.status = 'superseded'; a.superseded_by = newId; a.execution_status = null
    approvals.push(fresh)
    audit(actor, 'proposal_modified', a.approval_id, { proposed_assignee_id: a.proposed_assignee_id }, { proposed_assignee_id: fresh.proposed_assignee_id, new_proposal: newId }, d.manager_note ?? '', a.run_id)
    return { ok: true, rec: fresh }
  }
  return { ok: true, rec: a }
}

export function retryExecution(id: string) {
  const a = approvals.find((x) => x.approval_id === id)
  if (!a || a.status !== 'failed') return undefined
  a.status = 'executing'; a.execution_status = 'executing'; a.stateSince = Date.now() - EXECUTING_AFTER_MS
  try { localStorage.removeItem('mock.failExecution') } catch { /* ignore */ }
  return a
}

export const publicRec = ({ stateSince: _s, ...rest }: Internal): Recommendation => rest

// ---- runs and events --------------------------------------------------------------------------
interface Step { at: number; ms: number; category: AgentEvent['category']; title: string; tool: string | null; input: string; output: string; stage: AgentRun['stage']; ev?: string[] }

const NEW_RUN_SCRIPT: Step[] = [
  { at: 0.5, ms: 380, category: 'planning', title: 'Created sprint analysis plan', tool: null, input: 'Sprint SP001, 20 tasks, 8 members', output: 'Plan: tasks, worklogs, GitHub activity, standups', stage: 'plan' },
  { at: 2, ms: 412, category: 'retrieval', title: 'Retrieved commits and pull requests', tool: 'github_adapter', input: 'GET /repos/fairsprint-demo/campus-connect (synthetic fixture)', output: `${T.github_events.length} events, HTTP 200`, stage: 'act' },
  { at: 3, ms: 42, category: 'retrieval', title: 'Queried sprint tasks', tool: 'supabase_task_tool', input: `team_id=${TEAM_ID}`, output: `${tasks.length} rows`, stage: 'act' },
  { at: 4, ms: 31, category: 'retrieval', title: 'Queried worklogs', tool: 'supabase_worklog_tool', input: `team_id=${TEAM_ID}`, output: `${T.worklogs.length} rows`, stage: 'act' },
  { at: 6, ms: 1210, category: 'analysis', title: 'Compared standup claims with task activity', tool: null, input: '12 standups, 20 tasks', output: 'Verification states assigned; gaps listed', stage: 'observe', ev: ['GH008', 'GH009', 'W007'] },
  { at: 8, ms: 85, category: 'risk', title: 'Flagged a workload risk: M007 temporarily unavailable', tool: null, input: 'Capacity and availability rules', output: '1 task at risk (T008)', stage: 'replan' },
  { at: 10, ms: 640, category: 'decision', title: 'Generated reassignment proposal AP001', tool: null, input: 'Capacity + dependency checks', output: 'Proposal ready for review', stage: 'replan' },
  { at: 11, ms: 0, category: 'approval', title: 'Waiting for manager approval', tool: null, input: '', output: 'No change is made before approval', stage: 'approval' },
]

const stepEvents = (run: AgentRun, steps: Step[], startMs: number, now: number): AgentEvent[] =>
  steps
    .filter((s) => now - startMs >= s.at * 1000)
    .map((s, i) => {
      const last = i === steps.length - 1
      const done = last && s.category === 'approval' ? false : true
      return {
        id: `${run.run_id}-EV${String(i + 1).padStart(2, '0')}`, run_id: run.run_id, parent_event_id: null,
        cursor: String(i + 1).padStart(4, '0'), category: s.category, title: s.title,
        status: done ? 'completed' : 'running', timestamp: new Date(startMs + s.at * 1000).toISOString(),
        duration_ms: s.ms || null, retries: 0, tool: s.tool, input_summary: s.input || null, output_summary: s.output || null,
        evidence_ids: s.ev ?? [], error: null, source_label: 'synthetic',
      } satisfies AgentEvent
    })

interface RunRec { run: AgentRun; startMs: number; script: Step[]; frozenAt?: number }
const clock = (r: RunRec) => r.frozenAt ?? Date.now()
const runs: RunRec[] = ['RUN001', 'RUN002'].map((id) => {
  const created = String(T.audit_events.find((a) => a.run_id === id)?.created_at ?? '2026-10-27T18:00:00Z')
  return {
    startMs: new Date(created).getTime() - 12_000,
    script: NEW_RUN_SCRIPT,
    run: {
      run_id: id, team_id: TEAM_ID, sprint_id: 'SP001', status: 'awaiting_approval' as const, stage: 'approval' as const,
      started_at: created, completed_at: null, initiated_by: ADMIN_ID,
      tasks_analyzed: tasks.length, evidence_collected: evidence.length,
    },
  }
})

export function startRun(sprintId: string, actor: string): AgentRun {
  const run_id = `RUN${String(runs.length + 1).padStart(3, '0')}`
  const startMs = Date.now()
  const rec: RunRec = {
    startMs, script: NEW_RUN_SCRIPT,
    run: {
      run_id, team_id: TEAM_ID, sprint_id: sprintId, status: 'queued', stage: 'plan',
      started_at: new Date(startMs).toISOString(), completed_at: null, initiated_by: actor, tasks_analyzed: 0, evidence_collected: 0,
    },
  }
  runs.push(rec)
  return refreshRun(rec)
}

function refreshRun(r: RunRec): AgentRun {
  if (r.run.status === 'cancelled' || r.run.status === 'paused') return r.run
  const now = clock(r)
  const events = stepEvents(r.run, r.script, r.startMs, now)
  const last = r.script.filter((s) => now - r.startMs >= s.at * 1000).at(-1)
  if (!last) { r.run.status = 'queued'; return r.run }
  const finished = events.length === r.script.length
  r.run.status = finished ? 'awaiting_approval' : 'running'
  r.run.stage = last.stage
  r.run.tasks_analyzed = events.length >= 3 ? tasks.length : 0
  r.run.evidence_collected = events.length >= 4 ? evidence.length : events.length >= 2 ? T.github_events.length : 0
  return r.run
}

export const getRuns = () => runs.map((r) => refreshRun(r))
export const getRun = (id: string) => {
  const r = runs.find((x) => x.run.run_id === id)
  return r ? refreshRun(r) : undefined
}
export function getEvents(id: string, after?: string) {
  const r = runs.find((x) => x.run.run_id === id)
  if (!r) return undefined
  refreshRun(r)
  const all = stepEvents(r.run, r.script, r.startMs, clock(r))
  return all.filter((e) => !after || e.cursor > after)
}
export function controlRun(id: string, action: 'pause' | 'resume' | 'stop' | 'retry') {
  const r = runs.find((x) => x.run.run_id === id)
  if (!r) return undefined
  if (action === 'pause' && !r.frozenAt) { r.frozenAt = Date.now(); r.run.status = 'paused' }
  if (action === 'resume' && r.frozenAt) { r.startMs += Date.now() - r.frozenAt; r.frozenAt = undefined; r.run.status = 'running' }
  if (action === 'stop') { r.frozenAt = Date.now(); r.run.status = 'cancelled'; r.run.completed_at = new Date().toISOString() }
  return refreshRun(r)
}

export function dashboardFor() {
  const pending = approvals.filter((a) => a.status === 'pending_review').length
  const covered = tasks.filter((t) => evidence.some((e) => e.task_id === t.task_id)).length
  const latest = getRuns().at(-1)
  return {
    kpis: {
      tasks_analyzed: latest?.tasks_analyzed ?? 0,
      evidence_collected: new Set(evidence.map((e) => e.id)).size,
      risks_detected: risks.filter((r) => r.risk_level !== 'none').length,
      actions_pending: pending,
      evidence_coverage: Math.round((covered / tasks.length) * 100) / 100,
    },
    agent_status: { state: latest?.status ?? 'idle', last_heartbeat: new Date().toISOString(), run_id: latest?.run_id ?? null },
    pending_approvals: pending,
  }
}
