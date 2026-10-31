import { ArrowRight, ExternalLink } from 'lucide-react'
import { ToneBadge } from '@/components/common/StatusBadge'
import { fmtTime } from '@/lib/status'
import { workloadOf } from '@/lib/workload'
import { cn } from '@/lib/utils'
import type { AuditEvent, EvidenceRecord, Member, Task } from '@/types'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2)

export function TaskSummary({ task }: { task?: Task }) {
  if (!task) return <p className="text-sm text-muted-foreground">Task details unavailable.</p>
  const rows: [string, string][] = [
    ['Task', task.task_id], ['Sprint', task.sprint_id], ['Project', task.project_id],
    ['Priority', task.priority], ['Status', task.status.replace('_', ' ')], ['Due', task.due_date],
  ]
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">{task.title}</p>
      <dl className="grid grid-cols-3 gap-2">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}

function OwnerColumn({ label, member, tasks, edited }: { label: string; member?: Member; tasks: Task[]; edited?: boolean }) {
  const w = workloadOf(member, tasks)
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {edited && <ToneBadge tone="violet">Manager-edited</ToneBadge>}
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs text-primary">{member ? initials(member.name) : '?'}</span>
        <div>
          <p className="font-medium">{member?.name ?? 'Unknown'}</p>
          <p className="text-xs text-muted-foreground">{member?.role}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{member?.skills.join(', ')}</p>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        <dt className="text-muted-foreground">Active tasks</dt><dd className="font-mono">{w.active}</dd>
        <dt className="text-muted-foreground">Blocked</dt><dd className="font-mono">{w.blocked}</dd>
        <dt className="text-muted-foreground">Capacity</dt>
        <dd className={cn('font-mono', w.remaining < 0 && 'text-warning')}>{w.openHours}h open / {w.capacity}h week</dd>
        <dt className="text-muted-foreground">Availability</dt><dd>{member?.availability_status.replaceAll('_', ' ')}</dd>
      </dl>
    </div>
  )
}

export function AssignmentComparison({ current, proposed, tasks, edited }: { current?: Member; proposed?: Member; tasks: Task[]; edited: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <OwnerColumn label="Current owner" member={current} tasks={tasks} />
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
      <OwnerColumn label={edited ? 'New owner' : 'AI-proposed owner'} member={proposed} tasks={tasks} edited={edited} />
    </div>
  )
}

export function AssigneeSelector({ candidates, tasks, selected, aiProposed, disabled, onSelect }: {
  candidates: Member[]; tasks: Task[]; selected: string; aiProposed: string; disabled: boolean; onSelect: (id: string) => void
}) {
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="sr-only">Choose the new assignee</legend>
      {candidates.map((m) => {
        const w = workloadOf(m, tasks)
        const off = m.availability_status !== 'available'
        return (
          <label key={m.member_id} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm transition-colors duration-150',
            selected === m.member_id && 'border-primary bg-primary/10', (off || disabled) && 'cursor-not-allowed opacity-60')}>
            <input type="radio" name="assignee" className="mt-1 accent-[#8b5cf6]" checked={selected === m.member_id} disabled={off} onChange={() => onSelect(m.member_id)} />
            <span className="flex-1">
              <span className="flex items-center gap-2 font-medium">
                {m.name}
                {m.member_id === aiProposed && <ToneBadge tone="violet">AI-proposed</ToneBadge>}
                {off && <ToneBadge tone="neutral">Unavailable</ToneBadge>}
              </span>
              <span className="block text-xs text-muted-foreground">{m.role} · {m.skills.join(', ')}</span>
              <span className="block font-mono text-xs text-muted-foreground">{w.active} active · {w.blocked} blocked · {w.openHours}/{w.capacity}h</span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

export function EvidenceList({ items }: { items?: EvidenceRecord[] }) {
  if (!items) return <p className="text-sm text-muted-foreground">Loading evidence…</p>
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Insufficient evidence. That does not mean no work was done.</p>
  return (
    <ul className="space-y-1.5">
      {items.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2 text-sm">
          <span className="min-w-0">
            <span className="font-mono text-xs">{e.id}</span> <span className="text-xs text-muted-foreground">{e.source_type.replace('_', ' ')} · {fmtTime(e.observed_at)}</span>
            <span className="block truncate">{e.title}</span>
          </span>
          {e.source_url && (
            <a href={e.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Open source for ${e.id}`} className="mt-0.5 shrink-0 text-primary">
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

export function AuditTrail({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
  return (
    <ol className="space-y-1.5">
      {events.map((a) => (
        <li key={a.audit_event_id} className="rounded-lg border border-border p-2 text-xs">
          <span className="font-mono">{a.audit_event_id}</span> · {a.action.replaceAll('_', ' ')} · by <span className="font-mono">{a.actor_id}</span> · {fmtTime(a.created_at)}
          {a.reason && <span className="block text-muted-foreground">{a.reason}</span>}
        </li>
      ))}
    </ol>
  )
}
