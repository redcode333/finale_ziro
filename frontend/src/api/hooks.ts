import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { GithubScope, BlockerInput, DecisionRequest, Recommendation, StandupInput } from '@/types'
import { ApiError, api } from './client'

export const POLL_MS = 2000
const TERMINAL_RUN = ['completed', 'failed', 'cancelled']

export const useDashboard = (teamId: string) =>
  useQuery({ queryKey: ['dashboard', teamId], queryFn: () => api.dashboard(teamId), enabled: !!teamId, refetchInterval: POLL_MS })

export const useMembers = (teamId: string) =>
  useQuery({ queryKey: ['members', teamId], queryFn: () => api.members(teamId), enabled: !!teamId, select: (d) => d.items })
export const useTasks = (teamId: string) =>
  useQuery({ queryKey: ['tasks', teamId], queryFn: () => api.tasks(teamId), enabled: !!teamId, select: (d) => d.items, refetchInterval: POLL_MS })
export const useSprints = (teamId: string) =>
  useQuery({ queryKey: ['sprints', teamId], queryFn: () => api.sprints(teamId), enabled: !!teamId, select: (d) => d.items })
export const useEvidence = (teamId: string) =>
  useQuery({ queryKey: ['evidence', teamId], queryFn: () => api.evidence(teamId), enabled: !!teamId, select: (d) => d.items })

export const useRuns = (teamId: string) =>
  useQuery({ queryKey: ['runs', teamId], queryFn: () => api.runs(teamId), enabled: !!teamId, select: (d) => d.items, refetchInterval: POLL_MS })
export const useRun = (runId?: string) =>
  useQuery({
    queryKey: ['run', runId], queryFn: () => api.run(runId!), enabled: !!runId,
    refetchInterval: (q) => (q.state.data && TERMINAL_RUN.includes(q.state.data.status) ? false : POLL_MS),
  })
export const useRunEvents = (runId?: string, active = true) =>
  useQuery({
    queryKey: ['run-events', runId], queryFn: () => api.runEvents(runId!), enabled: !!runId,
    select: (d) => d.items, refetchInterval: active ? POLL_MS : false,
  })

export const useRecommendations = (teamId: string) =>
  useQuery({ queryKey: ['recommendations', teamId], queryFn: () => api.recommendations(teamId), enabled: !!teamId, select: (d) => d.items, refetchInterval: POLL_MS })
export const useRecommendationEvidence = (id?: string) =>
  useQuery({ queryKey: ['recommendation-evidence', id], queryFn: () => api.recommendationEvidence(id!), enabled: !!id, select: (d) => d.items })
export const useAuditEvents = () =>
  useQuery({ queryKey: ['audit'], queryFn: () => api.auditEvents(), select: (d) => d.items, refetchInterval: POLL_MS })

const errMsg = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : 'Something went wrong. Please try again.'

export function useStartRun(teamId: string, onStarted: (runId: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { sprint_id: string; command?: string }) => api.startRun({ team_id: teamId, ...b }),
    onSuccess: ({ run_id, existing }) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      onStarted(run_id)
      if (existing) toast.info('This sprint was already analyzed. Showing that run.')
      else toast.success('Analysis started')
    },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export function useRunControl(runId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'stop' | 'retry') => api.runControl(runId!, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run', runId] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['run-events', runId] })
    },
    onError: (e) => toast.error(errMsg(e)),
  })
}

const refreshApprovalData = (qc: ReturnType<typeof useQueryClient>) => {
  for (const key of ['recommendations', 'dashboard', 'audit', 'tasks']) qc.invalidateQueries({ queryKey: [key] })
}

export function useDecide() {
  const qc = useQueryClient()
  return useMutation<Recommendation, unknown, { id: string; body: DecisionRequest }>({
    mutationFn: ({ id, body }) => api.decide(id, body),
    onSuccess: () => refreshApprovalData(qc),
    onError: (e) => {
      // Stale or already-decided proposals: reload authoritative state instead of guessing.
      refreshApprovalData(qc)
      toast.error(errMsg(e))
    },
  })
}

export function useRetryApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.retryApproval(id),
    onSuccess: () => { refreshApprovalData(qc); toast.info('Retrying execution') },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export const useWeeklyReport = (teamId: string) =>
  useQuery({ queryKey: ['weekly-report', teamId], queryFn: () => api.weeklyReport(teamId), enabled: !!teamId, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 })
export const useEvaluationResults = () => useQuery({ queryKey: ['evaluations'], queryFn: api.evaluationResults })
export function useRunEvaluations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.runEvaluations,
    onSuccess: (d) => qc.setQueryData(['evaluations'], d),
    onError: (e) => toast.error(errMsg(e)),
  })
}
export const useSimulate = () =>
  useMutation({ mutationFn: (scenario: string) => api.simulate(scenario), onError: (e) => toast.error(errMsg(e)) })
