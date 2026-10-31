import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BlockerInput, DecisionRequest, Recommendation, StandupInput } from '@/types'
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

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')

export function useStartRun(teamId: string, onStarted: (runId: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { sprint_id: string; command?: string }) => api.startRun({ team_id: teamId, ...b }),
    onSuccess: ({ run_id }) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      onStarted(run_id)
      toast.success(`Analysis ${run_id} started`)
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
  useQuery({ queryKey: ['weekly-report', teamId], queryFn: () => api.weeklyReport(teamId), enabled: !!teamId })
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
