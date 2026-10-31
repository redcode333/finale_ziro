import { useState } from 'react'
import { useEvaluationResults, useRunEvaluations, useSimulate } from '@/api/hooks'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Tone } from '@/lib/status'
import type { SimulationResult } from '@/types'

const SCENARIOS = [
  { id: 'unauthorized_reassignment', title: 'Unauthorized reassignment' },
  { id: 'llm_timeout_fallback', title: 'Gemini timeout, OpenAI fallback' },
  { id: 'both_llm_down', title: 'Both LLMs unavailable' },
  { id: 'github_503', title: 'GitHub 503 degraded mode' },
  { id: 'prompt_injection', title: 'Prompt injection in standup' },
  { id: 'duplicate_event', title: 'Duplicate event' },
]
const STEP_TONE: Record<SimulationResult['steps'][number]['status'], Tone> = { ok: 'success', warn: 'warning', blocked: 'warning', failed: 'critical' }
const METRIC_LABEL: Record<string, string> = {
  precision: 'Precision', recall: 'Recall', false_positive_rate: 'False-positive rate', evidence_coverage: 'Evidence coverage',
  replan_validity: 'Re-plan validity', approval_compliance: 'Approval compliance', tool_recovery: 'Tool recovery',
}

export default function ReliabilityLab() {
  const sim = useSimulate()
  const evals = useEvaluationResults()
  const runEval = useRunEvaluations()
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [active, setActive] = useState<string | null>(null)

  const run = (id: string) => { setActive(id); sim.mutate(id, { onSuccess: setResult, onSettled: () => setActive(null) }) }
  const data = evals.data

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reliability Lab</h1>
        <p className="text-sm text-muted-foreground">
          These buttons call test-only backend scenarios. Everything here is a labeled simulation, not production activity.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Failure scenarios</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <Button key={s.id} variant="outline" disabled={sim.isPending} onClick={() => run(s.id)}>
                {active === s.id ? 'Running…' : s.title}
              </Button>
            ))}
          </div>
          {result && (
            <div className="space-y-3 rounded-lg border border-border p-3 text-sm" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{result.title}</p>
                <ToneBadge tone="violet">Simulation</ToneBadge>
              </div>
              <ol className="space-y-1.5">
                {result.steps.map((st, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ToneBadge tone={STEP_TONE[st.status]}>{st.status}</ToneBadge>
                    <span><span className="font-medium">{st.label}</span> <span className="text-muted-foreground">{st.detail}</span></span>
                  </li>
                ))}
              </ol>
              <p><span className="text-muted-foreground">Outcome:</span> {result.outcome}</p>
              <ul className="space-y-1">
                {result.assertions.map((a) => (
                  <li key={a.text} className="flex items-center gap-2">
                    <ToneBadge tone={a.passed ? 'success' : 'critical'}>{a.passed ? 'pass' : 'fail'}</ToneBadge>{a.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Evaluation suite</CardTitle>
          <Button size="sm" disabled={runEval.isPending} onClick={() => runEval.mutate()}>{runEval.isPending ? 'Running…' : 'Run evaluation'}</Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data?.mode === 'mock' && (
            <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-warning">
              Mock backend: no tests are executed and no metrics are produced. Real results appear once the FastAPI evaluator is connected.
            </p>
          )}
          {data && (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(data.metrics).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{METRIC_LABEL[k] ?? k}</dt><dd className="font-mono">{v == null ? 'Not measured' : v}</dd></div>
                ))}
              </dl>
              <ul className="divide-y divide-border">
                {data.cases.map((c) => (
                  <li key={c.case_id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="font-mono text-xs">{c.case_id}</span>
                    <span className="flex-1">{c.scenario.replaceAll('_', ' ')}<span className="block text-xs text-muted-foreground">{c.assertion}</span></span>
                    <ToneBadge tone={c.result === 'passed' ? 'success' : c.result === 'failed' ? 'critical' : 'neutral'}>{c.result.replace('_', ' ')}</ToneBadge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
