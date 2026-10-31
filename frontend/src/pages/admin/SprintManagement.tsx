import { Link2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMembers, useSprints, useTasks } from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'
import CapacityBar from '@/components/common/CapacityBar'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { workloadOf } from '@/lib/workload'
import type { Task } from '@/types'
import ReplanPanel from './replan/ReplanPanel'

const COLUMNS: { key: string; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
]
const PRIORITY_TONE = { high: 'critical', medium: 'warning', low: 'neutral' } as const

function TaskCard({ task, owner, byId }: { task: Task; owner: string; byId: Map<string, Task> }) {
  const unmet = task.dependency_task_ids.filter((d) => byId.get(d)?.status !== 'done')
  return (
    <li className="space-y-1 rounded-lg border border-border bg-card p-2.5 text-sm">
      <p><span className="font-mono text-xs text-muted-foreground">{task.task_id}</span> {task.title}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ToneBadge tone={PRIORITY_TONE[task.priority as keyof typeof PRIORITY_TONE] ?? 'neutral'}>{task.priority}</ToneBadge>
        <span>{owner}</span><span>·</span><span className="font-mono">{task.estimate_hours}h</span><span>·</span><span>due {task.due_date}</span>
      </div>
      {task.dependency_task_ids.length > 0 && (
        <p className={unmet.length && task.status !== 'done' ? 'flex items-center gap-1 text-xs text-warning' : 'flex items-center gap-1 text-xs text-muted-foreground'}>
          <Link2 className="size-3" aria-hidden />
          {!unmet.length ? `Depends on ${task.dependency_task_ids.join(', ')} (done)`
            : task.status === 'done' ? `Depends on ${unmet.join(', ')} (not yet done)` : `Waiting on ${unmet.join(', ')}`}
        </p>
      )}
    </li>
  )
}

export default function SprintManagement() {
  const { me } = useAuth()
  const teamId = me?.memberships.find((m) => m.role === 'ADMIN')?.team_id ?? ''
  const { data: sprints, isPending } = useSprints(teamId)
  const { data: tasks } = useTasks(teamId)
  const { data: members } = useMembers(teamId)
  const [picked, setPicked] = useState<string>()

  if (isPending || !sprints) return <Skeleton className="h-64" />
  const sprint = sprints.find((s) => s.sprint_id === picked) ?? sprints.find((s) => s.status === 'active') ?? sprints[0]
  const all = tasks ?? []
  const inSprint = all.filter((t) => t.sprint_id === sprint.sprint_id)
  const byId = new Map(all.map((t) => [t.task_id, t]))
  const nameOf = (id: string) => members?.find((m) => m.member_id === id)?.name ?? id

  const plannedHours = inSprint.reduce((s, t) => s + t.estimate_hours, 0)
  const doneHours = inSprint.filter((t) => t.status === 'done').reduce((s, t) => s + t.estimate_hours, 0)
  const donePct = plannedHours ? Math.round((doneHours / plannedHours) * 100) : 0
  const overdue = inSprint.filter((t) => t.status !== 'done' && t.due_date < new Date().toISOString().slice(0, 10)).length

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sprint management</h1>
          <p className="text-sm text-muted-foreground">{sprint.start_date} → {sprint.end_date}</p>
        </div>
        <div>
          <label htmlFor="sprint-pick" className="sr-only">Sprint</label>
          <select id="sprint-pick" value={sprint.sprint_id} onChange={(e) => setPicked(e.target.value)}
            className="h-8 rounded-lg border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {sprints.map((s) => <option key={s.sprint_id} value={s.sprint_id}>{s.name} ({s.status})</option>)}
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-[1fr_auto] ">
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Goal:</span> {sprint.goal}</p>
            <Progress value={donePct} aria-label="Sprint completion by estimated hours" />
            <p className="text-xs text-muted-foreground">{doneHours}h of {plannedHours}h planned work done ({donePct}%)</p>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            {[['Tasks', inSprint.length], ['Overdue', overdue], ['Capacity', `${sprint.capacity_hours}h`]].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-mono text-xl">{v}</dd></div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {inSprint.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks planned for this sprint yet.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((c) => {
            const col = inSprint.filter((t) => t.status === c.key)
            return (
              <section key={c.key} aria-label={c.label} className="space-y-2">
                <h2 className="flex items-center justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {c.label} <span className="font-mono">{col.length}</span>
                </h2>
                <ul className="space-y-2">
                  {col.map((t) => <TaskCard key={t.task_id} task={t} owner={nameOf(t.assignee_id)} byId={byId} />)}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      <ReplanPanel teamId={teamId} sprintId={sprint.sprint_id} />

      <Card>
        <CardHeader><CardTitle>Workload distribution</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {(members ?? []).map((m) => {
            const mine = inSprint.filter((t) => t.assignee_id === m.member_id && t.status !== 'done')
            const w = workloadOf(m, mine)
            return (
              <div key={m.member_id} className="space-y-1">
                <p className="text-sm">{m.name} <span className="text-xs text-muted-foreground">{w.active} open · {w.blocked} blocked</span></p>
                <CapacityBar used={w.openHours} capacity={w.capacity} label={`Open work for ${m.name}`} />
              </div>
            )
          })}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Task owners change only through an approved proposal, so every reassignment is reviewed and audited.{' '}
        <Link to="/admin/approvals" className="text-primary hover:underline">Open approvals</Link>
      </p>
    </section>
  )
}
