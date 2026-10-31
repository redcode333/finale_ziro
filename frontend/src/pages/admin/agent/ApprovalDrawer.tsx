import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuditEvents, useDecide, useMembers, useRecommendationEvidence, useRecommendations, useRetryApproval, useTasks } from '@/api/hooks'
import { ApprovalStatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/api/client'
import { approvalMeta, isActionable, isInFlight } from '@/lib/status'
import { nameOf } from '@/lib/workload'
import type { Recommendation } from '@/types'
import ReplanChecks from '../replan/ReplanChecks'
import { AssigneeSelector, AssignmentComparison, AuditTrail, EvidenceList, Section, TaskSummary } from './ApprovalSections'

type Mode = 'review' | 'editing' | 'confirm-approve' | 'confirm-modify' | 'reject'

interface Props { teamId: string; recId: string | null; onClose: () => void; onSwitch: (id: string) => void }

export default function ApprovalDrawer({ teamId, recId, onClose, onSwitch }: Props) {
  const { data: recs } = useRecommendations(teamId)
  const rec = recs?.find((r) => r.recommendation_id === recId)
  return (
    <Sheet open={!!recId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        {/* Keyed by proposal so local edit state resets when a modified proposal replaces this one. */}
        {rec ? <DrawerBody key={rec.recommendation_id} teamId={teamId} rec={rec} onSwitch={onSwitch} /> : (
          <SheetHeader><SheetTitle>Decision review</SheetTitle><SheetDescription>Loading proposal…</SheetDescription></SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DrawerBody({ teamId, rec, onSwitch }: { teamId: string; rec: Recommendation; onSwitch: (id: string) => void }) {
  const { data: members } = useMembers(teamId)
  const { data: tasks } = useTasks(teamId)
  const { data: evidence } = useRecommendationEvidence(rec.recommendation_id)
  const { data: audit } = useAuditEvents()
  const decide = useDecide()
  const retry = useRetryApproval()

  const [mode, setMode] = useState<Mode>('review')
  const [assignee, setAssignee] = useState(rec.proposed_assignee_id)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const task = tasks?.find((t) => t.task_id === rec.task_id)
  const allTasks = tasks ?? []
  const edited = assignee !== rec.proposed_assignee_id
  const actionable = isActionable(rec.status)
  const submitting = decide.isPending
  const current = members?.find((m) => m.member_id === rec.current_assignee_id)
  const finalOwner = members?.find((m) => m.member_id === assignee)
  const candidates = useMemo(() => (members ?? []).filter((m) => m.member_id !== rec.current_assignee_id), [members, rec.current_assignee_id])
  const trail = (audit ?? []).filter((a) => a.target_id === rec.approval_id || a.target_id === rec.task_id)
  const meta = approvalMeta[rec.status]

  const submit = (body: Parameters<typeof decide.mutate>[0]['body'], after?: (r: Recommendation) => void) => {
    setError(null)
    decide.mutate({ id: rec.approval_id, body }, {
      onSuccess: (r) => { after?.(r); setMode('review') },
      onError: (e) => { setError(e instanceof ApiError ? e.message : 'Could not submit the decision.'); setMode('review') },
    })
  }

  const approve = () => submit({ decision: 'approve', manager_note: note || undefined, expected_version: rec.version }, () => toast.success('Approved. Execution is pending.'))
  const reject = () => submit({ decision: 'reject', reason: reason.trim(), manager_note: note || undefined, expected_version: rec.version }, () => toast.success('Proposal rejected. Original assignment unchanged.'))
  const modify = () => submit({ decision: 'modify', modified_assignee_id: assignee, manager_note: note || undefined, expected_version: rec.version },
    (r) => { toast.success('Revised proposal returned for approval.'); onSwitch(r.recommendation_id) })

  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          Decision review <span className="font-mono text-sm font-normal text-muted-foreground">{rec.recommendation_id}</span>
          <ApprovalStatusBadge status={rec.status} />
        </SheetTitle>
        <SheetDescription>{meta.hint}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {error && <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 p-2.5 text-sm text-critical">{error} Review the latest state below before trying again.</p>}

        <Section title="AI recommendation">
          <p className="text-sm">{rec.rationale}</p>
          <p className="text-xs text-muted-foreground">Trigger: {rec.trigger_reason}</p>
          <p className="text-xs text-muted-foreground">Impact: {rec.expected_impact}</p>
          <p className="text-xs text-muted-foreground">Downside: {rec.potential_downside}</p>
        </Section>

        <Section title="Task details"><TaskSummary task={task} /></Section>

        <Section title="Assignment comparison">
          <AssignmentComparison current={current} proposed={finalOwner} tasks={allTasks} edited={edited} />
        </Section>

        <Section title="Validation checks"><ReplanChecks checks={rec.impact.checks} /></Section>

        {mode === 'editing' && (
          <Section title="Choose a different assignee">
            <AssigneeSelector candidates={candidates} tasks={allTasks} selected={assignee} aiProposed={rec.proposed_assignee_id} disabled={submitting} onSelect={setAssignee} />
          </Section>
        )}

        <Section title="Evidence"><EvidenceList items={evidence} /></Section>

        {actionable && (
          <Section title="Manager note (optional, saved to audit history)">
            <label className="sr-only" htmlFor="manager-note">Manager note</label>
            <Textarea id="manager-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={submitting} placeholder="Why are you making this decision?" />
          </Section>
        )}

        {mode === 'reject' && (
          <Section title="Rejection reason (required)">
            <label className="sr-only" htmlFor="reject-reason">Rejection reason</label>
            <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={submitting} placeholder="The original assignment will remain." />
          </Section>
        )}

        {rec.manager_note && !actionable && <Section title="Manager note"><p className="text-sm">{rec.manager_note}</p></Section>}
        {rec.decision_reason && <Section title="Rejection reason"><p className="text-sm">{rec.decision_reason}</p></Section>}

        <Section title="Audit history"><AuditTrail events={trail} /></Section>
      </div>

      <footer className="shrink-0 space-y-2 border-t border-border bg-popover p-4">
        {(mode === 'confirm-approve' || mode === 'confirm-modify') && (
          <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm" role="group" aria-label="Confirm decision">
            <p className="font-medium">{mode === 'confirm-approve' ? 'Confirm approval' : 'Submit revised proposal'}</p>
            <p>
              {rec.task_id}: <span className="font-mono">{nameOf(members, rec.current_assignee_id)}</span> → <span className="font-mono text-primary">{nameOf(members, assignee)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {mode === 'confirm-approve' ? 'The task is not changed until the backend confirms the update.' : 'A manager-edited proposal returns to pending review and must be approved again.'}
            </p>
          </div>
        )}

        {actionable ? (
          <div className="flex flex-wrap gap-2">
            {mode === 'review' && (<>
              <Button disabled={submitting} onClick={() => setMode('confirm-approve')}>Approve</Button>
              <Button variant="secondary" disabled={submitting} onClick={() => setMode('editing')}>Modify</Button>
              <Button variant="destructive" disabled={submitting} onClick={() => setMode('reject')}>Reject</Button>
            </>)}
            {mode === 'editing' && (<>
              <Button disabled={!edited || submitting} onClick={() => setMode('confirm-modify')}>Review change</Button>
              <Button variant="ghost" onClick={() => { setAssignee(rec.proposed_assignee_id); setMode('review') }}>Cancel edit</Button>
            </>)}
            {mode === 'confirm-approve' && (<>
              <Button disabled={submitting} onClick={approve}>{submitting ? 'Submitting…' : 'Confirm approval'}</Button>
              <Button variant="ghost" disabled={submitting} onClick={() => setMode('review')}>Back</Button>
            </>)}
            {mode === 'confirm-modify' && (<>
              <Button disabled={submitting} onClick={modify}>{submitting ? 'Submitting…' : 'Submit revised proposal'}</Button>
              <Button variant="ghost" disabled={submitting} onClick={() => setMode('editing')}>Back</Button>
            </>)}
            {mode === 'reject' && (<>
              <Button variant="destructive" disabled={!reason.trim() || submitting} onClick={reject}>{submitting ? 'Submitting…' : 'Confirm rejection'}</Button>
              <Button variant="ghost" disabled={submitting} onClick={() => setMode('review')}>Back</Button>
            </>)}
          </div>
        ) : (
          <div role="status" aria-live="polite" className="space-y-2 text-sm">
            <p>{meta.label}. {meta.hint}</p>
            {isInFlight(rec.status) && <p className="text-xs text-muted-foreground">Actions are disabled while the update is in progress.</p>}
            {rec.status === 'completed' && <p>Task owner is now <span className="font-medium">{nameOf(members, rec.proposed_assignee_id)}</span>.</p>}
            {rec.status === 'superseded' && rec.superseded_by && <p>Replaced by <span className="font-mono">{rec.superseded_by}</span>.</p>}
            {rec.status === 'failed' && (
              <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate(rec.approval_id)}>Retry execution</Button>
            )}
          </div>
        )}
      </footer>
    </>
  )
}
