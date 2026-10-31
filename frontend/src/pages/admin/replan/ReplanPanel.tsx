import MockOnlyNote from '@/components/common/MockOnlyNote'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useMembers, useRecommendations, useTasks } from '@/api/hooks'
import CapacityBar from '@/components/common/CapacityBar'
import { ApprovalStatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { isActionable } from '@/lib/status'
import { nameOf } from '@/lib/workload'
import type { Member, OwnerImpact, Recommendation, ReplanImpact } from '@/types'
import ApprovalDrawer from '../agent/ApprovalDrawer'
import ReplanChecks from './ReplanChecks'
import RequestReplanDialog from './RequestReplanDialog'

function Owner({ title, who, impact, members, moved }: { title: string; who: OwnerImpact; impact: 'before' | 'after'; members?: Member[]; moved?: boolean }) {
  const hours = impact === 'before' ? who.open_hours_before : who.open_hours_after
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-sm font-medium">{nameOf(members, who.member_id)}</p>
      <CapacityBar used={hours} capacity={who.capacity_hours} label={`${nameOf(members, who.member_id)} workload ${impact}`} />
      {moved && <p className="text-xs text-muted-foreground">{impact === 'before' ? 'Owns the task' : 'Takes over the task'}</p>}
    </div>
  )
}

type WithImpact = Recommendation & { impact: ReplanImpact }

function PlanCard({ rec, taskTitle, members, onReview }: { rec: WithImpact; taskTitle: string; members?: Member[]; onReview: (id: string) => void }) {
  const { impact } = rec
  return (
    <article aria-label={`Re-plan ${rec.approval_id}`} className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{taskTitle} <span className="font-mono text-xs text-muted-foreground">{rec.task_id} · {impact.task_estimate_hours}h</span></p>
          <p className="text-xs text-muted-foreground">{rec.approval_id} · trigger: {rec.trigger_reason}</p>
        </div>
        <ApprovalStatusBadge status={rec.status} />
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <section aria-label="Original plan" className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Original plan</h3>
          <Owner title="Current owner" who={impact.from} impact="before" members={members} moved />
          <Owner title="Proposed owner (today)" who={impact.to} impact="before" members={members} />
        </section>
        <ArrowRight className="hidden size-4 text-muted-foreground md:block" aria-hidden />
        <section aria-label="Proposed plan" className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Proposed plan</h3>
          <Owner title="Current owner" who={impact.from} impact="after" members={members} />
          <Owner title="Proposed owner" who={impact.to} impact="after" members={members} moved />
        </section>
      </div>

      <ReplanChecks checks={impact.checks} />
      <p className="text-xs text-muted-foreground">{rec.rationale}</p>
      <Button size="sm" variant={isActionable(rec.status) ? 'default' : 'outline'} onClick={() => onReview(rec.approval_id)}>
        {isActionable(rec.status) ? 'Review and decide' : 'View'}
      </Button>
    </article>
  )
}

export default function ReplanPanel({ teamId, sprintId }: { teamId: string; sprintId: string }) {
  const { data: recs, isPending } = useRecommendations(teamId)
  const { data: tasks } = useTasks(teamId)
  const { data: members } = useMembers(teamId)
  const [openId, setOpenId] = useState<string | null>(null)

  const inSprint = new Set((tasks ?? []).filter((t) => t.sprint_id === sprintId).map((t) => t.task_id))
  const plans = (recs ?? [])
    .filter((r): r is WithImpact => r.impact !== null && inSprint.has(r.task_id) && r.status !== 'superseded')
    .sort((a, b) => Number(!isActionable(a.status)) - Number(!isActionable(b.status)) || b.created_at.localeCompare(a.created_at))

  return (
    <section aria-label="Sprint re-plan" className="space-y-3">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Sprint re-plan</CardTitle>
          <RequestReplanDialog teamId={teamId} sprintId={sprintId} />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Proposals are validated in code for capacity and dependencies before they appear here. Nothing is reassigned until you approve.
          </p>
          <MockOnlyNote what="Requesting a re-plan" />
          {isPending ? <Skeleton className="h-32" /> : plans.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No re-plan proposals for this sprint. If someone drops off, request a re-plan.</p>
          ) : plans.map((r) => (
            <PlanCard key={r.approval_id} rec={r} taskTitle={tasks?.find((t) => t.task_id === r.task_id)?.title ?? r.task_id} members={members} onReview={setOpenId} />
          ))}
        </CardContent>
      </Card>
      <ApprovalDrawer teamId={teamId} recId={openId} onClose={() => setOpenId(null)} onSwitch={setOpenId} />
    </section>
  )
}
