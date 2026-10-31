import { ExternalLink } from 'lucide-react'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { categoryLabel, eventState, fmtDuration, fmtTime } from '@/lib/status'
import type { AgentEvent, EvidenceRecord } from '@/types'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

export default function EventDetailDrawer({ event, evidence, onClose }: { event: AgentEvent | null; evidence: EvidenceRecord[]; onClose: () => void }) {
  const st = event ? eventState(event.category, event.status) : null
  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {event && st && (
          <>
            <SheetHeader>
              <SheetTitle>{event.title}</SheetTitle>
              <SheetDescription>{categoryLabel[event.category]} event</SheetDescription>
            </SheetHeader>
            <dl className="space-y-3 px-4 pb-4">
              <Row label="Status"><ToneBadge tone={st.tone} pulse={st.pulse}>{st.label}</ToneBadge></Row>
              <Row label="Timestamp">{fmtTime(event.timestamp)}</Row>
              <Row label="Execution ID"><span className="font-mono">{event.run_id}</span></Row>
              <Row label="Event ID"><span className="font-mono">{event.id}</span></Row>
              <Row label="Parent event"><span className="font-mono">{event.parent_event_id ?? '—'}</span></Row>
              <Row label="Tool">{event.tool ? <span className="font-mono">{event.tool}</span> : 'None (model or rule step)'}</Row>
              <Row label="Input">{event.input_summary ?? '—'}</Row>
              <Row label="Output">{event.output_summary ?? '—'}</Row>
              <Row label="Duration">{fmtDuration(event.duration_ms)}</Row>
              <Row label="Retries">{event.retries}</Row>
              <Row label="Error">{event.error ? <span className="text-critical">{event.error}</span> : 'None'}</Row>
              <Row label="Evidence">
                {event.evidence_ids.length === 0 ? '—' : (
                  <ul className="space-y-1">
                    {event.evidence_ids.map((id) => {
                      const ev = evidence.find((e) => e.id === id)
                      return (
                        <li key={id} className="flex items-center gap-1">
                          <span className="font-mono">{id}</span>
                          {ev && <span className="truncate text-muted-foreground">{ev.title}</span>}
                          {ev?.source_url && (
                            <a href={ev.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Open source for ${id}`} className="text-primary">
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Row>
            </dl>
            <p className="px-4 pb-4 text-xs text-muted-foreground">Operational trace only. Secrets and model reasoning are never shown.</p>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
