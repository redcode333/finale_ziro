import { useEffect, useState } from 'react'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { RUN_STAGES, runStatusMeta } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { AgentRun } from '@/types'

const TERMINAL = ['completed', 'failed', 'cancelled', 'awaiting_approval', 'paused']

function useElapsed(run?: AgentRun) {
  const [now, setNow] = useState(Date.now())
  const live = !!run && !TERMINAL.includes(run.status)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  if (!run) return '—'
  const end = run.completed_at ? new Date(run.completed_at).getTime() : live ? now : now
  const s = Math.max(0, Math.floor((end - new Date(run.started_at).getTime()) / 1000))
  // Seeded history runs started days ago; show elapsed only while the run is live.
  return live || run.completed_at ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '—'
}

export default function CurrentExecutionCard({ run }: { run?: AgentRun }) {
  const elapsed = useElapsed(run)
  if (!run) {
    return (
      <Card>
        <CardHeader><CardTitle>Current execution</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">No run yet. Start an analysis from the command bar below.</CardContent>
      </Card>
    )
  }
  const idx = RUN_STAGES.findIndex((s) => s.key === run.stage)
  const meta = runStatusMeta[run.status]
  const pct = run.status === 'completed' ? 100 : Math.round(((idx + (run.status === 'awaiting_approval' ? 1 : 0.5)) / RUN_STAGES.length) * 100)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          Current execution <span className="font-mono text-xs font-normal text-muted-foreground">{run.run_id}</span>
        </CardTitle>
        <ToneBadge tone={meta.tone} pulse={run.status === 'running'}>{meta.label}</ToneBadge>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={pct} aria-label="Run progress" />
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Run stages">
          {RUN_STAGES.map((s, i) => (
            <li key={s.key} aria-current={i === idx ? 'step' : undefined}
              className={cn('text-muted-foreground', i < idx && 'text-success', i === idx && 'font-medium text-foreground')}>
              {s.label}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          Elapsed <span className="font-mono text-foreground">{elapsed}</span> · started by <span className="font-mono">{run.initiated_by}</span>
        </p>
      </CardContent>
    </Card>
  )
}
