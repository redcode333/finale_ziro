import { Skeleton } from '@/components/ui/skeleton'
import type { Dashboard } from '@/types'

export type MetricKey = 'tasks' | 'evidence' | 'risks' | 'pending' | 'coverage'

// Definitions follow the spec: evidence is deduplicated by source ID; coverage = tasks with evidence / tasks assessed.
const DEFS: { key: MetricKey; label: string; hint: string; value: (k: Dashboard['kpis']) => string | number }[] = [
  { key: 'tasks', label: 'Tasks analyzed', hint: 'Distinct sprint tasks in the selected run', value: (k) => k.tasks_analyzed },
  { key: 'evidence', label: 'Evidence collected', hint: 'Source records, deduplicated by source ID. Click to browse.', value: (k) => k.evidence_collected },
  { key: 'risks', label: 'Risks detected', hint: 'Active risk records', value: (k) => k.risks_detected },
  { key: 'pending', label: 'Actions pending', hint: 'Recommendations awaiting manager review', value: (k) => k.actions_pending },
  { key: 'coverage', label: 'Evidence coverage', hint: 'Tasks with supporting evidence / tasks assessed', value: (k) => `${Math.round(k.evidence_coverage * 100)}%` },
]

export default function AgentMetrics({ kpis, onSelect }: { kpis?: Dashboard['kpis']; onSelect: (k: MetricKey) => void }) {
  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {DEFS.map((d) =>
        kpis ? (
          <button
            key={d.key}
            type="button"
            title={d.hint}
            onClick={() => onSelect(d.key)}
            className="rounded-xl border border-border bg-card p-3 text-left transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="text-xs text-muted-foreground">{d.label}</span>
            <span className="mt-1 block font-mono text-2xl">{d.value(kpis)}</span>
          </button>
        ) : (
          <Skeleton key={d.key} className="h-[76px]" />
        ),
      )}
    </section>
  )
}
