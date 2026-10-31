import { Badge } from '@/components/ui/badge'
import { approvalMeta, toneClass, type Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { ApprovalStatus } from '@/types'

export function ToneBadge({ tone, children, pulse, className }: { tone: Tone; children: React.ReactNode; pulse?: boolean; className?: string }) {
  return (
    <Badge variant="ghost" className={cn(toneClass[tone], className)}>
      {pulse && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </Badge>
  )
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const m = approvalMeta[status]
  return <ToneBadge tone={m.tone} pulse={status === 'executing'}>{m.label}</ToneBadge>
}
