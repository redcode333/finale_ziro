import type { ApprovalStatus, EventCategory, EventStatus, EvidenceStatus, RunStage, RunStatus } from '@/types'

// Tone -> classes. Colors come from the design tokens (violet agent/pending, green done, amber risk, red failure).
export type Tone = 'violet' | 'success' | 'warning' | 'critical' | 'neutral'
export const toneClass: Record<Tone, string> = {
  violet: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  critical: 'bg-critical/15 text-critical',
  neutral: 'bg-muted text-muted-foreground',
}

export const approvalMeta: Record<ApprovalStatus, { label: string; tone: Tone; hint: string }> = {
  pending_review: { label: 'Pending review', tone: 'warning', hint: 'Awaiting manager decision.' },
  approved_execution_pending: { label: 'Approved — execution pending', tone: 'violet', hint: 'Decision saved. The task has not been updated yet.' },
  executing: { label: 'Executing', tone: 'violet', hint: 'The backend is applying the approved change.' },
  completed: { label: 'Completed', tone: 'success', hint: 'Task update confirmed and audit record written.' },
  rejected: { label: 'Rejected', tone: 'neutral', hint: 'Declined. The original assignment is unchanged.' },
  failed: { label: 'Failed', tone: 'critical', hint: 'The decision is saved but the task update failed. You can retry safely.' },
  expired: { label: 'Expired', tone: 'neutral', hint: 'No longer actionable.' },
  superseded: { label: 'Superseded', tone: 'neutral', hint: 'Replaced by a newer proposal or stale data.' },
}
export const isActionable = (s: ApprovalStatus) => s === 'pending_review'
export const isInFlight = (s: ApprovalStatus) => s === 'approved_execution_pending' || s === 'executing'

export const runStatusMeta: Record<RunStatus | 'idle', { label: string; tone: Tone }> = {
  idle: { label: 'Idle', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'violet' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const RUN_STAGES: { key: RunStage; label: string }[] = [
  { key: 'plan', label: 'Plan' },
  { key: 'act', label: 'Act' },
  { key: 'observe', label: 'Observe' },
  { key: 'replan', label: 'Re-plan' },
  { key: 'approval', label: 'Approval' },
  { key: 'execute', label: 'Execute' },
  { key: 'report', label: 'Report' },
]

export const categoryLabel: Record<EventCategory, string> = {
  planning: 'Planning', retrieval: 'Data retrieval', analysis: 'Analysis', risk: 'Risk detection',
  decision: 'Decision', approval: 'Approval', execution: 'Execution', completion: 'Completion', failure: 'Failure',
}

/** Pending approval is a business state, not a running tool call, so it never pulses. */
export function eventState(category: EventCategory, status: EventStatus): { label: string; tone: Tone; pulse: boolean } {
  if (category === 'approval' && (status === 'running' || status === 'queued')) return { label: 'Pending', tone: 'warning', pulse: false }
  if (category === 'decision' && status === 'completed') return { label: 'Needs review', tone: 'violet', pulse: false }
  if (category === 'risk' && status === 'completed') return { label: 'Warning', tone: 'warning', pulse: false }
  switch (status) {
    case 'running': return { label: 'Running', tone: 'violet', pulse: true }
    case 'queued': return { label: 'Queued', tone: 'neutral', pulse: false }
    case 'completed': return { label: 'Completed', tone: 'success', pulse: false }
    case 'failed': return { label: 'Failed', tone: 'critical', pulse: false }
    case 'timed_out': return { label: 'Timed out', tone: 'critical', pulse: false }
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral', pulse: false }
  }
}

export const evidenceMeta: Record<EvidenceStatus, { label: string; tone: Tone }> = {
  verified: { label: 'Verified', tone: 'success' },
  partially_verified: { label: 'Partially verified', tone: 'warning' },
  unverified: { label: 'Unverified', tone: 'neutral' },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'neutral' },
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const fmtDuration = (ms: number | null) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
