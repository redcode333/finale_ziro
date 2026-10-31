import { useState } from 'react'
import { useBlockers, useRaiseBlocker, useResolveBlocker, useTasks } from '@/api/hooks'
import { useMyContext } from '@/auth/useMyContext'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { fmtTime } from '@/lib/status'

export default function Blockers() {
  const { teamId } = useMyContext()
  const { data: tasks } = useTasks(teamId)
  const { data: blockers } = useBlockers(teamId)
  const raise = useRaiseBlocker()
  const resolve = useResolveBlocker()
  const [taskId, setTaskId] = useState('')
  const [text, setText] = useState('')

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || raise.isPending) return
    raise.mutate({ task_id: taskId || null, description: text.trim() }, { onSuccess: () => { setText(''); setTaskId('') } })
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Blockers</h1>
        <p className="text-sm text-muted-foreground">Raise what is in your way. Your mentor sees open blockers when planning.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Raise a blocker</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="bl-task" className="text-sm">Related task (optional)</label>
              <select id="bl-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={raise.isPending}
                className="block h-8 w-full rounded-lg border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <option value="">None</option>
                {(tasks ?? []).map((t) => <option key={t.task_id} value={t.task_id}>{t.task_id} · {t.title}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="bl-desc" className="text-sm">What is blocking you?</label>
              <Textarea id="bl-desc" value={text} onChange={(e) => setText(e.target.value)} disabled={raise.isPending} />
            </div>
            <Button type="submit" disabled={!text.trim() || raise.isPending}>{raise.isPending ? 'Raising…' : 'Raise blocker'}</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>My blockers</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(blockers ?? []).length === 0 ? <p className="text-muted-foreground">No blockers.</p> : blockers!.map((b) => (
            <div key={b.blocker_id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5">
              <div>
                <p><span className="font-mono text-xs text-muted-foreground">{b.blocker_id}{b.task_id ? ` · ${b.task_id}` : ''}</span> {b.description}</p>
                <p className="text-xs text-muted-foreground">Raised {fmtTime(b.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ToneBadge tone={b.status === 'open' ? 'warning' : 'success'}>{b.status === 'open' ? 'Open' : 'Resolved'}</ToneBadge>
                {b.status === 'open' && <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate(b.blocker_id)}>Resolve</Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
