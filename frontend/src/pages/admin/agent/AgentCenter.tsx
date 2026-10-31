import { useRef, useState } from 'react'
import {
  useDashboard, useEvidence, useMembers, useRecommendations, useRun, useRunControl, useRunEvents, useRuns, useSprints, useStartRun, useTasks,
} from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'
import type { AgentEvent } from '@/types'
import StandupParticipation from '../StandupParticipation'
import AgentCommandBar from './AgentCommandBar'
import AgentHeader from './AgentHeader'
import AgentInsightsPanel from './AgentInsightsPanel'
import AgentMetrics, { type MetricKey } from './AgentMetrics'
import ApprovalDrawer from './ApprovalDrawer'
import CurrentExecutionCard from './CurrentExecutionCard'
import EventDetailDrawer from './EventDetailDrawer'
import EvidenceExplorer from './EvidenceExplorer'
import ExecutionTimeline from './ExecutionTimeline'
import RecommendationPanel from './RecommendationPanel'
import RunTrace from './RunTrace'

const LIVE = ['queued', 'running']

export default function AgentCenter() {
  const { me } = useAuth()
  const teamId = me?.memberships.find((m) => m.role === 'ADMIN')?.team_id ?? ''

  const { data: sprints = [] } = useSprints(teamId)
  const { data: runs } = useRuns(teamId)
  const { data: members } = useMembers(teamId)
  const { data: tasks } = useTasks(teamId)
  const { data: evidence } = useEvidence(teamId)
  const { data: recs, isPending: recsLoading } = useRecommendations(teamId)
  const { data: dashboard } = useDashboard(teamId)

  const [pickedSprint, setPickedSprint] = useState<string>()
  const [pickedRun, setPickedRun] = useState<string>()
  const [openEvent, setOpenEvent] = useState<AgentEvent | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const sprintId = pickedSprint ?? sprints.find((s) => s.status === 'active')?.sprint_id ?? sprints[0]?.sprint_id ?? ''
  const runId = pickedRun ?? runs?.at(-1)?.run_id
  const { data: run } = useRun(runId)
  const live = !!run && LIVE.includes(run.status)
  // Keep polling until the run is terminal: the last event can land after the status flips to awaiting_approval.
  const settled = !!run && ['completed', 'failed', 'cancelled'].includes(run.status)
  const { data: events, isPending: eventsLoading } = useRunEvents(runId, !settled)

  const start = useStartRun(teamId, setPickedRun)
  const control = useRunControl(runId)

  const risksRef = useRef<HTMLElement>(null)
  const recsRef = useRef<HTMLElement>(null)
  const scrollTo = (r: React.RefObject<HTMLElement | null>) => r.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const onMetric = (k: MetricKey) => {
    if (k === 'evidence') setEvidenceOpen(true)
    else if (k === 'risks') scrollTo(risksRef)
    else if (k === 'pending') scrollTo(recsRef)
  }

  if (!teamId) return <p className="text-sm text-muted-foreground">Loading workspace…</p>

  return (
    <div className="space-y-4">
      <AgentHeader sprints={sprints} sprintId={sprintId} onSprintChange={setPickedSprint} run={run} busy={control.isPending}
        onControl={(a) => control.mutate(a)} />
      <AgentMetrics kpis={dashboard?.kpis} onSelect={onMetric} />
      <StandupParticipation teamId={teamId} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <CurrentExecutionCard run={run} />
          <ExecutionTimeline events={events} loading={!!runId && eventsLoading} onOpen={setOpenEvent} />
          <RunTrace runId={runId} active={!settled} />
          <RecommendationPanel panelRef={recsRef} recs={recs} tasks={tasks} members={members} loading={recsLoading} onReview={setReviewId} />
        </div>
        <AgentInsightsPanel dashboard={dashboard} members={members} risksRef={risksRef} onReview={() => scrollTo(recsRef)} />
      </div>

      <AgentCommandBar busy={start.isPending || live}
        onSubmit={(command) => start.mutate({ sprint_id: sprintId, command })} />

      <EventDetailDrawer event={openEvent} evidence={evidence ?? []} onClose={() => setOpenEvent(null)} />
      <ApprovalDrawer teamId={teamId} recId={reviewId} onClose={() => setReviewId(null)} onSwitch={setReviewId} />
      <EvidenceExplorer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} evidence={evidence} members={members} />
    </div>
  )
}
