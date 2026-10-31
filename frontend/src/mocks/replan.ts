import type { Recommendation, ReplanImpact } from '@/types'
import { approvals, audit, evidence, getRuns, members, tasks, type InternalApproval } from './store'

const openHours = (memberId: string) =>
  tasks.filter((t) => t.assignee_id === memberId && t.status !== 'done').reduce((s, t) => s + t.estimate_hours, 0)
const capacityOf = (memberId: string) => members.find((m) => m.member_id === memberId)?.weekly_capacity_hours ?? 0
const nameOf = (id: string) => members.find((m) => m.member_id === id)?.name ?? id

// Capacity and dependency validation: plain arithmetic over stored records, no model involved.
export function computeImpact(rec: Omit<Recommendation, 'impact'>): ReplanImpact {
  const task = tasks.find((t) => t.task_id === rec.task_id)!
  const est = task.estimate_hours
  const moved = task.assignee_id === rec.proposed_assignee_id
  const fromNow = openHours(rec.current_assignee_id)
  const toNow = openHours(rec.proposed_assignee_id)
  const from = {
    member_id: rec.current_assignee_id, open_hours_before: moved ? fromNow + est : fromNow,
    open_hours_after: moved ? fromNow : fromNow - est, capacity_hours: capacityOf(rec.current_assignee_id),
  }
  const to = {
    member_id: rec.proposed_assignee_id, open_hours_before: moved ? toNow - est : toNow,
    open_hours_after: moved ? toNow : toNow + est, capacity_hours: capacityOf(rec.proposed_assignee_id),
  }

  const over = to.open_hours_after - to.capacity_hours
  const unmet = task.dependency_task_ids.filter((d) => tasks.find((t) => t.task_id === d)?.status !== 'done')
  const who = nameOf(rec.proposed_assignee_id)
  const checks: ReplanImpact['checks'] = [
    over > 0
      ? { key: 'capacity', status: 'fail', detail: `${who} would have ${to.open_hours_after}h open against ${to.capacity_hours}h weekly capacity (${over}h over).` }
      : { key: 'capacity', status: 'pass', detail: `${who} would have ${to.open_hours_after}h open against ${to.capacity_hours}h weekly capacity.` },
    unmet.length
      ? { key: 'dependencies', status: 'conditional', detail: `Still depends on ${unmet.join(', ')}. The task can only start once those are done; reassigning does not change that.` }
      : { key: 'dependencies', status: 'pass', detail: task.dependency_task_ids.length ? `All dependencies (${task.dependency_task_ids.join(', ')}) are done.` : 'No dependencies.' },
  ]
  if (rec.capacity_check === 'needs_confirmation') {
    checks.push({ key: 'evidence', status: 'conditional', detail: 'Triggered by an evidence mismatch. Clarify with the member first; do not reassign on a mismatch alone.' })
  }
  return { task_estimate_hours: est, from, to, checks }
}

export const withImpact = ({ stateSince: _s, ...rest }: InternalApproval): Recommendation => ({ ...rest, impact: computeImpact(rest) })

// Re-plan trigger: mark a member unavailable, then propose a capacity-aware owner for each of their open tasks.
// Proposals only; nothing is reassigned until a mentor approves.
export function requestReplan(sprintId: string, memberId: string, reason: string, actor: string) {
  const member = members.find((m) => m.member_id === memberId)
  if (!member) return { ok: false as const, status: 404, code: 'not_found', message: 'Member not found' }
  member.availability_status = 'temporarily_unavailable'

  const open = tasks.filter((t) => t.sprint_id === sprintId && t.assignee_id === memberId && t.status !== 'done')
  const runId = getRuns().at(-1)?.run_id ?? 'RUN001'
  const planned = new Map<string, number>() // hours already proposed to each candidate in this batch
  const proposals: Recommendation[] = []
  const unassigned: string[] = []

  for (const task of open) {
    // Idempotent: the same trigger for the same task never creates a second pending proposal.
    if (approvals.some((a) => a.task_id === task.task_id && a.status === 'pending_review' && a.trigger_reason === reason)) continue
    const best = members
      .filter((m) => m.member_id !== memberId && m.availability_status === 'available')
      .map((m) => ({ m, room: m.weekly_capacity_hours - openHours(m.member_id) - (planned.get(m.member_id) ?? 0) }))
      .filter((c) => c.room >= task.estimate_hours)
      .sort((a, b) => b.room - a.room)[0]
    if (!best) { unassigned.push(task.task_id); continue }
    planned.set(best.m.member_id, (planned.get(best.m.member_id) ?? 0) + task.estimate_hours)

    const id = `AP${String(approvals.length + 1).padStart(3, '0')}`
    const depsDone = task.dependency_task_ids.every((d) => tasks.find((t) => t.task_id === d)?.status === 'done')
    const rec: InternalApproval = {
      recommendation_id: id, approval_id: id, run_id: runId, task_id: task.task_id, type: 'task_reassignment',
      trigger_reason: reason,
      rationale: `${member.name} is unavailable. ${best.m.name} has the most remaining capacity (${best.room}h free) for this ${task.estimate_hours}h task.`,
      current_assignee_id: memberId, proposed_assignee_id: best.m.member_id, capacity_check: 'pass_within_remaining_capacity',
      dependency_check: depsDone ? 'pass' : 'pass_if_dependencies_complete',
      status: 'pending_review', version: 1, created_at: new Date().toISOString(), decided_at: null, reviewer_id: null,
      decision_reason: null, manager_note: null, execution_status: null,
      expected_impact: 'Keeps the task moving while the owner is away.',
      potential_downside: 'Context switch for the new owner; the original owner should leave handoff notes.',
      evidence_ids: evidence.filter((e) => e.task_id === task.task_id).map((e) => e.id),
      superseded_by: null, source_label: 'synthetic', stateSince: Date.now(),
    }
    approvals.push(rec)
    proposals.push(withImpact(rec))
    audit(actor, 'replan_requested', id, { assignee_id: memberId }, { proposed_assignee_id: best.m.member_id }, reason, runId)
  }
  return { ok: true as const, proposals, unassigned_task_ids: unassigned }
}
