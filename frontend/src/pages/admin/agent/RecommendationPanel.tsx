import { ArrowRight } from 'lucide-react'
import { ApprovalStatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtTime, isActionable } from '@/lib/status'
import { nameOf } from '@/lib/workload'
import type { Member, Recommendation, Task } from '@/types'

export function RecommendationCard({ rec, task, members, onReview }: { rec: Recommendation; task?: Task; members?: Member[]; onReview: (id: string) => void }) {
  return (
    <article aria-label={`Recommendation ${rec.recommendation_id}`} className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{rec.recommendation_id} · {fmtTime(rec.created_at)}</span>
        <ApprovalStatusBadge status={rec.status} />
      </div>
      {rec.type === 'risk_review' ? (
        <p className="font-medium">Formal risk review</p>
      ) : (<>
        <p className="font-medium">
          {task?.title ?? rec.task_id} <span className="font-mono text-xs text-muted-foreground">{rec.task_id}{task ? ` · ${task.priority} priority` : ''}</span>
        </p>
        <p className="flex items-center gap-2">
          {nameOf(members, rec.current_assignee_id)} <ArrowRight className="size-4 text-muted-foreground" aria-label="reassign to" /> <span className="text-primary">{nameOf(members, rec.proposed_assignee_id)}</span>
        </p>
      </>)}
      <p className="text-muted-foreground">{rec.rationale}</p>
      <p className="text-xs text-muted-foreground">{rec.evidence_ids.length} evidence records{rec.type === 'task_reassignment' ? ` · checks: capacity ${rec.capacity_check.replaceAll('_', ' ')}, dependencies ${rec.dependency_check.replaceAll('_', ' ')}` : ''}</p>
      <Button size="sm" variant={isActionable(rec.status) ? 'default' : 'outline'} onClick={() => onReview(rec.recommendation_id)}>
        {isActionable(rec.status) ? 'Review' : 'View'}
      </Button>
    </article>
  )
}

export default function RecommendationPanel({ recs, tasks, members, loading, onReview, panelRef }: {
  recs?: Recommendation[]; tasks?: Task[]; members?: Member[]; loading: boolean; onReview: (id: string) => void; panelRef: React.Ref<HTMLElement>
}) {
  // Newest actionable first; superseded proposals stay visible but sink to the bottom.
  const ordered = [...(recs ?? [])].sort((a, b) =>
    Number(a.status === 'superseded') - Number(b.status === 'superseded') || b.created_at.localeCompare(a.created_at))
  return (
    <section ref={panelRef} aria-label="Recommendations">
      <Card>
        <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <Skeleton className="h-32" /> : ordered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No action required.</p>
          ) : ordered.map((r) => (
            <RecommendationCard key={r.recommendation_id} rec={r} task={tasks?.find((t) => t.task_id === r.task_id)} members={members} onReview={onReview} />
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
