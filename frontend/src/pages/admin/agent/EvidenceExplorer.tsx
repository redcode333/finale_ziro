import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { fmtTime } from '@/lib/status'
import { nameOf } from '@/lib/workload'
import type { EvidenceRecord, Member } from '@/types'

const LABEL: Record<EvidenceRecord['source_type'], string> = {
  commit: 'Commit', pull_request: 'Pull request', review: 'Review', issue: 'Issue', worklog: 'Worklog', standup: 'Standup', task: 'Task',
}

// P1 evidence explorer: browse the source records the agent used. Verification states live on the risk cards.
export default function EvidenceExplorer({ open, onClose, evidence, members, initialQuery = '' }: { open: boolean; onClose: () => void; evidence?: EvidenceRecord[]; members?: Member[]; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery)
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (evidence ?? []).filter((e) => !n || [e.id, e.title, e.task_id ?? '', nameOf(members, e.member_id)].some((s) => s.toLowerCase().includes(n)))
  }, [evidence, members, q])
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Evidence explorer</SheetTitle>
          <SheetDescription>{evidence?.length ?? 0} source records. Synthetic demo data; links are placeholders.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-4">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, task, member or text" aria-label="Search evidence" />
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No evidence found. That is not evidence of no work.</p>}
          <ul className="space-y-2">
            {shown.map((e) => (
              <li key={e.id} className="rounded-lg border border-border p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{e.id} · {LABEL[e.source_type]}</span>
                  {e.source_url && (
                    <a href={e.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Open source for ${e.id}`} className="text-primary">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <p>{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {nameOf(members, e.member_id)}{e.task_id ? ` · ${e.task_id}` : ''} · {fmtTime(e.observed_at)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}
