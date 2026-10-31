import { ExternalLink } from 'lucide-react'
import { useMyEvidence } from '@/api/hooks'
import { useMyContext } from '@/auth/useMyContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtTime } from '@/lib/status'

// Shows linked evidence and its gaps. Deliberately no score, rank or performance judgment.
export default function MyContributions() {
  const { teamId, memberId } = useMyContext()
  const { data: evidence, isPending } = useMyEvidence(teamId, memberId)

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My contributions</h1>
        <p className="text-sm text-muted-foreground">Work linked to you from tasks, pull requests, reviews, worklogs and docs.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Linked evidence</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isPending ? <Skeleton className="h-24" /> : (evidence ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked evidence found yet. That does not mean no work was done.</p>
          ) : evidence!.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
              <span>
                <span className="font-mono text-xs">{e.id}</span> <span className="text-xs text-muted-foreground">{e.source_type.replace('_', ' ')}{e.task_id ? ` · ${e.task_id}` : ''} · {fmtTime(e.observed_at)}</span>
                <span className="block">{e.title}</span>
              </span>
              {e.source_url && (
                <a href={e.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Open source for ${e.id}`} className="mt-0.5 shrink-0 text-primary"><ExternalLink className="size-3.5" /></a>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground">
          Design, testing, research, documentation, reviews and meetings count as work even when they leave no commits.
          If something is missing, link it in your standup or ask your mentor to add it.
        </CardContent>
      </Card>
    </section>
  )
}
