import { isLiveSession } from '@/api/live'
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useMembers, useRemind, useStandupStatus } from '@/api/hooks'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Tone } from '@/lib/status'
import { fmtTime } from '@/lib/status'
import { nameOf } from '@/lib/workload'
import type { ParticipationMember, ParticipationState } from '@/types'

const STATE: Record<ParticipationState, { label: (m: ParticipationMember) => string; tone: Tone }> = {
  submitted: { label: () => 'Submitted', tone: 'success' },
  missing: { label: () => 'No standup', tone: 'warning' },
  silent: { label: (m) => `Silent ${m.missed_days} days`, tone: 'warning' },
  unavailable: { label: () => 'Unavailable', tone: 'neutral' },
}
const shift = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10)

function activityLine(m: ParticipationMember) {
  if (m.state === 'submitted') return m.submitted_at ? `Submitted ${fmtTime(m.submitted_at)}` : 'Submitted'
  if (m.other_activity.length > 0) {
    const counts = m.other_activity.reduce<Record<string, number>>((a, e) => ({ ...a, [e.source_type]: (a[e.source_type] ?? 0) + 1 }), {})
    return `Other activity that day: ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')}`
  }
  return m.last_activity_at ? `No other activity that day. Last recorded: ${m.last_activity_at.slice(0, 10)}` : 'No other recorded activity yet'
}

export default function StandupParticipation({ teamId }: { teamId: string }) {
  const [date, setDate] = useState<string>()
  const { data, isPending, isError } = useStandupStatus(teamId, date)
  const { data: members } = useMembers(teamId)
  const remind = useRemind(teamId)
  const live = isLiveSession()

  if (isError) return <p role="alert" className="text-sm text-critical">Could not load standup participation.</p>

  const current = data?.date
  const open = data?.members.filter((m) => m.state === 'missing' || m.state === 'silent') ?? []
  const go = (n: number) => current && setDate(shift(current, n))

  return (
    <Card aria-label="Standup participation">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          Standup participation
          {data && <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{data.submitted} of {data.expected} submitted</span>}
        </CardTitle>
        <div className="flex items-center gap-1" role="group" aria-label="Choose day">
          <Button size="icon-sm" variant="outline" aria-label="Previous day" disabled={!data || data.date <= data.min_date} onClick={() => go(-1)}><ChevronLeft aria-hidden /></Button>
          <label className="sr-only" htmlFor="standup-date">Standup date</label>
          <input id="standup-date" type="date" value={current ?? ''} min={data?.min_date} max={data?.max_date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-7 rounded-lg border border-input bg-card px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />
          <Button size="icon-sm" variant="outline" aria-label="Next day" disabled={!data || data.date >= data.max_date} onClick={() => go(1)}><ChevronRight aria-hidden /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending || !data ? <Skeleton className="h-24" /> : (
          <>
            {live && <p role="note" className="text-xs text-muted-foreground">Computed from the live standups and evidence. Reminders are not connected to the backend yet.</p>}
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-live="polite">
              {data.members.map((m) => {
                const st = STATE[m.state]
                const canRemind = m.state === 'missing' || m.state === 'silent'
                return (
                  <li key={m.member_id} className="space-y-1.5 rounded-lg border border-border p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{nameOf(members, m.member_id)}</span>
                      <ToneBadge tone={st.tone}>{st.label(m)}</ToneBadge>
                    </div>
                    <p className="text-xs text-muted-foreground">{activityLine(m)}</p>
                    {canRemind && (
                      <Button size="xs" variant="outline" disabled={live || m.reminder_sent || remind.isPending} title={live ? 'Reminders are not available on the live backend yet' : undefined}
                        onClick={() => remind.mutate({ member_id: m.member_id, date: data.date })}>
                        <Bell aria-hidden /> {m.reminder_sent ? 'Reminder sent' : 'Send reminder'}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              {open.length > 0 ? `${open.length} to follow up. ` : 'Everyone expected has submitted. '}
              A missing standup alone does not mean someone is inactive: it gets a reminder and a question, never a conclusion.
              “Silent” means no standup for {2}+ days in a row and no other recorded activity in that time.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
