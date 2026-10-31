// Adapter for the real FastAPI backend (backend/app). It translates the backend's shapes into the contract shapes the UI
// already uses. Active only for a session that signed in with a mentor token; every other session keeps using the mock API.
// Things the backend does not provide yet are NOT faked here: those calls stay on the mock API and the UI says so.
import type {
  AgentEvent, AgentRun, ApprovalStatus, Dashboard, EventCategory, EvidenceRecord, LlmCall, Me, Member, Page,
  Recommendation, ReplanImpact, ReportSummary, RiskAssessment, RunStage, RunStatus, Sprint, Task, ToolCall, WeeklyReport,
  DecisionRequest,
} from '@/types'
import { buildMentorLoginRequest } from '@/lib/turnstile'
import { ApiError } from './errors'

const BASE = ((import.meta.env.VITE_LIVE_API_URL as string | undefined) ?? '').replace(/\/$/, '')
export const liveConfigured = BASE !== ''
const TEAM = (import.meta.env.VITE_LIVE_TEAM_ID as string | undefined) ?? 'team_fs_001'
const PROJECT = (import.meta.env.VITE_LIVE_PROJECT_ID as string | undefined) ?? 'proj_fs_001'

// ---- session -------------------------------------------------------------------------------------
// sessionStorage, not localStorage: the token disappears when the tab closes.
const TOKEN_KEY = 'fairsprint.mentorToken'
export const getMentorToken = (): string | null => {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
}
export const setMentorToken = (t: string | null) => {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ }
  cache.clear()
}
export const isLiveSession = () => liveConfigured && !!getMentorToken()

