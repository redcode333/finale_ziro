import type { WeeklyReport } from '@/types'

// Plain Markdown export so a mentor can paste the report anywhere. Facts come from stored records only.
export function reportToMarkdown(r: WeeklyReport): string {
  const L: string[] = []
  const name = (id: string) => r.contributions.find((c) => c.member_id === id)?.name ?? id
  L.push(`# Weekly mentor report: ${r.sprint.name}`, '', `Generated ${r.generated_at} from persisted records.`, '')

  if (r.summary) {
    L.push('## Mentor summary', '')
    const k = r.summary.kind
    const label = k === 'sample' ? 'Sample text from the mock backend (not a language model)' : k === 'deterministic' ? `Compiled by rules from stored records (${r.summary.model})` : `AI-written (${r.summary.provider}, ${r.summary.model})`
    L.push(`_${label}. Citations are record IDs._`, '')
    for (const s of r.summary.statements) L.push(`- ${s.text}${s.refs.length ? ` [${s.refs.join(', ')}]` : ''}`)
    L.push('')
  }

  const p = r.progress
  L.push('## Progress', '', `${p.done} of ${p.total} tasks done. In progress ${p.in_progress}, blocked ${p.blocked}, to do ${p.todo}.`, '')
  L.push('## Blockers', '')
  if (r.blockers.length === 0) L.push('None.')
  for (const b of r.blockers) L.push(`- ${b.task_id} ${b.title} (${name(b.assignee_id)})${b.dependency_task_ids.length ? `, depends on ${b.dependency_task_ids.join(', ')}` : ''}`)
  L.push('', '## Evidence discrepancies', '')
  if (r.discrepancies.length === 0) L.push('None.')
  for (const d of r.discrepancies) L.push(`- ${name(d.member_id)}: ${d.summary} Action: ${d.recommended_action} Evidence: ${d.evidence_ids.join(', ')}`)
  L.push('', '_A discrepancy is a request for clarification, not a finding about the person._', '', '## Contribution evidence', '')
  for (const c of r.contributions) {
    const ev = Object.entries(c.evidence_by_type).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') || 'none linked'
    L.push(`- ${c.name}: ${ev}; ${c.hours_logged}h logged; ${c.tasks_done} tasks done`)
  }
  L.push('', '## Recommendations', '')
  for (const x of r.recommendations) L.push(`- ${x.recommendation_id} (${x.task_id}) ${x.status.replaceAll('_', ' ')}: ${x.summary}`)
  return L.join('\n') + '\n'
}
