import { Pause, Play, RotateCcw, Square } from 'lucide-react'
import { isLiveSession } from '@/api/live'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { runStatusMeta } from '@/lib/status'
import type { AgentRun, Sprint } from '@/types'

interface Props {
  sprints: Sprint[]
  sprintId: string
  onSprintChange: (id: string) => void
  run?: AgentRun
  busy: boolean
  onControl: (a: 'pause' | 'resume' | 'stop' | 'retry') => void
}

export default function AgentHeader({ sprints, sprintId, onSprintChange, run, busy, onControl }: Props) {
  const status = run?.status ?? 'idle'
  const meta = runStatusMeta[status]
  const active = status === 'running' || status === 'queued'
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI Agent Center</h1>
        <p className="text-sm text-muted-foreground">CampusConnect · the agent proposes, you decide, the system executes.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="sprint-select">Sprint</label>
        <select
          id="sprint-select"
          value={sprintId}
          onChange={(e) => onSprintChange(e.target.value)}
          className="h-8 rounded-lg border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {sprints.map((s) => <option key={s.sprint_id} value={s.sprint_id}>{s.name}</option>)}
        </select>
        <ToneBadge tone={meta.tone} pulse={active}>{meta.label}</ToneBadge>
        {run && !isLiveSession() && (
          <div className="flex gap-1" role="group" aria-label="Run controls">
            {active && <Button size="sm" variant="outline" disabled={busy} onClick={() => onControl('pause')}><Pause aria-hidden /> Pause</Button>}
            {status === 'paused' && <Button size="sm" variant="outline" disabled={busy} onClick={() => onControl('resume')}><Play aria-hidden /> Resume</Button>}
            {(active || status === 'paused') && <Button size="sm" variant="outline" disabled={busy} onClick={() => onControl('stop')}><Square aria-hidden /> Stop</Button>}
            {status === 'failed' && <Button size="sm" variant="outline" disabled={busy} onClick={() => onControl('retry')}><RotateCcw aria-hidden /> Retry</Button>}
          </div>
        )}
      </div>
    </header>
  )
}