// ---- transport -----------------------------------------------------------------------------------
async function lreq<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getMentorToken() ?? ''}`,
    },
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => undefined)) as { code?: string; message?: string } | undefined
    throw new ApiError(res.status, { code: b?.code ?? 'http_error', message: b?.message ?? `Request failed (${res.status})`, request_id: '', retryable: res.status >= 500 })
  }
  return (await res.json()) as T
}

// Sign-in gate: the backend checks the Turnstile token (when enabled) before it even looks at the mentor token.
// A rejection is thrown as an ApiError carrying the backend's code and message.
export async function mentorLogin(mentorToken: string, turnstileToken: string | null): Promise<void> {
  const res = await fetch(`${BASE}/auth/mentor-login`, buildMentorLoginRequest(mentorToken, turnstileToken))
  if (!res.ok) {
    const b = (await res.json().catch(() => undefined)) as { code?: string; message?: string } | undefined
    throw new ApiError(res.status, { code: b?.code ?? 'http_error', message: b?.message ?? `Sign-in failed (${res.status})`, request_id: '', retryable: res.status >= 500 })
  }
}

// Several adapters read the same run or the same lists on every 2 s poll; share one request per short window.
const cache = new Map<string, { t: number; p: Promise<unknown> }>()
function memo<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < ttl) return hit.p as Promise<T>
  const p = fn()
  cache.set(key, { t: Date.now(), p })
  p.catch(() => cache.delete(key))
  return p
}
const unsupported = (what: string): never => {
  throw new ApiError(501, { code: 'not_supported', message: `${what} is not available on the live backend yet.`, retryable: false })
}
const page = <T,>(items: T[]): Page<T> => ({ items, next_cursor: null })

// ---- raw backend shapes (only the fields used) ------------------------------------------------------
interface RawEvidence {
  evidence_id: string; member_id: string | null; task_id: string | null; evidence_type: string; title: string | null
  url: string | null; hours: number | null; occurred_at: string | null; source_label: 'synthetic' | 'live'
}
interface RawTask extends Omit<Task, 'version' | 'assignee_id' | 'sprint_id' | 'estimate_hours' | 'due_date'> {
  assignee_id: string | null; sprint_id: string | null; estimate_hours: number | null; due_date: string | null
}
interface RawReplan {
  replan_id: string; task_id: string; trigger_reason: string; current_assignee_id: string; proposed_assignee_id: string
  capacity_check: string; dependency_check: string; rationale: string; run_id: string | null; source_label: 'synthetic' | 'live'
}
interface RawApproval {
  approval_id: string; run_id: string | null; replan_id: string | null; status: string; reviewer_id: string | null
  decision_reason: string | null; created_at: string | null; replan?: RawReplan | null; source_label?: 'synthetic' | 'live'
}
interface RawAssessment {
  assessment_id: string; member_id: string | null; status: string; risk_level: string; summary: string | null
  evidence_ids: string[]; missing_context: string | null; recommended_action: string | null
}
interface RawToolCall {
  tool_call_id: string; tool_name: string; status: string; latency_ms: number | null; result_count: number | null
  error: string | null; created_at?: string; called_at?: string; source_label?: 'synthetic' | 'live'
}
interface RawLlmCall {
  provider: string; model: string; attempt: number; fallback_reason: string | null; schema: string; status: string
  error?: string; latency_ms: number
}
interface RawRun {
  run_id: string; team_id: string; sprint_id: string | null; status: string; phase: string | null; error: string | null
  plan: { claims_to_verify?: { task_ids: string[] }[] }
  evidence_summary: { github?: number; worklogs?: number; standups?: number }
  assessments: RawAssessment[]; replans: RawReplan[]; approvals: RawApproval[]; tool_calls: RawToolCall[]; llm_calls: RawLlmCall[]
}
interface RawDashboard {
  team: { id: string; name: string | null }
  active_sprint: { sprint_id: string; name: string; goal: string | null; start_date: string | null; end_date: string | null; capacity_hours: number | null } | null
  pending_approvals: number
  evidence_by_source_label: Record<string, number>
}
interface RawList<T> { items: T[] }

// ---- reference data ------------------------------------------------------------------------------
const EVIDENCE_TYPE: Record<string, EvidenceRecord['source_type']> = {
  commit: 'commit', pull_request: 'pull_request', pull_request_review: 'review', issue: 'issue', issue_comment: 'issue',
  worklog: 'worklog', standup: 'standup', standup_claim: 'standup',
}
const mapEvidence = (e: RawEvidence): EvidenceRecord => ({
  id: e.evidence_id, source_type: EVIDENCE_TYPE[e.evidence_type] ?? 'issue', task_id: e.task_id, member_id: e.member_id,
  title: e.evidence_type === 'worklog' ? `${e.hours ?? 0}h — ${e.title ?? ''}` : (e.title?.trim() ? e.title : '(empty message)'),
  source_url: e.url, observed_at: e.occurred_at ?? '', source_label: e.source_label,
})
const mapTask = (t: RawTask): Task => ({
  ...t, assignee_id: t.assignee_id ?? '', sprint_id: t.sprint_id ?? '', estimate_hours: t.estimate_hours ?? 0, due_date: t.due_date ?? '', version: 1,
})

const loadMembers = () => memo('members', 10_000, async () => (await lreq<RawList<Member>>(`/teams/${TEAM}/members?limit=500`)).items)
const loadTasks = () => memo('tasks', 3_000, async () => (await lreq<RawList<RawTask>>(`/teams/${TEAM}/tasks?limit=500`)).items.map(mapTask))
const loadEvidence = () => memo('evidence', 10_000, async () => (await lreq<RawList<RawEvidence>>(`/teams/${TEAM}/evidence?limit=500`)).items.map(mapEvidence))
const loadDashboard = () => memo('dashboard', 1_500, () => lreq<RawDashboard>(`/teams/${TEAM}/dashboard`))
const loadPending = () => memo('pending', 1_500, () => lreq<RawApproval[]>('/approvals'))

// ---- runs ----------------------------------------------------------------------------------------
const runKey = () => `fairsprint.liveRun.${TEAM}`
const storedRunId = (): string | null => { try { return localStorage.getItem(runKey()) } catch { return null } }
const rememberRun = (id: string) => { try { localStorage.setItem(runKey(), id) } catch { /* storage unavailable */ } }

// The backend derives run ids from the request (sha1 of team|sprint|as_of). Reproduce it so a run started elsewhere is found.
async function runIdFor(sprint: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${TEAM}|${sprint}|latest`))
  return 'run_' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}
