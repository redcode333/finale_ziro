import type { AgentEvent, LlmCall, ToolCall } from '@/types'
import { reportSummary } from './reports'
import { getEvents } from './store'

// Sample trace derived from the run timeline. A real backend returns what its adapters and provider router logged.
// Token counts are unknown in the mock, so they are null rather than invented.

const num = (s: string | null) => parseInt(/(\d+)/.exec(s ?? '')?.[1] ?? '0', 10)
const githubDown = () => {
  try { return localStorage.getItem('mock.githubDown') === '1' } catch { return false }
}

export function toolCallsFor(runId: string): ToolCall[] | undefined {
  const events = getEvents(runId)
  if (!events) return undefined
  const out: ToolCall[] = []
  for (const e of events as AgentEvent[]) {
    const base = { run_id: runId, started_at: e.timestamp, source_label: 'synthetic' as const }
    if (e.tool === 'github_adapter') {
      const down = githubDown()
      out.push({
        ...base, tool_call_id: `${e.id}-T`, tool_name: 'github_adapter', operation: 'GET /repos/fairsprint-demo/campus-connect/commits, /pulls, /issues',
        status: down ? 'failed' : 'success', http_status: down ? 503 : 200, latency_ms: e.duration_ms ?? 0, retries: down ? 2 : 0,
        result_count: down ? null : num(e.output_summary), scope: 'repo: fairsprint-demo/campus-connect',
        error: down ? 'GitHub returned 503. Source marked unavailable (not empty); no inactivity conclusion drawn.' : null,
      })
    } else if (e.tool === 'supabase_task_tool' || e.tool === 'supabase_worklog_tool') {
      out.push({
        ...base, tool_call_id: `${e.id}-T`, tool_name: e.tool, operation: `SELECT ${e.tool === 'supabase_task_tool' ? 'tasks' : 'worklogs'} WHERE team_id = team_fs_001`,
        status: 'success', http_status: null, latency_ms: e.duration_ms ?? 0, retries: 0, result_count: num(e.output_summary), scope: 'team: team_fs_001', error: null,
      })
    } else if (e.category === 'decision') {
      out.push({
        ...base, tool_call_id: `${e.id}-T`, tool_name: 'approval_tool', operation: 'INSERT approvals (status = pending_review)',
        status: 'success', http_status: null, latency_ms: 18, retries: 0, result_count: 1, scope: 'team: team_fs_001', error: null,
      })
    }
  }
  return out
}

export function llmCallsFor(runId: string): LlmCall[] | undefined {
  const events = getEvents(runId)
  if (!events) return undefined
  const out: LlmCall[] = []
  for (const e of events as AgentEvent[]) {
    const base = { run_id: runId, started_at: e.timestamp, tokens_in: null, tokens_out: null, source_label: 'synthetic' as const }
    if (e.category === 'planning') {
      out.push({
        ...base, llm_call_id: `${runId}-L1`, purpose: 'planner', final_provider: 'gemini', final_model: 'sample-primary', status: 'success',
        latency_ms: e.duration_ms ?? 0, schema_valid: true, fallback_reason: null,
        attempts: [{ provider: 'gemini', model: 'sample-primary', outcome: 'success', latency_ms: e.duration_ms ?? 0 }],
      })
    } else if (e.category === 'analysis') {
      // Sample of the fallback path: primary times out twice (bounded retries), the fallback answers and the schema validates.
      out.push({
        ...base, llm_call_id: `${runId}-L2`, purpose: 'assessor', final_provider: 'openai', final_model: 'sample-fallback', status: 'success',
        latency_ms: 2 * 2000 + (e.duration_ms ?? 0), schema_valid: true, fallback_reason: 'primary_timeout',
        attempts: [
          { provider: 'gemini', model: 'sample-primary', outcome: 'timeout', latency_ms: 2000 },
          { provider: 'gemini', model: 'sample-primary', outcome: 'timeout', latency_ms: 2000 },
          { provider: 'openai', model: 'sample-fallback', outcome: 'success', latency_ms: e.duration_ms ?? 0 },
        ],
      })
    }
  }
  const rs = reportSummary()
  if (rs && events.length > 0) {
    out.push({
      llm_call_id: `${runId}-L3`, run_id: runId, purpose: 'report_writer', started_at: rs.generated_at, final_provider: 'mock', final_model: rs.model,
      status: 'success', latency_ms: 1600, schema_valid: true, fallback_reason: null, tokens_in: null, tokens_out: null,
      attempts: [{ provider: 'mock', model: rs.model, outcome: 'success', latency_ms: 1600 }], source_label: 'synthetic',
    })
  }
  return out
}