export const useApprovals = (teamId: string) =>
  useQuery({ queryKey: ['approvals', teamId], queryFn: () => api.approvals(teamId), enabled: !!teamId, select: (d) => d.items, refetchInterval: POLL_MS })

export const useMyEvidence = (teamId: string, memberId: string | null) =>
  useQuery({ queryKey: ['evidence', teamId, memberId], queryFn: () => api.evidence(teamId, { member_id: memberId ?? undefined }), enabled: !!teamId && !!memberId, select: (d) => d.items })
export const useStandups = (teamId: string) =>
  useQuery({ queryKey: ['standups', teamId], queryFn: () => api.standups(teamId), enabled: !!teamId, select: (d) => d.items })
export function useSubmitStandup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: StandupInput) => api.submitStandup(b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['standups'] }); toast.success('Standup submitted') },
    onError: (e) => toast.error(errMsg(e)),
  })
}
export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateTask(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Task updated') },
    onError: (e) => toast.error(errMsg(e)),
  })
}
export const useBlockers = (teamId: string) =>
  useQuery({ queryKey: ['blockers', teamId], queryFn: () => api.blockers(teamId), enabled: !!teamId, select: (d) => d.items })
export function useRaiseBlocker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: BlockerInput) => api.raiseBlocker(b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blockers'] }); toast.success('Blocker raised') },
    onError: (e) => toast.error(errMsg(e)),
  })
}
export function useResolveBlocker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.resolveBlocker(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blockers'] }); toast.success('Blocker resolved') },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export const useInvitations = (projectId: string) =>
  useQuery({ queryKey: ['invitations', projectId], queryFn: () => api.invitations(projectId), enabled: !!projectId, select: (d) => d.items })
export function useInvite(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => api.invite(projectId, { email }),
    onSuccess: (i) => { qc.invalidateQueries({ queryKey: ['invitations'] }); toast.success(`Invitation sent to ${i.email}`) },
    onError: (e) => toast.error(errMsg(e)),
  })
}
export function useRevokeInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invitations'] }); toast.success('Invitation revoked') },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export const useGithub = (scope: GithubScope) =>
  useQuery({ queryKey: ['github', scope], queryFn: () => api.githubStatus(scope) })
export function useGithubConnect(scope: GithubScope) {
  return useMutation({
    mutationFn: () => api.githubConnect({ scope, return_to: window.location.pathname }),
    onSuccess: ({ authorize_url }) => window.location.assign(authorize_url),
    onError: (e) => toast.error(errMsg(e)),
  })
}
export function useGithubDisconnect(scope: GithubScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.githubDisconnect(scope),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['github'] }); toast.success('GitHub disconnected') },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export function useGenerateReport(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.generateReport(teamId),
    onSuccess: (d) => { qc.setQueryData(['weekly-report', teamId], d); toast.success('Mentor summary written') },
  })
}

export const useClaims = (teamId: string) =>
  useQuery({ queryKey: ['claims', teamId], queryFn: () => api.claims(teamId), enabled: !!teamId, select: (d) => d.items })

export const useStandupStatus = (teamId: string, date?: string) =>
  useQuery({ queryKey: ['standup-status', teamId, date ?? 'default'], queryFn: () => api.standupStatus(teamId, date), enabled: !!teamId, refetchInterval: POLL_MS })
export function useRemind(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { member_id: string; date: string }) => api.remind(b),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['standup-status', teamId] })
      toast.success(r.created ? 'Reminder sent' : 'A reminder was already sent for this day')
    },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export function useRequestReplan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sprintId, ...b }: { sprintId: string; member_id: string; reason?: string }) => api.requestReplan(sprintId, b),
    onSuccess: (r) => {
      for (const key of ['recommendations', 'approvals', 'members', 'tasks', 'dashboard', 'audit', 'standup-status']) qc.invalidateQueries({ queryKey: [key] })
      const n = r.proposals.length
      toast.success(n ? `${n} re-plan proposal${n > 1 ? 's' : ''} ready for review` : 'No new proposals were created')
    },
    onError: (e) => toast.error(errMsg(e)),
  })
}

export const useToolCalls = (runId?: string, active = true) =>
  useQuery({ queryKey: ['tool-calls', runId], queryFn: () => api.toolCalls(runId!), enabled: !!runId, select: (d) => d.items, refetchInterval: active ? POLL_MS : false })
export const useLlmCalls = (runId?: string, active = true) =>
  useQuery({ queryKey: ['llm-calls', runId], queryFn: () => api.llmCalls(runId!), enabled: !!runId, select: (d) => d.items, refetchInterval: active ? POLL_MS : false })