const loadRun = (id: string) => memo(`run:${id}`, 1_200, () => lreq<RawRun>(`/agent-runs/${id}`))

async function latestRunId(): Promise<string | null> {
  const known = storedRunId()
  if (known) return known
  const d = await loadDashboard()
  for (const sprint of [d.active_sprint?.sprint_id, 'active'].filter(Boolean) as string[]) {
    const id = await runIdFor(sprint)
    try { await loadRun(id); rememberRun(id); return id } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e }
  }
  return null
}
async function latestRun(): Promise<RawRun | null> {
  const id = await latestRunId()
  if (!id) return null
  try { return await loadRun(id) } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
}

const PHASES = ['queued', 'load_context', 'planner', 'collect_evidence', 'verify_claims', 'assess_contribution', 'classify_risk', 'propose_replan', 'request_mentor_approval', 'generate_report', 'persist_results']
const STAGE: Record<string, RunStage> = {
  queued: 'plan', load_context: 'plan', planner: 'plan', collect_evidence: 'act', verify_claims: 'observe', assess_contribution: 'observe',
  classify_risk: 'observe', propose_replan: 'replan', request_mentor_approval: 'approval', generate_report: 'report', persist_results: 'report',
}
const phaseIdx = (r: RawRun) => Math.max(0, PHASES.indexOf(r.phase ?? 'queued'))
const startedAt = (r: RawRun) => r.tool_calls.map((t) => t.created_at ?? t.called_at).filter(Boolean).sort()[0] ?? new Date().toISOString()

function mapRun(r: RawRun): AgentRun {
  const status: RunStatus = r.status === 'running' ? (r.phase === 'queued' || !r.phase ? 'queued' : 'running')
    : (['awaiting_approval', 'completed', 'failed'].includes(r.status) ? (r.status as RunStatus) : 'running')
  const tasks = new Set((r.plan.claims_to_verify ?? []).flatMap((c) => c.task_ids))
  const es = r.evidence_summary
  return {
    run_id: r.run_id, team_id: r.team_id, sprint_id: r.sprint_id ?? '', status, stage: STAGE[r.phase ?? 'queued'] ?? 'plan',
    started_at: startedAt(r), completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
    initiated_by: 'mentor', tasks_analyzed: tasks.size, evidence_collected: (es.github ?? 0) + (es.worklogs ?? 0) + (es.standups ?? 0),
  }
}

