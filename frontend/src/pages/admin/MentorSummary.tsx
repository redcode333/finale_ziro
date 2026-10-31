import { Copy, Download, FileText, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/api/client'
import { isLiveSession } from '@/api/live'
import { fmtTime } from '@/lib/status'
import { reportToMarkdown } from '@/lib/reportMarkdown'
import type { WeeklyReport } from '@/types'

interface Props {
  report: WeeklyReport
  generating: boolean
  error: unknown
  onGenerate: () => void
  onCite: (ref: string) => void
}

const isEvidenceId = (r: string) => /^(GH|W|SU)\d+/.test(r)

export default function MentorSummary({ report, generating, error, onGenerate, onCite }: Props) {
  const s = report.summary
  const md = () => reportToMarkdown(report)

  const copy = async () => {
    try { await navigator.clipboard.writeText(md()); toast.success('Report copied as Markdown') }
    catch { toast.error('Could not copy. Use Download instead.') }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: 'text/markdown' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `weekly-report-${report.sprint.sprint_id}.md` })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><FileText className="size-4" aria-hidden /> Mentor summary</CardTitle>
        <div className="flex flex-wrap gap-1.5 print:hidden">
          <Button size="sm" disabled={generating} onClick={onGenerate}>
            <RefreshCw className={generating ? 'animate-spin' : ''} aria-hidden /> {generating ? (isLiveSession() ? 'Refreshing…' : 'Writing…') : isLiveSession() ? 'Refresh report' : s ? 'Regenerate' : 'Generate report'}
          </Button>
          <Button size="sm" variant="outline" onClick={copy}><Copy aria-hidden /> Copy Markdown</Button>
          <Button size="sm" variant="outline" onClick={download}><Download aria-hidden /> Download</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer aria-hidden /> Print</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm" aria-live="polite" aria-busy={generating}>
        {error != null && !generating && (
          <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 p-2.5 text-critical">
            {error instanceof ApiError ? error.message : 'The report writer failed.'} The facts below come straight from stored records. Nothing was invented. You can try again.
          </p>
        )}

        {generating ? (
          <div className="space-y-2" role="status">
            <p className="text-muted-foreground">Writing the summary from stored records…</p>
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" />
          </div>
        ) : !s ? (
          <p className="text-muted-foreground">
            No summary has been written for this sprint yet. {isLiveSession() ? 'The backend writes it after a run’s approvals are decided.' : 'Generate one to get a short written report where every statement cites the records behind it.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ToneBadge tone={s.kind === 'sample' ? 'warning' : s.kind === 'ai' ? 'violet' : 'neutral'}>{s.kind === 'sample' ? 'Sample text (mock backend)' : s.kind === 'ai' ? 'AI-written from stored records' : 'Compiled from stored records (rule-based)'}</ToneBadge>
              <span className="font-mono">{s.provider} · {s.model}</span>
              <span>generated {fmtTime(s.generated_at)}</span>
            </div>
            <ul className="space-y-2.5">
              {s.statements.map((st, i) => (
                <li key={i} className="space-y-1">
                  <p>{st.text}</p>
                  {st.refs.length > 0 && (
                    <p className="flex flex-wrap gap-1" aria-label="Sources">
                      {st.refs.map((ref) => isEvidenceId(ref) ? (
                        <button key={ref} type="button" onClick={() => onCite(ref)} title="Open in evidence explorer"
                          className="rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-primary transition-colors duration-150 hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{ref}</button>
                      ) : (
                        <span key={ref} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{ref}</span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Generated text never replaces the facts below. If they disagree, the stored records are correct.</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
