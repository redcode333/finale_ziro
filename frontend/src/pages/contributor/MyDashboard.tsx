import { Link } from 'react-router-dom'
import { useBlockers, useSprints, useStandups, useTasks } from '@/api/hooks'
import { useMyContext } from '@/auth/useMyContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskStatusBadge } from './TaskStatusBadge'

const today = () => new Date().toISOString().slice(0, 10)

export default function MyDashboard() {
  const { me, teamId, memberId } = useMyContext()
  const { data: tasks, isPending } = useTasks(teamId)
  const { data: sprints } = useSprints(teamId)
  const { data: blockers } = useBlockers(teamId)
  const { data: standups } = useStandups(teamId)

  const mine = tasks ?? []
  const open = mine.filter((t) => t.status !== 'done')
  const dueToday = open.filter((t) => t.due_date === today())
  const overdue = open.filter((t) => t.due_date < today())
  const myBlockers = (blockers ?? []).filter((b) => b.status === 'open')
  const done = mine.filter((t) => t.status === 'done').length
  const sprint = sprints?.find((s) => s.status === 'active')
  const submittedToday = (standups ?? []).some((s) => s.member_id === memberId && s.date === today())

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Hello, {me?.name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground">{sprint ? `${sprint.name} · ends ${sprint.end_date}` : 'No active sprint'}</p>
        </div>
        <Link to="/contributor/standup" className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {submittedToday ? 'Standup submitted today' : 'Add today’s standup'}
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[['Due today', dueToday.length], ['Overdue', overdue.length], ['Open blockers', myBlockers.length]].map(([l, v]) => (
          <Card key={l}><CardHeader><CardTitle className="text-xs font-normal text-muted-foreground">{l}</CardTitle></CardHeader>
            <CardContent className="font-mono text-2xl">{isPending ? '…' : v}</CardContent></Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader><CardTitle>My tasks</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {isPending ? <Skeleton className="h-24" /> : open.length === 0 ? <p className="text-sm text-muted-foreground">Nothing open. Nice work.</p> : open.map((t) => (
              <div key={t.task_id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
                <span><span className="font-mono text-xs text-muted-foreground">{t.task_id}</span> {t.title}<span className="block text-xs text-muted-foreground">due {t.due_date}</span></span>
                <TaskStatusBadge status={t.status} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>My sprint progress</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Progress value={mine.length ? Math.round((done / mine.length) * 100) : 0} aria-label="My task completion" />
            <p>{done} of {mine.length} tasks done</p>
            {sprint && <p className="text-xs text-muted-foreground">Goal: {sprint.goal}</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
