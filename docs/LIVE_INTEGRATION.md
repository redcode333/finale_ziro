# Live backend integration (frontend ⇄ FastAPI)

Status: the core vertical slice runs against the real backend. Everything the backend does not provide yet stays on demo data and is labelled as such in the UI.

## Run it

```
# backend (see backend/README.md): venv, requirements, .env, then
uvicorn app.main:app --port 8000
python -m app.mentor_cli create --team team_fs_001     # prints a mentor token once

# frontend
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

`.env.local`: `VITE_LIVE_API_URL=http://localhost:8000` (empty disables live sign-in), `VITE_LIVE_TEAM_ID`, `VITE_LIVE_PROJECT_ID`.
Sign in: Admin card → paste the mentor token. The token lives in `sessionStorage` (gone when the tab closes) and is sent as `Authorization: Bearer`. A wrong token gets the backend's 401 and is discarded.
Without a token the app runs entirely on mock data (`VITE_USE_MOCKS=true`).

## How it is wired

`frontend/src/api/live.ts` is an adapter. For a mentor-token session, the methods below call the real backend and translate its shapes into the contract shapes the UI already uses; every other call (and every non-mentor session) keeps using the mock layer. Nothing is faked inside the adapter: unsupported calls throw `501 not_supported` and the UI disables the control.

| UI feature | Backend call | Notes |
|---|---|---|
| Sign-in / `/me` | `GET /approvals` (validates the token) | No `/me` endpoint, so identity is synthesised (ADMIN on `VITE_LIVE_TEAM_ID`) |
| Overview, KPIs, risks | `GET /teams/{id}/dashboard`, `/tasks`, `/evidence`, latest run | KPIs are derived client-side; coverage = tasks with any evidence ÷ tasks |
| Start analysis | `POST /agents/analyze` `{team_id, sprint_id, wait:false}` | Run id is remembered locally |
| Run status, stage | `GET /agent-runs/{id}` | `phase` → stage; `running`/`awaiting_approval`/`completed`/`failed` used as is |
| Activity timeline | derived from run detail | See gaps: no events endpoint, no per-step timestamps |
| Tool-call trace | `agent-runs/{id}.tool_calls` | `error` → failed, `partial` shown as Partial |
| LLM trace | `agent-runs/{id}.llm_calls` | Attempt rows grouped by `schema` (ExecutionPlan → planner, AssessmentBatch → assessor); fallback shown when a later provider answered |
| Recommendations / approvals | `GET /approvals` ∪ run `approvals` + `replans` | `approved` → Completed (applied synchronously), `rejected` → Rejected |
| Formal risk review | approval with `replan_id = null` | Shown as its own card type. It must be decided too, or the run never resumes |
| Approve / reject | `POST /approvals/{id}/decision` | Modify is disabled (not supported) |
| Weekly report | `GET /reports/weekly` | Backend `body` mapped to the report page; labelled "rule-based". 404 shows the backend's "no report yet" message |
| Members, tasks, evidence | `GET /teams/{id}/members\|tasks\|evidence` | Evidence fields renamed (`evidence_id`→`id`, `occurred_at`→`observed_at`, …) |

Verified end to end against the real FastAPI app (real routes, schemas, LangGraph run, approval service) with an in-memory database and scripted LLMs: bad token → 401 message; sign-in; Analyze → run executes, timeline/trace fill in; approve risk review and the T008 reassignment → the real assignee changes and the run flips to Completed; the report renders.
**Not yet verified against Supabase, Gemini or Groq**: the harness replaced them, so latencies, real provider errors and RLS behaviour are untested.

## Still on demo data (labelled "not connected to the live backend yet")

| Feature | What the backend would need |
|---|---|
| Claims vs evidence | `GET /teams/{id}/claims` (rules in `API_CONTRACT.md`); risk assessments are per member, not per claim |
| Standup participation / reminders | `GET /teams/{id}/standup-status`, `POST /standups/reminders` |
| Re-plan trigger (mark unavailable) | `POST /sprints/{id}/replan` (the agent only proposes re-plans on its own runs) |
| Team invitations, GitHub OAuth connect | `/projects/{id}/invitations`, `/integrations/github*` |
| Reliability Lab, evaluations | `/reliability/simulate/*`, `/evaluations/*` |
| Contributor portal | Contributor identity and endpoints (standups POST, blockers, task PATCH). The live backend only knows mentors, so contributors sign in with demo identities |
| Modify / retry / pause / resume / stop | Not in the backend |
| Audit trail in the UI | Audit rows are written but there is no read endpoint |

## Findings for the backend owner

1. **Team data is unauthenticated.** `GET /teams/{id}/dashboard|members|tasks|standups|evidence` and `GET /github/activity` take no bearer token and no team scope, unlike the agent routes. Anyone who can reach the API can read every member's email and standups. Add `get_current_mentor` + `require_team_scope`.
2. **Run listing and timestamps.** There is no `GET /agent-runs?team_id=` (the UI recomputes the deterministic run id), and `RunSummary` has no `started_at`/`finished_at`, LLM calls have no timestamp, and tool calls only have `created_at`. A real timeline needs per-node events with timestamps.
3. **Idempotent analyze.** Repeating `POST /agents/analyze` returns the existing run (even a completed one), so a second "Analyze Sprint" click does nothing new. If a fresh run per click is wanted, accept a nonce or `as_of`.
4. **Error envelope.** Errors are `{code, message, detail}`; the contract says `{error: {code, message, request_id, retryable}}`. The adapter handles the backend's shape; the contract should be updated to match.
5. **Impact data.** The UI needs `impact` (before/after workload and checks) per proposal. The backend returns only `capacity_check`/`dependency_check` strings, so the adapter recomputes the arithmetic from members and tasks. Returning it from the backend would make the numbers authoritative.
6. **Per-claim verdicts and a written summary.** The report is rule-based text. If an LLM-written narrative is wanted, return it as `summary.statements[{text, refs}]` (see `API_CONTRACT.md`).