// ---- timeline, tool calls, LLM calls (all derived from the run detail; the backend has no events endpoint) --------
const TOOL_LABEL: Record<string, { title: string; op: (t: string) => string }> = {
  'supabase.load_context': { title: 'Loaded team, sprint and member context', op: () => `SELECT teams, sprints, team_members WHERE team_id = ${TEAM}` },
  'supabase.read_evidence': { title: 'Read stored evidence, worklogs and standups', op: () => `SELECT evidence WHERE team_id = ${TEAM}` },
  'github.collect_activity': { title: 'Collected GitHub activity', op: () => 'GET repository commits, pull requests, reviews and issues' },
}
function events(r: RawRun): AgentEvent[] {
  const idx = phaseIdx(r)
  const out: AgentEvent[] = []
  const t0 = startedAt(r)
  let lastTs = t0
  const push = (e: Omit<AgentEvent, 'id' | 'run_id' | 'parent_event_id' | 'cursor' | 'timestamp' | 'retries' | 'evidence_ids' | 'source_label'> & Partial<AgentEvent>) => {
    const n = out.length + 1
    out.push({ id: `${r.run_id}-EV${String(n).padStart(2, '0')}`, run_id: r.run_id, parent_event_id: null, cursor: String(n).padStart(4, '0'),
      timestamp: lastTs, retries: 0, evidence_ids: [], source_label: 'live', ...e })
  }
  const tool = (name: string) => r.tool_calls.find((c) => c.tool_name === name)
  const addTool = (name: string, category: EventCategory = 'retrieval') => {
    const c = tool(name)
    if (!c) return
    lastTs = c.created_at ?? c.called_at ?? lastTs
    push({ category, title: TOOL_LABEL[name]?.title ?? name, tool: name, status: c.status === 'error' ? 'failed' : 'completed', timestamp: lastTs,
      duration_ms: c.latency_ms, input_summary: TOOL_LABEL[name]?.op(name) ?? null, output_summary: c.status === 'error' ? null : `${c.result_count ?? 0} records${c.status === 'success' ? '' : ' (partial)'}`, error: c.error })
  }
  const addLlm = (schema: string, title: string, category: EventCategory) => {
    const list = r.llm_calls.filter((c) => c.schema === schema)
    if (!list.length) return
    const ok = [...list].reverse().find((c) => c.status === 'success')
    const failed = list.filter((c) => c.status !== 'success').length
    push({ category, title, tool: null, status: ok ? 'completed' : 'failed', duration_ms: list.reduce((s, c) => s + (c.latency_ms ?? 0), 0),
      input_summary: `Structured output: ${schema}`, output_summary: ok ? `Answered by ${ok.provider}${failed ? ` after ${failed} failed attempt${failed > 1 ? 's' : ''}` : ''}` : 'No provider produced valid output',
      error: ok ? null : 'All providers failed' })
  }

  if (idx >= 1) addTool('supabase.load_context')
  if (idx >= 2) addLlm('ExecutionPlan', 'Planned which claims and evidence to check', 'planning')
  if (idx >= 3) { addTool('github.collect_activity'); addTool('supabase.read_evidence') }
  if (idx >= 4) push({ category: 'analysis', title: 'Matched claims to evidence with fixed rules', tool: null, status: 'completed', duration_ms: null,
    input_summary: 'Member, task, time window and evidence type', output_summary: `${r.assessments.length || 'Per-member'} statuses assigned by rules, not by the model`, error: null })
  if (idx >= 5) addLlm('AssessmentBatch', 'Interpreted ambiguous evidence (advisory)', 'analysis')
  const flagged = r.assessments.filter((a) => a.status !== 'verified' && a.risk_level !== 'none')
  if (idx >= 6) push({ category: 'risk', title: flagged.length ? `${flagged.length} member${flagged.length > 1 ? 's need' : ' needs'} review` : 'No risks need review', tool: null, status: 'completed',
    duration_ms: null, input_summary: 'Risk rules and thresholds', output_summary: flagged.length ? 'Evidence gaps listed; none is a finding of misconduct' : 'All claims supported', error: null })
  if (idx >= 7) push({ category: 'decision', title: r.replans.length ? `Prepared ${r.replans.length} re-plan proposal${r.replans.length > 1 ? 's' : ''}` : 'No re-plan needed', tool: null, status: 'completed',
    duration_ms: null, input_summary: 'Capacity and dependency validation', output_summary: r.replans.length ? 'Proposals validated before being shown' : null, error: null })
  const pending = r.approvals.filter((a) => a.status === 'pending').length
  if (idx >= 8) push({ category: 'approval', title: pending ? `Waiting for manager approval (${pending} pending)` : 'Mentor decisions recorded', tool: null,
    status: pending ? 'running' : 'completed', duration_ms: null, input_summary: null, output_summary: pending ? 'No change is made before approval' : `${r.approvals.length} decision${r.approvals.length === 1 ? '' : 's'} recorded`, error: null })
  if (r.status === 'completed') push({ category: 'completion', title: 'Generated the weekly mentor report', tool: null, status: 'completed', duration_ms: null,
    input_summary: null, output_summary: 'Report built from stored records', error: null })
  if (r.status === 'failed') push({ category: 'failure', title: 'Run failed', tool: null, status: 'failed', duration_ms: null, input_summary: null, output_summary: null, error: r.error ?? 'The run failed' })
  if (r.status === 'running' && idx < PHASES.length - 1) {
    push({ category: 'planning', title: `Working on: ${PHASES[idx + 1].replaceAll('_', ' ')}`, tool: null, status: 'running', duration_ms: null, input_summary: null, output_summary: null, error: null })
  }
  return out
}

