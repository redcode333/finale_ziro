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
| Tool-call trace | `GET /agent-runs/{id}/tool-calls` | Served by the backend. Fields it does not record (`operation`, `scope`, `retries`, `http_status`) arrive as null and show as "not recorded" |
| LLM trace | `GET /agent-runs/{id}/llm-calls` | Served by the backend: every provider attempt in order, fallback reason, `schema_valid`; tokens are null (not captured) |
| Recommendations / approvals | `GET /approvals` ∪ run `approvals` + `replans` | `approved` → Completed (applied synchronously), `rejected` → Rejected |
| Formal risk review | approval with `replan_id = null` | Shown as its own card type. It must be decided too, or the run never resumes |
| Approve / reject | `POST /approvals/{id}/decision` | Modify is disabled (not supported) |
| Standup participation | `GET /teams/{id}/standups`, `/members`, `/evidence` | Computed in the browser (`frontend/src/lib/participation.ts`) because the backend has no `standup-status` endpoint. Default day is the latest day with a standup. When the backend serves `GET /teams/{id}/standup-status`, the adapter should call it instead |
| Weekly report | `GET /reports/weekly` | Backend `body` mapped to the report page; labelled "rule-based". 404 shows the backend's "no report yet" message |
| Members, tasks, evidence | `GET /teams/{id}/members\|tasks\|evidence` | Evidence fields renamed (`evidence_id`→`id`, `occurred_at`→`observed_at`, …) |

Verified end to end against the real FastAPI app (real routes, schemas, LangGraph run, approval service) with an in-memory database and scripted LLMs: bad token → 401 message; sign-in; Analyze → run executes, timeline/trace fill in; approve risk review and the T008 reassignment → the real assignee changes and the run flips to Completed; the report renders.
**Not yet verified against Supabase, Gemini or Groq**: the harness replaced them, so latencies, real provider errors and RLS behaviour are untested.

## Still on demo data (labelled "not connected to the live backend yet")

| Feature | What the backend would need |
|---|---|
| Claims vs evidence | `GET /teams/{id}/claims` (rules in `API_CONTRACT.md`); risk assessments are per member, not per claim |
| Standup reminders | `POST /standups/reminders` (the UI disables the button in a live session) |
| Re-plan trigger (mark unavailable) | `POST /sprints/{id}/replan` (the agent only proposes re-plans on its own runs) |
| Team invitations, GitHub OAuth connect | `/projects/{id}/invitations`, `/integrations/github*` |
| Reliability Lab, evaluations | `/reliability/simulate/*`, `/evaluations/*` |
| Contributor portal | Contributor identity and endpoints (standups POST, blockers, task PATCH). The live backend only knows mentors, so contributors sign in with demo identities |
| Modify / retry / pause / resume / stop | Not in the backend |
| Audit trail in the UI | Audit rows are written but there is no read endpoint |

## Findings for the backend owner

1. **Team data now requires a mentor token (fixed).** `GET /teams/{id}/dashboard|members|tasks|standups|evidence` and `GET /github/activity` return 401 without a valid mentor bearer token and 403 for another team's mentor (an unknown team answers the same 403, so teams cannot be enumerated). `/health` stays public and `POST /teams/{id}/seed` keeps its own `X-Admin-Token`.
2. **Run listing and timeline.** There is no `GET /agent-runs?team_id=` (the UI recomputes the deterministic run id), `RunSummary` has no `started_at`/`finished_at`, and there is no events endpoint, so the timeline is derived from the run detail (`phase`, tool calls, LLM calls) without per-step timestamps. Tool and LLM traces now come from the new trace endpoints.
3. **Idempotent analyze.** Repeating `POST /agents/analyze` returns the existing run (even a completed one), so a second "Analyze Sprint" click does nothing new. If a fresh run per click is wanted, accept a nonce or `as_of`.
4. **Error envelope.** Errors are `{code, message, detail}`; the contract says `{error: {code, message, request_id, retryable}}`. The adapter handles the backend's shape; the contract should be updated to match.
5. **Impact data.** The UI needs `impact` (before/after workload and checks) per proposal. The backend returns only `capacity_check`/`dependency_check` strings, so the adapter recomputes the arithmetic from members and tasks. Returning it from the backend would make the numbers authoritative.
6. **Per-claim verdicts and a written summary.** The report is rule-based text. If an LLM-written narrative is wanted, return it as `summary.statements[{text, refs}]` (see `API_CONTRACT.md`).

## Cloudflare Turnstile on mentor sign-in

Sign-in has no login endpoint of its own in the mentor-token flow, so the backend adds `POST /auth/mentor-login`: the Turnstile token
is checked first (so the endpoint cannot be used to probe which mentor tokens are valid), then the mentor token. Other API
calls are unchanged. Contributor sign-in is a demo identity with no backend, so it has no widget.

Render environment variables (Web Service → Environment):

| Variable | Value | Notes |
|---|---|---|
| `TURNSTILE_ENABLED` | `true` | Backend. Anything else disables the check. |
| `TURNSTILE_SECRET_KEY` | secret from Cloudflare | Backend only. Never a `VITE_` variable. Mark it as a secret. |
| `TURNSTILE_ALLOWED_HOSTNAMES` | `finale-ziro-h79s.onrender.com` | Optional; this is the default. |
| `VITE_TURNSTILE_SITE_KEY` | site key from Cloudflare | Public. Read at **build** time: redeploy after changing it. |

In the Cloudflare dashboard create a Turnstile widget (Managed mode) whose allowed hostname is `finale-ziro-h79s.onrender.com`.
Locally leave `TURNSTILE_ENABLED=false` and `VITE_TURNSTILE_SITE_KEY` empty. To try the real widget locally use Cloudflare's
test keys, add `localhost` to `TURNSTILE_ALLOWED_HOSTNAMES` and set both keys in `backend/.env` and `frontend/.env.local`.

## The Agent Center command bar

The bar at the bottom only starts the sprint analysis (`POST /agents/analyze` takes a team and a sprint, no prompt). It has no text box, because typed text would be discarded. Pressing the button on a sprint that already has a run returns that run (the backend derives the run id from the request), and the UI says so.
