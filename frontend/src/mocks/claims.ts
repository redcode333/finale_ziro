import type { Claim, EvidenceRecord, EvidenceStatus } from '@/types'
import { standups } from './contributor'
import { evidence, members, tasks } from './store'

// Stand-in for the backend's deterministic verifier. Plain rules, no model:
//  - match by member + task; a standup that only announces unavailability is not a work claim
//  - "substantive" evidence excludes empty messages, zero-hour worklogs and worklogs that say no artifact exists
//  - a completion claim needs the task to be marked done; otherwise partial support is only partial
const COMPLETION = /(all .*tasks? (are )?(complete|done)|tasks? (is|are) (complete|done)|finished|ready for review)/i
const NOT_A_CLAIM = /unavailable|out of office|on leave/i
const NO_ARTIFACT = /no (implementation )?(artifact|worklog)/i
const ARTIFACT_TYPES = new Set<EvidenceRecord['source_type']>(['commit', 'pull_request', 'review', 'issue'])

const hoursOf = (e: EvidenceRecord) => parseFloat(e.title) || 0
const substantive = (e: EvidenceRecord) => {
  if (e.source_type === 'worklog') return hoursOf(e) > 0 && !NO_ARTIFACT.test(e.title)
  return e.title.trim() !== '' && !/^\(empty message\)$/i.test(e.title.trim())
}
const nm = (id: string) => members.find((m) => m.member_id === id)?.name ?? id

function verify(memberId: string, taskId: string, kind: Claim['kind']) {
  const task = tasks.find((t) => t.task_id === taskId)
  const own = evidence.filter((e) => e.member_id === memberId && e.task_id === taskId)
  const gaps: string[] = []
  let status: EvidenceStatus
  let why: string

  if (task && task.assignee_id !== memberId) {
    gaps.push(`${taskId} is assigned to ${nm(task.assignee_id)}, not to ${nm(memberId)}.`, 'No records by this member are linked to this task.')
    return { status: 'insufficient_evidence' as const, why: 'Nothing links this member to the task. A handoff or pairing may exist off-platform.', gaps, matched: own }
  }
  if (own.length === 0) {
    gaps.push('No commits, reviews, comments or worklogs are linked to this task.')
    return { status: 'insufficient_evidence' as const, why: 'No matching records were found. That is not evidence that no work happened.', gaps, matched: own }
  }

  const good = own.filter(substantive)
  const hasArtifact = good.some((e) => ARTIFACT_TYPES.has(e.source_type))
  const hasWorklog = good.some((e) => e.source_type === 'worklog')
  for (const e of own.filter((x) => !substantive(x))) {
    gaps.push(e.source_type === 'worklog' ? `${e.id}: worklog records no usable work (${e.title}).` : `${e.id}: ${e.source_type.replace('_', ' ')} has an empty message, so it cannot establish what changed.`)
  }
  if (!hasWorklog && good.length > 0) gaps.push('No worklog with hours is linked.')
  if (!hasArtifact && good.length > 0) gaps.push('No commit, review or comment record is linked.')

  if (good.length === 0) {
    status = 'unverified'
    why = 'Records exist, but none describe completed work.'
  } else if (kind === 'completed' && task && task.status !== 'done') {
    status = 'partially_verified'
    gaps.unshift(`Task is still marked "${task.status.replace('_', ' ')}".`)
    why = 'Some work is visible, but the task is not marked done, so completion is not supported yet.'
  } else if (hasArtifact && hasWorklog) {
    status = 'verified'
    why = 'A work record and logged hours both support this claim.'
  } else {
    status = 'partially_verified'
    why = 'Some supporting records were found; see the gaps.'
  }
  return { status, why, gaps, matched: own }
}

export function claimsFor(memberId?: string | null): Claim[] {
  const out: Claim[] = []
  for (const s of standups) {
    if (memberId && s.member_id !== memberId) continue
    if (NOT_A_CLAIM.test(s.yesterday)) continue
    const kind: Claim['kind'] = COMPLETION.test(s.yesterday) ? 'completed' : 'worked_on'
    for (const taskId of s.claimed_task_ids) {
      const task = tasks.find((t) => t.task_id === taskId)
      const v = verify(s.member_id, taskId, kind)
      out.push({
        claim_id: `${s.standup_id}:${taskId}`, standup_id: s.standup_id, member_id: s.member_id, task_id: taskId,
        task_title: task?.title ?? taskId, task_owner_id: task?.assignee_id ?? '', task_status: task?.status ?? 'unknown',
        kind, claim_text: s.yesterday, claimed_at: s.submitted_at, verification: v.status, explanation: v.why,
        gaps: v.gaps, matched_evidence: v.matched, source_label: 'synthetic',
      })
    }
  }
  return out.sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))
}
