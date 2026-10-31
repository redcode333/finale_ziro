import type {
  AgentEvent, AgentRun, ApiErrorBody, AppNotification, AuditEvent, Blocker, BlockerInput, GithubConnection, GithubScope, Invitation, Standup, StandupInput, Dashboard, DecisionRequest,
  EvidenceRecord, EvaluationResults, Me, Member, Page, Recommendation, SimulationResult, Sprint, Task, WeeklyReport,
} from '@/types'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export class ApiError extends Error {
  status: number
  code: string
  retryable: boolean
  constructor(status: number, body?: ApiErrorBody['error']) {
    super(body?.message ?? `Request failed (${status})`)
    this.status = status
    this.code = body?.code ?? 'unknown'
    this.retryable = body?.retryable ?? status >= 500
  }
}

// The auth layer registers a header provider so the client never imports React state.
let getAuthHeaders: () => Record<string, string> = () => ({})
export const setAuthHeaderProvider = (fn: typeof getAuthHeaders) => { getAuthHeaders = fn }

async function request<T>(path: string, init: RequestInit & { idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...getAuthHeaders() }
  if (init.body) headers['Content-Type'] = 'application/json'
  if (init.idempotent) headers['Idempotency-Key'] = crypto.randomUUID()
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as ApiErrorBody | undefined
    throw new ApiError(res.status, body?.error)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const qs = (p: Record<string, string | undefined>) => {
  const entries = Object.entries(p).filter(([, v]) => v) as [string, string][]
  return entries.length ? `?${new URLSearchParams(entries)}` : ''
}
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, idempotent: true })

// One function per contract endpoint. Components reach these only through hooks.
export const api = {
  health: () => request<{ status: string }>('/health'),
  me: () => request<Me>('/me'),
  dashboard: (teamId: string) => request<Dashboard>(`/teams/${teamId}/dashboard`),
  members: (teamId: string) => request<Page<Member>>(`/teams/${teamId}/members`),
  tasks: (teamId: string) => request<Page<Task>>(`/teams/${teamId}/tasks`),
  sprints: (teamId: string) => request<Page<Sprint>>(`/teams/${teamId}/sprints`),
  evidence: (teamId: string, f: { member_id?: string; task_id?: string } = {}) =>
    request<Page<EvidenceRecord>>(`/teams/${teamId}/evidence${qs(f)}`),

  startRun: (b: { team_id: string; sprint_id: string; command?: string }) =>
    post<{ run_id: string }>('/agents/analyze', b),
  runs: (teamId: string) => request<Page<AgentRun>>(`/agent-runs${qs({ team_id: teamId })}`),
  run: (runId: string) => request<AgentRun>(`/agent-runs/${runId}`),
  runEvents: (runId: string, after?: string) =>
    request<Page<AgentEvent>>(`/agent-runs/${runId}/events${qs({ after })}`),
  runControl: (runId: string, action: 'pause' | 'resume' | 'stop' | 'retry') =>
    post<AgentRun>(`/agent-runs/${runId}/${action}`),

  recommendations: (teamId: string) =>
    request<Page<Recommendation>>(`/recommendations${qs({ team_id: teamId })}`),
  recommendation: (id: string) => request<Recommendation>(`/recommendations/${id}`),
  recommendationEvidence: (id: string) =>
    request<Page<EvidenceRecord>>(`/recommendations/${id}/evidence`),

  approvals: (teamId: string, status?: string) =>
    request<Page<Recommendation>>(`/approvals${qs({ team_id: teamId, status })}`),
  decide: (id: string, b: DecisionRequest) => post<Recommendation>(`/approvals/${id}/decision`, b),
  retryApproval: (id: string) => post<Recommendation>(`/approvals/${id}/retry`),
  auditEvents: (entityId?: string) =>
    request<Page<AuditEvent>>(`/audit-events${qs({ entity_id: entityId })}`),
  standups: (teamId: string) => request<Page<Standup>>(`/standups${qs({ team_id: teamId })}`),
  submitStandup: (b: StandupInput) => post<Standup>('/standups', b),
  updateTask: (id: string, b: { status: string }) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(b), idempotent: true }),
  blockers: (teamId: string) => request<Page<Blocker>>(`/blockers${qs({ team_id: teamId })}`),
  raiseBlocker: (b: BlockerInput) => post<Blocker>('/blockers', b),
  resolveBlocker: (id: string) =>
    request<Blocker>(`/blockers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }), idempotent: true }),
  invitations: (projectId: string) => request<Page<Invitation>>(`/projects/${projectId}/invitations`),
  invite: (projectId: string, b: { email: string }) => post<Invitation>(`/projects/${projectId}/invitations`, b),
  revokeInvitation: (id: string) => request<Invitation>(`/invitations/${id}`, { method: 'DELETE', idempotent: true }),
  githubStatus: (scope: GithubScope) => request<GithubConnection>(`/integrations/github${qs({ scope })}`),
  // The backend owns the OAuth exchange and token. The browser only follows the returned URL.
  githubConnect: (b: { scope: GithubScope; return_to: string }) => post<{ authorize_url: string }>('/integrations/github/connect', b),
  githubDisconnect: (scope: GithubScope) =>
    request<GithubConnection>(`/integrations/github${qs({ scope })}`, { method: 'DELETE', idempotent: true }),
  weeklyReport: (teamId: string) => request<WeeklyReport>(`/reports/weekly${qs({ team_id: teamId })}`),
  generateReport: (teamId: string) => post<WeeklyReport>(`/reports/weekly/generate${qs({ team_id: teamId })}`),
  runEvaluations: () => post<EvaluationResults>('/evaluations/run'),
  evaluationResults: () => request<EvaluationResults>('/evaluations/results'),
  simulate: (scenario: string) => post<SimulationResult>(`/reliability/simulate/${scenario}`),
  notifications: () => request<Page<AppNotification>>('/notifications'),
}
