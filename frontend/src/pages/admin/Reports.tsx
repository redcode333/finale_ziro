import { useWeeklyReport } from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'
import { ApprovalStatusBadge, ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtTime } from '@/lib/status'
import { nameOf } from '@/lib/workload'

export default function Reports() {
  const { me } = useAuth()
  const teamId = me?.memberships.find((m) => m.role === 'ADMIN')?.team_id ?? ''
  const { data: r, isPending, isError } = useWeeklyReport(teamId)

  if (isError) return <p role="alert" className="text-critical">Could not load the weekly report.</p>
  if (isPending || !r) return <Skeleton className="h-64" />

  const members = r.contributions.map((c) => ({ member_id: c.member_id, name: c.name })) as never
  const pct = Math.round((r.progress.done / Math.max(1, r.progress.total)) * 100)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Weekly mentor report</h1>
          <p className="text-sm text-muted-foreground">{r.sprint.name} · generated {fmtTime(r.generated_at)} from persisted records</p>
        </div>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none print:hidden">
          Print / save as PDF
        </button>
      </div>

      <Card>
        <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="font-mono text-2xl">{pct}%</span> of tasks done ({r.progress.done} of {r.progress.total})</p>
          <p className="text-muted-foreground">
            In progress {r.progress.in_progress} · Blocked {r.progress.blocked} · To do {r.progress.todo}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Blockers</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {r.blockers.length === 0 ? <p className="text-muted-foreground">No blocked tasks.</p> : r.blockers.map((b) => (
            <p key={b.task_id}>
              <span className="font-mono text-xs">{b.task_id}</span> {b.title} · {nameOf(members, b.assignee_id)}
              {b.dependency_task_ids.length > 0 && <span className="text-muted-foreground"> · depends on {b.dependency_task_ids.join(', ')}</span>}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Evidence discrepancies</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {r.discrepancies.length === 0 ? <p className="text-muted-foreground">None.</p> : r.discrepancies.map((d) => (
            <div key={d.assessment_id} className="space-y-1 rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{nameOf(members, d.member_id)}</span>
                <ToneBadge tone="warning">{d.status.replaceAll('_', ' ')}</ToneBadge>
              </div>
              <p>{d.summary}</p>
              <p className="text-xs text-muted-foreground">{d.recommended_action}</p>
              <p className="font-mono text-xs text-muted-foreground">Evidence: {d.evidence_ids.join(', ')}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">A discrepancy is a request for clarification, not a finding about the person.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contribution evidence</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>{['Member', 'Evidence records', 'Hours logged', 'Tasks done'].map((h) => <th key={h} scope="col" className="px-4 py-2 font-normal">{h}</th>)}</tr>
            </thead>
            <tbody>
              {r.contributions.map((c) => (
                <tr key={c.member_id} className="border-t border-border align-top">
                  <td className="px-4 py-2">{c.name}<span className="block text-xs text-muted-foreground">{c.note}</span></td>
                  <td className="px-4 py-2 text-xs">{Object.entries(c.evidence_by_type).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') || '—'}</td>
                  <td className="px-4 py-2 font-mono">{c.hours_logged}</td>
                  <td className="px-4 py-2 font-mono">{c.tasks_done}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {r.recommendations.map((x) => (
            <div key={x.recommendation_id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{x.recommendation_id}</span> <span className="font-mono text-xs">{x.task_id}</span>
              <ApprovalStatusBadge status={x.status} /> <span className="text-muted-foreground">{x.summary}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
