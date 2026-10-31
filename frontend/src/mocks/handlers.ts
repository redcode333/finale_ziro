import { delay, http, HttpResponse } from 'msw'
import { blockers, once, standups } from './contributor'
import { evaluationResults, runEvaluations, simulate, weeklyReport } from './reports'
import {
  ADMIN_ID, TEAM_ID, approvals, auditEvents, controlRun, dashboardFor, decide, evidence, getEvents, getRun,
  getRuns, members, mockUsers, notifications, publicRec, retryExecution, risks, settle, sprints, startRun, tasks,
} from './store'

const page = <T,>(items: T[]) => ({ items, next_cursor: null })
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json(
    { error: { code, message, request_id: crypto.randomUUID(), retryable: status >= 500 } },
    { status },
  )

// Mock-only identity header. Production uses a Supabase bearer token and the backend decides the role.
const userOf = (req: Request) => mockUsers.find((u) => u.user_id === req.headers.get('x-mock-user'))
const isAdmin = (req: Request) => userOf(req)?.memberships.some((m) => m.role === 'ADMIN') ?? false
const adminOnly = (req: Request) => (!userOf(req) ? fail(401, 'unauthenticated', 'Sign in required') : isAdmin(req) ? null : fail(403, 'forbidden', 'Admin role required'))

const live = () => approvals.map((a) => settle(a))

