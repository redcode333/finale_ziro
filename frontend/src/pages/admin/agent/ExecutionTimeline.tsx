import { AlertTriangle, Check, ClipboardList, Cpu, Database, GitBranch, Search, ShieldAlert, Sparkles, XCircle, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { categoryLabel, eventState, fmtDuration, fmtTime } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { AgentEvent, EventCategory } from '@/types'

const ICONS: Record<EventCategory, LucideIcon> = {
  planning: Sparkles, retrieval: Database, analysis: Cpu, risk: AlertTriangle, decision: GitBranch,
  approval: ClipboardList, execution: Cpu, completion: Check, failure: XCircle,
}

export function TimelineEventRow({ event, onOpen }: { event: AgentEvent; onOpen: (e: AgentEvent) => void }) {
  const st = eventState(event.category, event.status)
  const Icon = ICONS[event.category] ?? ShieldAlert
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event)}
        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md', st.tone === 'success' && 'bg-success/15 text-success',
          st.tone === 'warning' && 'bg-warning/15 text-warning', st.tone === 'violet' && 'bg-primary/15 text-primary',
          st.tone === 'critical' && 'bg-critical/15 text-critical', st.tone === 'neutral' && 'bg-muted text-muted-foreground')}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{event.title}</span>
          <span className="block text-xs text-muted-foreground">
            {categoryLabel[event.category]}{event.tool ? ` · ${event.tool}` : ''} · {fmtTime(event.timestamp)}
            {event.duration_ms != null && ` · ${fmtDuration(event.duration_ms)}`}
          </span>
        </span>
        <ToneBadge tone={st.tone} pulse={st.pulse}>{st.label}</ToneBadge>
      </button>
    </li>
  )
}

export default function ExecutionTimeline({ events, loading, onOpen }: { events?: AgentEvent[]; loading: boolean; onOpen: (e: AgentEvent) => void }) {
  const [category, setCategory] = useState<EventCategory | 'all'>('all')
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (events ?? []).filter((e) =>
      (category === 'all' || e.category === category) &&
      (!needle || [e.title, e.id, e.run_id, e.tool ?? '', ...e.evidence_ids].some((s) => s.toLowerCase().includes(needle))))
  }, [events, category, q])

  const present = useMemo(() => [...new Set((events ?? []).map((e) => e.category))], [events])

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Activity timeline</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, IDs, tools" aria-label="Search activity" className="pl-8" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by category">
            {(['all', ...present] as const).map((c) => (
              <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
                className={cn('rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  category === c && 'bg-primary/15 text-primary')}>
                {c === 'all' ? 'All' : categoryLabel[c]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {events?.length ? 'No events match these filters.' : 'No activity yet for this run.'}
          </p>
        ) : (
          <ol aria-live="polite" className="space-y-0.5">
            {shown.map((e) => <TimelineEventRow key={e.id} event={e} onOpen={onOpen} />)}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
