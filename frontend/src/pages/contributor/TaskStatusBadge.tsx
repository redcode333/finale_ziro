import { ToneBadge } from '@/components/common/StatusBadge'
import type { Tone } from '@/lib/status'

const META: Record<string, { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'violet' },
  blocked: { label: 'Blocked', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
}
export const TASK_STATUSES = Object.entries(META).map(([value, m]) => ({ value, label: m.label }))

export function TaskStatusBadge({ status }: { status: string }) {
  const m = META[status] ?? { label: status, tone: 'neutral' as Tone }
  return <ToneBadge tone={m.tone}>{m.label}</ToneBadge>
}