export const handlers = [
  http.get('/health', () => HttpResponse.json({ status: 'ok' })),

  http.get('/me', async ({ request }) => {
    await delay(150)
    const u = userOf(request)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    const { label: _l, ...me } = u
    return HttpResponse.json(me)
  }),

  http.get('/teams/:teamId/dashboard', async ({ request }) => {
    if (!userOf(request)) return fail(401, 'unauthenticated', 'Sign in required')
    await delay(200)
    live()
    return HttpResponse.json({
      team_id: TEAM_ID,
      sprint: sprints[0],
      ...dashboardFor(),
      risks: isAdmin(request) ? risks.filter((r) => r.risk_level !== 'none') : [],
    })
  }),
  http.get('/teams/:teamId/members', ({ request }) => {
    const u = userOf(request)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    return HttpResponse.json(page(isAdmin(request) ? members : members.filter((m) => m.member_id === u.member_id)))
  }),
  http.get('/teams/:teamId/tasks', ({ request }) => {
    const u = userOf(request)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    return HttpResponse.json(page(isAdmin(request) ? tasks : tasks.filter((t) => t.assignee_id === u.member_id)))
  }),
  http.get('/teams/:teamId/sprints', () => HttpResponse.json(page(sprints))),
  http.get('/teams/:teamId/evidence', ({ request }) => {
    const me = userOf(request)
    if (!me) return fail(401, 'unauthenticated', 'Sign in required')
    const u = new URL(request.url)
    const m = isAdmin(request) ? u.searchParams.get('member_id') : me.member_id
    const t = u.searchParams.get('task_id')
    return HttpResponse.json(page(evidence.filter((e) => (!m || e.member_id === m) && (!t || e.task_id === t))))
  }),

  http.post('/agents/analyze', async ({ request }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const body = (await request.json()) as { sprint_id: string }
    return HttpResponse.json({ run_id: startRun(body.sprint_id, userOf(request)!.user_id).run_id }, { status: 202 })
  }),
  http.get('/agent-runs', ({ request }) => adminOnly(request) ?? HttpResponse.json(page(getRuns()))),
  http.get('/agent-runs/:id', ({ request, params }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const run = getRun(String(params.id))
    return run ? HttpResponse.json(run) : fail(404, 'not_found', 'Run not found')
  }),
  http.get('/agent-runs/:id/events', ({ request, params }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const after = new URL(request.url).searchParams.get('after') ?? undefined
    const events = getEvents(String(params.id), after)
    return events ? HttpResponse.json(page(events)) : fail(404, 'not_found', 'Run not found')
  }),
  http.post('/agent-runs/:id/:action', ({ request, params }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const run = controlRun(String(params.id), params.action as 'pause' | 'resume' | 'stop' | 'retry')
    return run ? HttpResponse.json(run) : fail(404, 'not_found', 'Run not found')
  }),

  http.get('/recommendations', ({ request }) => adminOnly(request) ?? HttpResponse.json(page(live().map(publicRec)))),
  http.get('/recommendations/:id/evidence', ({ params }) => {
    const a = approvals.find((x) => x.approval_id === params.id)
    return a ? HttpResponse.json(page(evidence.filter((e) => a.evidence_ids.includes(e.id)))) : fail(404, 'not_found', 'Not found')
  }),
  http.get('/recommendations/:id', ({ params }) => {
    const a = approvals.find((x) => x.approval_id === params.id)
    return a ? HttpResponse.json(publicRec(settle(a))) : fail(404, 'not_found', 'Not found')
  }),

  http.get('/approvals/history', ({ request }) => adminOnly(request) ?? HttpResponse.json(page(live().filter((a) => a.decided_at).map(publicRec)))),
  http.get('/approvals', ({ request }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const status = new URL(request.url).searchParams.get('status')
    return HttpResponse.json(page(live().filter((a) => !status || a.status === status).map(publicRec)))
  }),
  http.post('/approvals/:id/decision', async ({ request, params }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    await delay(250)
    const body = (await request.json()) as Parameters<typeof decide>[1]
    if (body.decision === 'reject' && !body.reason?.trim()) return fail(422, 'reason_required', 'A reason is required to reject.')
    const res = decide(String(params.id), body, userOf(request)?.user_id ?? ADMIN_ID)
    return res.ok ? HttpResponse.json(publicRec(res.rec)) : fail(res.status, res.code, res.message)
  }),
  http.post('/approvals/:id/retry', ({ request, params }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const a = retryExecution(String(params.id))
    return a ? HttpResponse.json(publicRec(a)) : fail(409, 'not_retryable', 'Only failed executions can be retried.')
  }),

  http.get('/audit-events', ({ request }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    const id = new URL(request.url).searchParams.get('entity_id')
    live()
    return HttpResponse.json(page(auditEvents.filter((a) => !id || a.target_id === id).slice().reverse()))
  }),
  http.get('/standups', ({ request }) => {
    const u = userOf(request)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    return HttpResponse.json(page(standups.filter((x) => isAdmin(request) || x.member_id === u.member_id).slice().reverse()))
  }),
  http.post('/standups', async ({ request }) => {
    const u = userOf(request)
    if (!u?.member_id) return fail(403, 'forbidden', 'Only team members can submit standups')
    const b = (await request.json()) as { yesterday: string; today: string; blockers: string; claimed_task_ids: string[] }
    if (!b.yesterday?.trim() || !b.today?.trim()) return fail(422, 'invalid_standup', 'Yesterday and today are required.')
    const mine = new Set(tasks.filter((t) => t.assignee_id === u.member_id).map((t) => t.task_id))
    if (b.claimed_task_ids.some((id) => !mine.has(id))) return fail(403, 'forbidden', 'You can only claim your own tasks.')
    await delay(250)
    return HttpResponse.json(once(request.headers.get('idempotency-key'), () => {
      const row = {
        standup_id: `SU${String(standups.length + 1).padStart(3, '0')}`, team_id: TEAM_ID, member_id: u.member_id!,
        date: new Date().toISOString().slice(0, 10), yesterday: b.yesterday, today: b.today, blockers: b.blockers || 'None',
        claimed_task_ids: b.claimed_task_ids, submitted_at: new Date().toISOString(), source_label: 'synthetic' as const,
      }
      standups.push(row)
      return row
    }), { status: 201 })
  }),
  http.patch('/tasks/:id', async ({ request, params }) => {
    const u = userOf(request)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    const task = tasks.find((t) => t.task_id === params.id)
    if (!task) return fail(404, 'not_found', 'Task not found')
    // Contributors may only update their own tasks; reassignment is never done here (approval-only).
    if (!isAdmin(request) && task.assignee_id !== u.member_id) return fail(403, 'forbidden', 'You can only update your own tasks.')
    const b = (await request.json()) as { status?: string; assignee_id?: string }
    if (b.assignee_id !== undefined) return fail(403, 'forbidden', 'Assignee changes require an approved proposal.')
    if (!['todo', 'in_progress', 'blocked', 'done'].includes(b.status ?? '')) return fail(422, 'invalid_status', 'Unknown status.')
    task.status = b.status!
    task.version += 1
    return HttpResponse.json(task)
  }),
  http.get('/blockers', ({ request }) => {
    const u = userOf(request)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    return HttpResponse.json(page(blockers.filter((x) => isAdmin(request) || x.member_id === u.member_id)))
  }),
  http.post('/blockers', async ({ request }) => {
    const u = userOf(request)
    if (!u?.member_id) return fail(403, 'forbidden', 'Only team members can raise blockers')
    const b = (await request.json()) as { task_id: string | null; description: string }
    if (!b.description?.trim()) return fail(422, 'invalid_blocker', 'Describe the blocker.')
    return HttpResponse.json(once(request.headers.get('idempotency-key'), () => {
      const row = {
        blocker_id: `B${String(blockers.length + 1).padStart(3, '0')}`, team_id: TEAM_ID, member_id: u.member_id!,
        task_id: b.task_id, description: b.description, status: 'open' as const, created_at: new Date().toISOString(), resolved_at: null,
      }
      blockers.push(row)
      return row
    }), { status: 201 })
  }),
  http.patch('/blockers/:id', ({ request, params }) => {
    const u = userOf(request)
    const b = blockers.find((x) => x.blocker_id === params.id)
    if (!u) return fail(401, 'unauthenticated', 'Sign in required')
    if (!b) return fail(404, 'not_found', 'Blocker not found')
    if (!isAdmin(request) && b.member_id !== u.member_id) return fail(403, 'forbidden', 'You can only update your own blockers.')
    b.status = 'resolved'
    b.resolved_at = new Date().toISOString()
    return HttpResponse.json(b)
  }),
  http.get('/reports/weekly', ({ request }) => adminOnly(request) ?? HttpResponse.json(weeklyReport())),
  http.post('/evaluations/run', async ({ request }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    await delay(600)
    return HttpResponse.json(runEvaluations())
  }),
  http.get('/evaluations/results', ({ request }) => adminOnly(request) ?? HttpResponse.json(evaluationResults())),
  http.post('/reliability/simulate/:scenario', async ({ request, params }) => {
    const denied = adminOnly(request)
    if (denied) return denied
    await delay(700)
    const r = simulate(String(params.scenario))
    return r ? HttpResponse.json(r) : fail(404, 'unknown_scenario', 'Unknown scenario')
  }),
  http.get('/notifications', ({ request }) => {
    const u = userOf(request)
    return HttpResponse.json(page(notifications.filter((n) => !u?.member_id || n.member_id === u.member_id)))
  }),
]