// ---- approvals as recommendations ----------------------------------------------------------------------
const STATUS: Record<string, ApprovalStatus> = { pending: 'pending_review', approved: 'completed', rejected: 'rejected' }

function impactOf(rp: RawReplan, tasks: Task[], members: Member[]): ReplanImpact {
  const task = tasks.find((t) => t.task_id === rp.task_id)
  const est = task?.estimate_hours ?? 0
  const open = (id: string) => tasks.filter((t) => t.assignee_id === id && t.status !== 'done').reduce((s, t) => s + t.estimate_hours, 0)
  const cap = (id: string) => members.find((m) => m.member_id === id)?.weekly_capacity_hours ?? 0
  const moved = task?.assignee_id === rp.proposed_assignee_id
  const fromNow = open(rp.current_assignee_id), toNow = open(rp.proposed_assignee_id)
  const from = { member_id: rp.current_assignee_id, open_hours_before: moved ? fromNow + est : fromNow, open_hours_after: moved ? fromNow : fromNow - est, capacity_hours: cap(rp.current_assignee_id) }
  const to = { member_id: rp.proposed_assignee_id, open_hours_before: moved ? toNow - est : toNow, open_hours_after: moved ? toNow : toNow + est, capacity_hours: cap(rp.proposed_assignee_id) }
  const who = members.find((m) => m.member_id === rp.proposed_assignee_id)?.name ?? rp.proposed_assignee_id
  const over = to.open_hours_after - to.capacity_hours
  const unmet = (task?.dependency_task_ids ?? []).filter((d) => tasks.find((t) => t.task_id === d)?.status !== 'done')
  const checks: ReplanImpact['checks'] = [
    over > 0 ? { key: 'capacity', status: 'fail', detail: `${who} would have ${to.open_hours_after}h open against ${to.capacity_hours}h weekly capacity (${over}h over).` }
      : { key: 'capacity', status: 'pass', detail: `${who} would have ${to.open_hours_after}h open against ${to.capacity_hours}h weekly capacity.` },
    unmet.length ? { key: 'dependencies', status: 'conditional', detail: `Still depends on ${unmet.join(', ')}. The task can only start once those are done.` }
      : { key: 'dependencies', status: 'pass', detail: (task?.dependency_task_ids.length ?? 0) ? `All dependencies (${task!.dependency_task_ids.join(', ')}) are done.` : 'No dependencies.' },
  ]
  if (rp.capacity_check === 'needs_confirmation') checks.push({ key: 'evidence', status: 'conditional', detail: 'Triggered by an evidence mismatch. Clarify with the member first; do not reassign on a mismatch alone.' })
  return { task_estimate_hours: est, from, to, checks }
}

// Approvals that left the pending list (after a decision) would vanish from GET /approvals, so remember them.
const seen = new Map<string, Recommendation>()

