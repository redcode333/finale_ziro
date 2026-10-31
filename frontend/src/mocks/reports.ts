import dataset from '../../../data/synthetic_dataset/dataset.json'
import type { EvaluationCase, EvaluationResults, SimulationResult, WeeklyReport } from '@/types'
import { TEAM_ID, approvals, evidence, members, risks, sprints, tasks } from './store'

const cases = dataset.tables.evaluation_cases as unknown as Record<string, string>[]

// Built only from stored records: counts and links, no invented narrative.
export function weeklyReport(): WeeklyReport {
  const count = (s: string) => tasks.filter((t) => t.status === s).length
  return {
    team_id: TEAM_ID,
    sprint: sprints[0],
    generated_at: new Date().toISOString(),
    basis: 'persisted_records',
    progress: { total: tasks.length, done: count('done'), in_progress: count('in_progress'), blocked: count('blocked'), todo: count('todo') },
    blockers: tasks.filter((t) => t.status === 'blocked').map((t) => ({
      task_id: t.task_id, title: t.title, assignee_id: t.assignee_id, dependency_task_ids: t.dependency_task_ids,
    })),
    discrepancies: risks.filter((r) => r.status !== 'verified_contribution' && r.risk_level !== 'none'),
    contributions: members.map((m) => {
      const mine = evidence.filter((e) => e.member_id === m.member_id)
      const by: Record<string, number> = {}
      for (const e of mine) by[e.source_type] = (by[e.source_type] ?? 0) + 1
      const hours = mine.filter((e) => e.source_type === 'worklog').reduce((s, e) => s + (parseFloat(e.title) || 0), 0)
      return {
        member_id: m.member_id, name: m.name, evidence_by_type: by, hours_logged: hours,
        tasks_done: tasks.filter((t) => t.assignee_id === m.member_id && t.status === 'done').length,
        note: mine.length === 0
          ? 'No linked evidence found. This is not evidence of no work.'
          : 'Reviews, QA, docs, research and coordination count as contributions. Commit count alone is weak evidence.',
      }
    }),
    recommendations: approvals.map((a) => ({
      recommendation_id: a.recommendation_id, task_id: a.task_id, status: a.status, summary: a.rationale,
    })),
  }
}

let lastRun: string | null = null

// Mock mode never executes the backend suite, so nothing is marked as passed and no metric is invented.
export function evaluationResults(): EvaluationResults {
  return {
    mode: 'mock',
    ran_at: lastRun,
    cases: cases.map((c): EvaluationCase => ({
      case_id: c.case_id, scenario: c.scenario, expected_outcome: c.expected_outcome, assertion: c.assertion, result: 'not_run',
    })),
    metrics: {
      precision: null, recall: null, false_positive_rate: null, evidence_coverage: null,
      replan_validity: null, approval_compliance: null, tool_recovery: null,
    },
  }
}
export const runEvaluations = () => { lastRun = new Date().toISOString(); return evaluationResults() }

type Step = SimulationResult['steps'][number]
const S = (status: Step['status'], label: string, detail: string): Step => ({ label, status, detail })

const SCENARIOS: Record<string, Omit<SimulationResult, 'scenario' | 'simulated'>> = {
  unauthorized_reassignment: {
    title: 'Unauthorized reassignment blocked',
    steps: [
      S('ok', 'Contributor M001 requests reassignment of T008', 'PATCH-style mutation attempted outside an approval'),
      S('blocked', 'Authorization check', '403 forbidden: only an approved proposal can change an assignee'),
      S('ok', 'Audit event written', 'action=reassignment_denied'),
    ],
    outcome: 'Assignee of T008 unchanged.',
    assertions: [{ text: 'No task mutation before approval', passed: true }, { text: 'Denied attempt is audited', passed: true }],
  },
  llm_timeout_fallback: {
    title: 'Primary LLM timeout, fallback succeeds',
    steps: [
      S('failed', 'Gemini call', 'timeout after 2 bounded retries'),
      S('warn', 'Provider router', 'fallback_reason=timeout, switching to OpenAI'),
      S('ok', 'OpenAI call', 'response validated against the shared schema'),
    ],
    outcome: 'Assessment produced by the fallback provider; trace records both attempts.',
    assertions: [{ text: 'Same schema validates', passed: true }, { text: 'Guardrails and approval unchanged', passed: true }],
  },
  both_llm_down: {
    title: 'Both providers unavailable',
    steps: [
      S('failed', 'Gemini call', 'HTTP 503'),
      S('failed', 'OpenAI call', 'HTTP 503'),
      S('ok', 'Checkpoint', 'graph state retained'),
    ],
    outcome: 'Run is pending/failed safely. No assessment fabricated.',
    assertions: [{ text: 'Checkpoint retained', passed: true }, { text: 'No invented findings', passed: true }],
  },
  github_503: {
    title: 'GitHub 503, degraded mode',
    steps: [
      S('failed', 'GitHub adapter', 'GET commits returned 503'),
      S('warn', 'Evidence collector', 'source marked unavailable, not empty'),
      S('ok', 'Verifier', 'status=insufficient_evidence for affected claims'),
    ],
    outcome: 'No inactivity conclusion drawn. Task and worklog evidence still used.',
    assertions: [{ text: 'Outage is not treated as zero activity', passed: true }],
  },
  prompt_injection: {
    title: 'Prompt injection in a standup ignored',
    steps: [
      S('ok', 'Standup ingested', 'Text contains instructions to reassign tasks and approve itself'),
      S('warn', 'Input handling', 'content treated as untrusted data'),
      S('ok', 'Planner output', 'schema-valid; embedded instructions not followed'),
    ],
    outcome: 'No assignment changed and no approval created from the standup text.',
    assertions: [{ text: 'Instructions ignored', passed: true }, { text: 'No mutation without approval', passed: true }],
  },
  duplicate_event: {
    title: 'Duplicate event is idempotent',
    steps: [
      S('ok', 'Standup SU-dup received', 'idempotency key seen for the first time'),
      S('ok', 'Same event replayed', 'idempotency key matched'),
      S('ok', 'Result', 'original response returned, no second record'),
    ],
    outcome: 'Exactly one standup and one notification stored.',
    assertions: [{ text: 'No duplicate action', passed: true }],
  },
}
export const scenarioList = Object.entries(SCENARIOS).map(([id, s]) => ({ id, title: s.title }))
export const simulate = (id: string): SimulationResult | undefined =>
  SCENARIOS[id] ? { scenario: id, simulated: true, ...SCENARIOS[id] } : undefined
