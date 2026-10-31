import { useState } from 'react'
import { useApprovals, useAuditEvents, useMembers, useTasks } from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'
import { ApprovalStatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtTime, isInFlight } from '@/lib/status'
import { cn } from '@/lib/utils'
import { nameOf } from '@/lib/workload'
import type { ApprovalStatus } from '@/types'
import ApprovalDrawer from './agent/ApprovalDrawer'

const FILTERS: { key: string; label: string; match: (s: ApprovalStatus) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'pending', label: 'Pending review', match: (s) => s === 'pending_review' },
  { key: 'progress', label: 'In progress', match: isInFlight },
  { key: 'completed', label: 'Completed', match: (s) => s === 'completed' },
  { key: 'closed', label: 'Rejected / failed / other', match: (s) => ['rejected', 'failed', 'expired', 'superseded'].includes(s) },
]

export default function Approvals() {
  const { me } = useAuth()
  const teamId = me?.memberships.find((m) => m.role === 'ADMIN')?.team_id ?? ''
  const { data: approvals, isPending } = useApprovals(teamId)
  const { data: members } = useMembers(teamId)
  const { data: tasks } = useTasks(teamId)
  const { data: audit } = useAuditEvents()
  const [filter, setFilter] = useState('pending')
  const [openId, setOpenId] = useState<string | null>(null)

  const active = FILTERS.find((f) => f.key === filter)!
  const rows = (approvals ?? []).filter((a) => active.match(a.status)).sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">Review, modify, approve or reject AI proposals. Nothing changes before a decision.</p>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter approvals">
        {FILTERS.map((f) => {
          const n = (approvals ?? []).filter((a) => f.match(a.status)).length
          return (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={cn('rounded-full px-3 py-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                filter === f.key && 'bg-primary/15 text-primary')}>
              {f.label} <span className="font-mono text-xs">{n}</span>
            </button>
          )
        })}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {isPending ? <Skeleton className="m-4 h-24" /> : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No approvals in this view.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>{['Proposal', 'Task', 'Change', 'Status', 'Created', ''].map((h) => <th key={h} scope="col" className="px-4 py-2 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.approval_id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono text-xs">{a.approval_id}</td>
                    <td className="px-4 py-2">{tasks?.find((t) => t.task_id === a.task_id)?.title ?? a.task_id} <span className="font-mono text-xs text-muted-foreground">{a.task_id}</span></td>
                    <td className="px-4 py-2">{nameOf(members, a.current_assignee_id)} → {nameOf(members, a.proposed_assignee_id)}</td>
                    <td className="px-4 py-2"><ApprovalStatusBadge status={a.status} /></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{fmtTime(a.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => setOpenId(a.approval_id)} className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        {a.status === 'pending_review' ? 'Review' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Audit log</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {(audit ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No audit events.</p> : audit!.map((a) => (
            <p key={a.audit_event_id} className="text-xs">
              <span className="font-mono">{a.audit_event_id}</span> · {a.action.replaceAll('_', ' ')} · <span className="font-mono">{a.target_id}</span> · by <span className="font-mono">{a.actor_id}</span> · {fmtTime(a.created_at)}
              {a.reason && <span className="text-muted-foreground"> — {a.reason}</span>}
            </p>
          ))}
        </CardContent>
      </Card>

      <ApprovalDrawer teamId={teamId} recId={openId} onClose={() => setOpenId(null)} onSwitch={setOpenId} />
    </section>
  )
}