async function buildRecommendations(): Promise<Recommendation[]> {
  const [pending, run, tasks, members, evidence] = await Promise.all([loadPending(), latestRun(), loadTasks(), loadMembers(), loadEvidence()])
  const rows = new Map<string, { a: RawApproval; replan: RawReplan | null; run: RawRun | null }>()
  for (const a of pending) rows.set(a.approval_id, { a, replan: a.replan ?? null, run: null })
  for (const a of run?.approvals ?? []) rows.set(a.approval_id, { a, replan: run!.replans.find((r) => r.replan_id === a.replan_id) ?? null, run })

  const nm = (id: string | null) => members.find((m) => m.member_id === id)?.name ?? id ?? 'unknown'
  const out: Recommendation[] = []
  for (const { a, replan, run: owner } of rows.values()) {
    const base = {
      recommendation_id: a.approval_id, approval_id: a.approval_id, run_id: a.run_id ?? '', status: STATUS[a.status] ?? 'pending_review',
      version: 1, created_at: a.created_at ?? new Date().toISOString(), decided_at: null, reviewer_id: a.reviewer_id, decision_reason: a.decision_reason,
      manager_note: null, execution_status: a.status === 'approved' ? ('completed' as const) : null, superseded_by: null,
      source_label: (a.source_label ?? replan?.source_label ?? 'live') as 'synthetic' | 'live',
    }
    if (replan) {
      out.push({
        ...base, type: 'task_reassignment', task_id: replan.task_id, trigger_reason: replan.trigger_reason, rationale: replan.rationale,
        current_assignee_id: replan.current_assignee_id, proposed_assignee_id: replan.proposed_assignee_id, capacity_check: replan.capacity_check,
        dependency_check: replan.dependency_check, expected_impact: 'Keeps the task moving by moving it to a teammate with remaining capacity.',
        potential_downside: 'Context switch for the new owner; the original owner should leave handoff notes.',
        evidence_ids: evidence.filter((e) => e.task_id === replan.task_id).map((e) => e.id), impact: impactOf(replan, tasks, members),
      })
    } else {
      const src = owner ?? (run && run.run_id === a.run_id ? run : null)
      const flagged = src?.assessments.filter((x) => x.status !== 'verified' && x.risk_level !== 'none') ?? []
      out.push({
        ...base, type: 'risk_review', task_id: '', trigger_reason: 'Formal risk review requires mentor approval',
        rationale: flagged.length ? `Members flagged for review: ${flagged.map((x) => nm(x.member_id)).join(', ')}. Approving records that you reviewed the evidence; nothing is reassigned.` : 'Formal risk review. Approving records the review; nothing is reassigned.',
        current_assignee_id: '', proposed_assignee_id: '', capacity_check: '', dependency_check: '',
        expected_impact: 'Records a human review of the evidence gaps.', potential_downside: 'None: no assignments change.',
        evidence_ids: [...new Set(flagged.flatMap((x) => x.evidence_ids))], impact: null,
      })
    }
  }
  for (const r of out) seen.set(r.approval_id, r)
  // Keep decided approvals the backend no longer lists as pending.
  for (const [id, r] of seen) if (!out.some((o) => o.approval_id === id)) out.push(r)
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ---- weekly report ----------------------------------------------------------------------------------
interface RawReport {
  report_id: string; summary: string | null
  body: {
    sprint?: { sprint_id: string; name: string }
    verified_facts?: { member: string | null; member_id: string; statement: string; evidence_ids: string[] }[]
    risks?: { member: string | null; member_id: string; status: string; risk_level: string; explanation: string; missing_context: string | null; evidence_ids: string[] }[]
    unavailable_evidence?: { member?: string | null; member_id?: string; note?: string | null; tool?: string; error?: string | null }[]
    recommendations?: string[]
    decisions?: { approval_id: string; status: string; reason: string | null; task_id: string | null; proposed_assignee_id: string | null }[]
  }
}

async function buildReport(): Promise<WeeklyReport> {
  const [rep, dash, tasks, members, evidence] = await Promise.all([lreq<RawReport>('/reports/weekly'), loadDashboard(), loadTasks(), loadMembers(), loadEvidence()])
  const b = rep.body
  const count = (s: string) => tasks.filter((t) => t.status === s).length
  const sp = dash.active_sprint
  const sprint: Sprint = { sprint_id: sp?.sprint_id ?? '', team_id: TEAM, project_id: PROJECT, name: sp?.name ?? 'Sprint', goal: sp?.goal ?? '', start_date: sp?.start_date ?? '', end_date: sp?.end_date ?? '', status: 'active', capacity_hours: sp?.capacity_hours ?? 0 }
  const statements: ReportSummary['statements'] = []
  if (rep.summary) statements.push({ text: rep.summary, refs: [] })
  for (const f of b.verified_facts ?? []) statements.push({ text: `${f.member ?? f.member_id}: ${f.statement}`, refs: f.evidence_ids })
  for (const r of b.risks ?? []) statements.push({ text: `${r.member ?? r.member_id}: ${r.explanation}${r.missing_context ? ` Open item: ${r.missing_context}` : ''}`, refs: r.evidence_ids })
  for (const u of b.unavailable_evidence ?? []) statements.push({ text: u.tool ? `${u.tool} was ${u.error ? 'unavailable' : 'partial'}${u.error ? `: ${u.error}` : ''}. That is not evidence of no activity.` : `${u.member ?? u.member_id}: ${u.note ?? 'insufficient evidence'}`, refs: [] })
  for (const x of b.recommendations ?? []) statements.push({ text: x, refs: [] })
  const summary: ReportSummary = { statements, generated_at: new Date().toISOString(), provider: 'backend', model: 'rule-based report writer', kind: 'deterministic' }

  const risks: RiskAssessment[] = (b.risks ?? []).map((r) => ({ assessment_id: `${rep.report_id}:${r.member_id}`, member_id: r.member_id, run_id: '', status: r.status, risk_level: r.risk_level,
    summary: r.explanation, evidence_ids: r.evidence_ids, missing_context: r.missing_context ?? '', recommended_action: 'Request clarification and mentor review. This is not a finding of misconduct.' }))
  return {
    summary, team_id: TEAM, sprint, generated_at: new Date().toISOString(), basis: 'persisted_records',
    progress: { total: tasks.length, done: count('done'), in_progress: count('in_progress'), blocked: count('blocked'), todo: count('todo') },
    blockers: tasks.filter((t) => t.status === 'blocked').map((t) => ({ task_id: t.task_id, title: t.title, assignee_id: t.assignee_id, dependency_task_ids: t.dependency_task_ids })),
    discrepancies: risks,
    contributions: members.map((m) => {
      const mine = evidence.filter((e) => e.member_id === m.member_id)
      const by: Record<string, number> = {}
      for (const e of mine) by[e.source_type] = (by[e.source_type] ?? 0) + 1
      return { member_id: m.member_id, name: m.name, evidence_by_type: by, hours_logged: mine.filter((e) => e.source_type === 'worklog').reduce((s, e) => s + (parseFloat(e.title) || 0), 0),
        tasks_done: tasks.filter((t) => t.assignee_id === m.member_id && t.status === 'done').length,
        note: mine.length ? 'Reviews, QA, docs, research and coordination count as contributions. Commit count alone is weak evidence.' : 'No linked evidence found. This is not evidence of no work.' }
    }),
    recommendations: (b.decisions ?? []).map((d) => ({ recommendation_id: d.approval_id, task_id: d.task_id ?? '', status: STATUS[d.status] ?? 'pending_review', summary: d.reason ?? `Proposed owner: ${d.proposed_assignee_id ?? 'n/a'}` })),
  }
}

// ---- the adapter surface (only the methods the backend can answer) ---------------------------------------------
export const liveApi = {
  async me(): Promise<Me> {
    await lreq('/approvals') // 401 when the token is wrong; also proves the backend is reachable
    return { user_id: 'mentor', name: 'Mentor', email: '', member_id: null, memberships: [{ project_id: PROJECT, team_id: TEAM, role: 'ADMIN', status: 'ACTIVE' }] }
  },

  async dashboard(): Promise<Dashboard> {
    const [d, tasks, evidence, run] = await Promise.all([loadDashboard(), loadTasks(), loadEvidence(), latestRun()])
    const sp = d.active_sprint
    const risks: RiskAssessment[] = (run?.assessments ?? []).filter((a) => a.risk_level !== 'none').map((a) => ({
      assessment_id: a.assessment_id, member_id: a.member_id ?? '', run_id: run!.run_id, status: a.status, risk_level: a.risk_level, summary: a.summary ?? '',
      evidence_ids: a.evidence_ids, missing_context: a.missing_context ?? '', recommended_action: a.recommended_action ?? '' }))
    const covered = tasks.filter((t) => evidence.some((e) => e.task_id === t.task_id)).length
    const mapped = run ? mapRun(run) : null
    return {
      team_id: TEAM,
      sprint: { sprint_id: sp?.sprint_id ?? '', team_id: TEAM, project_id: PROJECT, name: sp?.name ?? 'No active sprint', goal: sp?.goal ?? '', start_date: sp?.start_date ?? '', end_date: sp?.end_date ?? '', status: 'active', capacity_hours: sp?.capacity_hours ?? 0 },
      kpis: {
        tasks_analyzed: mapped?.tasks_analyzed ?? 0, evidence_collected: Object.values(d.evidence_by_source_label).reduce((s, n) => s + n, 0),
        risks_detected: risks.length, actions_pending: d.pending_approvals, evidence_coverage: tasks.length ? Math.round((covered / tasks.length) * 100) / 100 : 0,
      },
      agent_status: { state: mapped?.status ?? 'idle', last_heartbeat: new Date().toISOString(), run_id: mapped?.run_id ?? null },
      risks, pending_approvals: d.pending_approvals,
    }
  },

  members: async () => page(await loadMembers()),
  tasks: async () => page(await loadTasks()),
  async sprints() {
    const sp = (await loadDashboard()).active_sprint
    return page<Sprint>(sp ? [{ sprint_id: sp.sprint_id, team_id: TEAM, project_id: PROJECT, name: sp.name, goal: sp.goal ?? '', start_date: sp.start_date ?? '', end_date: sp.end_date ?? '', status: 'active', capacity_hours: sp.capacity_hours ?? 0 }] : [])
  },
  async evidence(_team: string, f: { member_id?: string; task_id?: string } = {}) {
    return page((await loadEvidence()).filter((e) => (!f.member_id || e.member_id === f.member_id) && (!f.task_id || e.task_id === f.task_id)))
  },

  async startRun(b: { team_id: string; sprint_id: string; command?: string }) {
    const r = await lreq<{ run_id: string }>('/agents/analyze', { method: 'POST', body: JSON.stringify({ team_id: b.team_id, sprint_id: b.sprint_id || undefined, wait: false }) })
    rememberRun(r.run_id)
    cache.clear()
    return { run_id: r.run_id }
  },
  async runs() {
    const r = await latestRun()
    return page(r ? [mapRun(r)] : [])
  },
  async run(runId: string) { return mapRun(await loadRun(runId)) },
  async runEvents(runId: string) { return page(events(await loadRun(runId))) },
  // Served by the backend (tool_call_logs and the persisted router log); fields it does not record come back null.
  toolCalls: (runId: string) => lreq<Page<ToolCall>>(`/agent-runs/${runId}/tool-calls`),
  llmCalls: (runId: string) => lreq<Page<LlmCall>>(`/agent-runs/${runId}/llm-calls`),
  runControl: async () => unsupported('Pause, resume, stop and retry'),

  async recommendations() { return page(await buildRecommendations()) },
  async approvals() { return page(await buildRecommendations()) },
  async recommendation(id: string) {
    const r = (await buildRecommendations()).find((x) => x.approval_id === id)
    if (!r) throw new ApiError(404, { code: 'not_found', message: 'Proposal not found' })
    return r
  },
  async recommendationEvidence(id: string) {
    const r = (await buildRecommendations()).find((x) => x.approval_id === id)
    const ev = await loadEvidence()
    return page(ev.filter((e) => r?.evidence_ids.includes(e.id)))
  },
  async decide(id: string, b: DecisionRequest) {
    if (b.decision === 'modify') unsupported('Modifying a proposal')
    await lreq(`/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision: b.decision, reason: b.reason ?? b.manager_note }) })
    cache.clear()
    const list = await buildRecommendations()
    const r = list.find((x) => x.approval_id === id) ?? seen.get(id)!
    // The backend applies an approval immediately, so the decided proposal is final.
    const done: Recommendation = { ...r, status: b.decision === 'approve' ? 'completed' : 'rejected', execution_status: b.decision === 'approve' ? 'completed' : null,
      decided_at: new Date().toISOString(), manager_note: b.manager_note ?? null, decision_reason: b.reason ?? null }
    seen.set(id, done)
    return done
  },
  retryApproval: async () => unsupported('Retrying an execution'),
  async auditEvents() { return page([]) }, // the backend writes audit rows but exposes no read endpoint yet

  weeklyReport: () => buildReport(),
  generateReport: () => buildReport(), // the backend writes the report itself once a run's approvals are decided
}
