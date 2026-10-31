import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useLlmCalls, useToolCalls } from '@/api/hooks'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDuration, fmtTime, type Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { LlmAttempt, LlmCall, ToolCall } from '@/types'

const PURPOSE: Record<LlmCall['purpose'], string> = { planner: 'Planner', assessor: 'Evidence assessor', report_writer: 'Report writer' }
const OUTCOME: Record<LlmAttempt['outcome'], { label: string; tone: Tone }> = {
  success: { label: 'success', tone: 'success' },
  timeout: { label: 'timeout', tone: 'warning' },
  rate_limited: { label: 'rate limited', tone: 'warning' },
  server_error: { label: 'server error', tone: 'warning' },
  invalid_schema: { label: 'invalid output', tone: 'critical' },
  auth_error: { label: 'auth error', tone: 'critical' },
  config_error: { label: 'config error', tone: 'critical' },
}

function ToolCalls({ calls }: { calls: ToolCall[] }) {
  const tools = new Set(calls.map((c) => c.tool_name))
  const failed = calls.filter((c) => c.status === 'failed').length
  const avg = calls.length ? Math.round(calls.reduce((s, c) => s + c.latency_ms, 0) / calls.length) : 0
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span><span className="font-mono">{calls.length}</span> calls</span>
        <span className="flex items-center gap-1"><span className="font-mono">{tools.size}</span> distinct tools{tools.size >= 3 && <CheckCircle2 className="size-3.5 text-success" aria-label="at least three distinct tools" />}</span>
        <span><span className="font-mono">{failed}</span> failed</span>
        <span>avg <span className="font-mono">{fmtDuration(avg)}</span></span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>{['Time', 'Tool', 'Operation', 'Result', 'Latency', 'Rows', 'Scope'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.tool_call_id} className="border-t border-border align-top">
                <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{fmtTime(c.started_at)}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{c.tool_name}</td>
                <td className="px-2 py-1.5 text-xs">
                  {c.operation ?? <span className="text-muted-foreground">not recorded</span>}
                  {c.error && <span className="mt-0.5 block text-critical">{c.error}</span>}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <ToneBadge tone={c.status === 'success' ? 'success' : 'critical'}>{c.status === 'success' ? 'Success' : 'Failed'}{c.http_status ? ` · ${c.http_status}` : ''}</ToneBadge>
                  {(c.retries ?? 0) > 0 && <span className="ml-1 text-xs text-muted-foreground">{c.retries} retries</span>}
                </td>
                <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{fmtDuration(c.latency_ms)}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{c.result_count ?? 'unknown'}</td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{c.scope ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">A model call is not a tool call. Rows are “unknown” when a call fails, never zero.</p>
    </div>
  )
}

function LlmCards({ calls }: { calls: LlmCall[] }) {
  return (
    <ul className="space-y-3">
      {calls.map((c) => (
        <li key={c.llm_call_id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{PURPOSE[c.purpose]} <span className="font-mono text-xs font-normal text-muted-foreground">{c.llm_call_id}{c.started_at ? ` · ${fmtTime(c.started_at)}` : ''}</span></p>
            <div className="flex flex-wrap gap-1.5">
              {c.fallback_reason && <ToneBadge tone="warning">Fallback: {c.fallback_reason.replaceAll('_', ' ')}</ToneBadge>}
              <ToneBadge tone={c.status === 'success' ? 'success' : 'critical'}>{c.status === 'success' ? 'Answered' : 'Failed'}</ToneBadge>
            </div>
          </div>
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Provider attempts">
            {c.attempts.map((a, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
                <span className="rounded-md border border-border px-2 py-1 text-xs">
                  <span className="font-mono">{a.provider}</span> <span className="text-muted-foreground">{a.model}</span>{' '}
                  <ToneBadge tone={OUTCOME[a.outcome].tone} className="ml-1">{OUTCOME[a.outcome].label}</ToneBadge>{' '}
                  <span className="font-mono text-muted-foreground">{fmtDuration(a.latency_ms)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Answered by <span className="font-mono text-foreground">{c.final_provider ?? 'none'}</span></span>
            <span>total <span className="font-mono text-foreground">{fmtDuration(c.latency_ms)}</span></span>
            <span className={cn('flex items-center gap-1', c.schema_valid ? 'text-success' : 'text-critical')}>
              <ShieldCheck className="size-3.5" aria-hidden /> {c.schema_valid ? 'Structured output validated' : 'Structured output invalid'}
            </span>
            <span>tokens {c.tokens_in == null ? 'not reported' : `${c.tokens_in} in / ${c.tokens_out ?? '?'} out`}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

export default function RunTrace({ runId, active }: { runId?: string; active: boolean }) {
  const [view, setView] = useState<'tools' | 'llm'>('tools')
  const tools = useToolCalls(runId, active)
  const llm = useLlmCalls(runId, active)
  const sample = [...(tools.data ?? []), ...(llm.data ?? [])].some((c) => c.source_label === 'synthetic')

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Run trace</CardTitle>
        <div className="flex items-center gap-2">
          {sample && <ToneBadge tone="warning">Sample trace (mock backend)</ToneBadge>}
          <div className="flex gap-1" role="group" aria-label="Trace view">
            {([['tools', `Tool calls${tools.data ? ` (${tools.data.length})` : ''}`], ['llm', `LLM calls${llm.data ? ` (${llm.data.length})` : ''}`]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
                className={cn('rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  view === k && 'bg-primary/15 text-primary')}>{label}</button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent aria-live="polite">
        {!runId ? <p className="text-sm text-muted-foreground">Start a run to see its trace.</p>
          : (view === 'tools' ? tools : llm).isPending ? <Skeleton className="h-24" />
          : (view === 'tools' ? tools : llm).isError ? <p role="alert" className="text-sm text-critical">Could not load the trace.</p>
          : view === 'tools'
            ? (tools.data!.length ? <ToolCalls calls={tools.data!} /> : <p className="text-sm text-muted-foreground">No tool calls yet for this run.</p>)
            : (llm.data!.length ? <LlmCards calls={llm.data!} /> : <p className="text-sm text-muted-foreground">No model calls yet for this run.</p>)}
      </CardContent>
    </Card>
  )
}
