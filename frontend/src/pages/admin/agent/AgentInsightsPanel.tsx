import { Link } from 'react-router-dom'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtTime, runStatusMeta } from '@/lib/status'
import { nameOf } from '@/lib/workload'
import type { Dashboard, Member } from '@/types'

interface Props {
  dashboard?: Dashboard
  members?: Member[]
  onReview: () => void
  risksRef: React.Ref<HTMLElement>
}

const riskTone = (l: string) => (l === 'high' || l === 'critical' ? 'critical' : l === 'none' ? 'success' : 'warning')

export default function AgentInsightsPanel({ dashboard, members, onReview, risksRef }: Props) {
  const state = dashboard?.agent_status.state ?? 'idle'
  const meta = runStatusMeta[state]
  return (
    <aside aria-label="Agent insights" className="space-y-3">
      <Card>
        <CardHeader><CardTitle>Agent health</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">State</span>
            <ToneBadge tone={meta.tone} pulse={state === 'running'}>{meta.label}</ToneBadge>
          </div>
          <p className="text-xs text-muted-foreground">
            Last heartbeat {dashboard?.agent_status.last_heartbeat ? fmtTime(dashboard.agent_status.last_heartbeat) : '—'}
          </p>
        </CardContent>
      </Card>

      <section ref={risksRef} aria-label="Risks">
        <Card>
          <CardHeader><CardTitle>Risks</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!dashboard ? null : dashboard.risks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active risks.</p>
            ) : dashboard.risks.map((r) => (
              <div key={r.assessment_id} className="space-y-1 rounded-lg border border-border p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{nameOf(members, r.member_id)}</span>
                  <ToneBadge tone={riskTone(r.risk_level)}>{r.risk_level.replace('_', ' ')}</ToneBadge>
                </div>
                <p className="text-muted-foreground">{r.summary}</p>
                {r.missing_context && <p className="text-xs text-muted-foreground">Missing context: {r.missing_context}</p>}
                <p className="text-xs">{r.recommended_action}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.assessment_id} · evidence {r.evidence_ids.join(', ')}</p>
                <Link to={`/admin/evidence?member=${r.member_id}`} className="inline-block text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  Compare claims with evidence →
                </Link>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Evidence gaps are not findings of misconduct. Low GitHub activity does not mean low contribution.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader><CardTitle>Pending approvals</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span className="font-mono text-2xl">{dashboard?.pending_approvals ?? '—'}</span>
          <button type="button" onClick={onReview} className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Go to recommendations
          </button>
        </CardContent>
      </Card>
    </aside>
  )
}
