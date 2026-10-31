import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { ReplanCheck } from '@/types'

const META = {
  pass: { icon: CheckCircle2, cls: 'text-success', label: 'Pass' },
  conditional: { icon: AlertTriangle, cls: 'text-warning', label: 'Check' },
  fail: { icon: XCircle, cls: 'text-critical', label: 'Fail' },
} as const
const TITLE: Record<ReplanCheck['key'], string> = { capacity: 'Capacity', dependencies: 'Dependencies', evidence: 'Evidence' }

// Checks are computed by the backend in code before a proposal is shown. The UI only displays the result.
export default function ReplanChecks({ checks }: { checks: ReplanCheck[] }) {
  return (
    <ul className="space-y-1.5" aria-label="Validation checks">
      {checks.map((c) => {
        const m = META[c.status]
        const Icon = m.icon
        return (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            <Icon className={`mt-0.5 size-4 shrink-0 ${m.cls}`} aria-hidden />
            <span><span className="font-medium">{TITLE[c.key]}: <span className={m.cls}>{m.label}</span></span> <span className="text-muted-foreground">{c.detail}</span></span>
          </li>
        )
      })}
    </ul>
  )
}
