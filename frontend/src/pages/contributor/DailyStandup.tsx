import { useState } from 'react'
import { useStandups, useSubmitStandup, useTasks } from '@/api/hooks'
import { useMyContext } from '@/auth/useMyContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

export default function DailyStandup() {
  const { teamId, memberId } = useMyContext()
  const { data: tasks } = useTasks(teamId)
  const { data: standups } = useStandups(teamId)
  const submit = useSubmitStandup()

  const [yesterday, setYesterday] = useState('')
  const [today, setToday] = useState('')
  const [blockers, setBlockers] = useState('')
  const [claimed, setClaimed] = useState<string[]>([])

  const toggle = (id: string) => setClaimed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const valid = yesterday.trim() && today.trim()
  const mine = (standups ?? []).filter((s) => s.member_id === memberId)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || submit.isPending) return
    submit.mutate({ yesterday, today, blockers, claimed_task_ids: claimed }, {
      onSuccess: () => { setYesterday(''); setToday(''); setBlockers(''); setClaimed([]) },
    })
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Daily standup</h1>
        <p className="text-sm text-muted-foreground">Claims you link to a task are compared with available evidence. A gap asks for clarification; it is not an accusation.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Today’s update</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            {([['Yesterday', yesterday, setYesterday, 'su-y'], ['Today', today, setToday, 'su-t'], ['Blockers (optional)', blockers, setBlockers, 'su-b']] as const).map(([label, value, set, id]) => (
              <div key={id} className="space-y-1">
                <label htmlFor={id} className="text-sm">{label}</label>
                <Textarea id={id} value={value} onChange={(e) => set(e.target.value)} disabled={submit.isPending} />
              </div>
            ))}
            <fieldset className="space-y-1" disabled={submit.isPending}>
              <legend className="text-sm">Tasks you worked on or completed</legend>
              <div className="flex flex-wrap gap-2">
                {(tasks ?? []).map((t) => (
                  <label key={t.task_id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs">
                    <input type="checkbox" className="accent-[#8b5cf6]" checked={claimed.includes(t.task_id)} onChange={() => toggle(t.task_id)} />
                    <span className="font-mono">{t.task_id}</span> {t.title}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={!valid || submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit standup'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>My recent standups</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {mine.length === 0 ? <p className="text-muted-foreground">No standups yet.</p> : mine.map((s) => (
            <div key={s.standup_id} className="rounded-lg border border-border p-2.5">
              <p className="font-mono text-xs text-muted-foreground">{s.standup_id} · {s.date} · claims {s.claimed_task_ids.join(', ') || 'none'}</p>
              <p><span className="text-muted-foreground">Yesterday:</span> {s.yesterday}</p>
              <p><span className="text-muted-foreground">Today:</span> {s.today}</p>
              <p><span className="text-muted-foreground">Blockers:</span> {s.blockers}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
