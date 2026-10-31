# FairSprint AI — Shared Implementation Agreement & API Contract

Status: **DRAFT v0.1 — frozen once both owners sign off at the bottom.**
Source of truth for stack/agent/safety: `FairSprint_TeamPulse_Merged_Hackathon_Plan.pdf` and spec v3.
Changes after freeze go through a PR that edits this file and is reviewed by both owners.

## 1. Frozen decisions

| # | Decision |
|---|----------|
| 1 | Monorepo: `frontend/`, `backend/`, `data/`, `docs/`. One branch per owner (`frontend/*`, `backend/*`), merged to `main` by PR. |
| 2 | Frontend starts on MSW + fixtures derived from `data/synthetic_dataset/`. All HTTP goes through one API client (`frontend/src/api/client.ts`); switching to FastAPI is a base-URL/env change, not a component change. |
| 3 | The merged-plan endpoints are canonical. They are extended (section 4) — there is **no** parallel `/api/agent/*` API. |
| 4 | Auth: Supabase Auth in production, mock auth in early frontend work. Roles are **project-scoped** (`ADMIN` / `CONTRIBUTOR`). The sign-in role card is a navigation preference only; the backend decides. |
| 5 | Live updates: TanStack Query polling every 2 s. SSE may be added later with the same event payload. |
| 6 | Ownership — Person 1: entire frontend (Admin, Agent Center, approval UI, Contributor shell, Reliability Lab UI). Person 2: FastAPI, Supabase/RLS, LangGraph, GitHub, evidence verification, approvals, execution, Reliability Lab APIs. |
| 7 | Priority: 3-hour MVP vertical slice first (standup → evidence → verify → re-plan → approval → mutation → report). Optional features after. |
| 8 | Dark theme, Tailwind, shadcn/ui. Tokens in spec v1 section 11. |
| 9 | Dataset lives in `data/synthetic_dataset/` (15 files, all `source_label=synthetic`). |
| 10 | Tooling: npm, React + Vite + TypeScript, FastAPI, Docker optional. |
| 11 | Approval states: see section 3. Modify is supported by the backend; a modified proposal returns to `pending_review` for approval. |
| 12 | **Approval is not execution.** The UI never shows `completed` until the backend reports the mutation succeeded. |

## 2. Conventions

- JSON, `snake_case` fields, ISO-8601 UTC timestamps, string IDs (e.g. `T010`, `M005`, `RUN001`).
- Every project-scoped route requires an authenticated session and active membership; backend returns `401` / `403`. Never trust a role sent by the browser.
- Mutating requests send `Idempotency-Key` header. Replays return the original result, not a duplicate action.
- Every response carries `X-Request-ID`; errors use:
  ```json
  { "error": { "code": "stale_proposal", "message": "…", "request_id": "…", "retryable": false } }
  ```
- Lists are `{ "items": [...], "next_cursor": null }`.
- Records derived from the dataset keep `source_label` (`synthetic` | `live`). The UI shows a "Synthetic data" badge when it is `synthetic`.
- An API outage / empty source is `unknown` or `insufficient_evidence`, never "zero activity".

## 3. Enumerations (shared by backend and frontend)

**Approval / recommendation status**

| Value | UI label | Meaning |
|-------|----------|---------|
| `pending_review` | Pending review | Awaiting admin decision |
| `approved_execution_pending` | Approved — execution pending | Decision stored; mutation not yet applied |
| `executing` | Executing | Backend applying the change |
| `completed` | Completed | Mutation confirmed and audit written |
| `rejected` | Rejected | Declined; original assignment unchanged |
| `failed` | Failed | Decision kept, mutation failed; safe retry offered |
| `expired` | Expired | No longer actionable (time) |
| `superseded` | Superseded | Replaced or stale data |

Allowed transitions: `pending_review → approved_execution_pending | rejected | expired | superseded`; `approved_execution_pending → executing`; `executing → completed | failed`; `failed → executing` (retry, same idempotency key). **Modify**: `pending_review → (new proposal) pending_review`, old one becomes `superseded` with `superseded_by`.

**Evidence status**: `verified`, `partially_verified`, `unverified`, `insufficient_evidence`.

**Run status**: `queued`, `running`, `awaiting_approval`, `paused`, `completed`, `failed`, `cancelled`. **Run stage**: `plan`, `act`, `observe`, `replan`, `approval`, `execute`, `report`.

**Event status**: `queued`, `running`, `completed`, `failed`, `cancelled`, `timed_out`. Event category: `planning`, `retrieval`, `analysis`, `risk`, `decision`, `approval`, `execution`, `completion`, `failure`.

**Roles**: `ADMIN`, `CONTRIBUTOR`. Membership status: `INVITED`, `ACTIVE`.

## 4. Endpoints

`★` = extension beyond the merged plan. `{team_id}` = project team (dataset: `team_fs_001`).

### 4.1 Canonical (merged plan)

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| GET | `/health` | Liveness | public |
| GET | `/teams/{team_id}/dashboard` | KPIs, sprint health, risks, pending approvals, agent status | member |
| POST | `/standups` | Submit standup | member (own) |
| POST | `/agents/analyze` | Start agent run `{team_id, sprint_id, command?}` → `{run_id}` | ADMIN |
| GET | `/agent-runs/{run_id}` | Run status + trace summary | ADMIN |
| GET | `/approvals` | List approvals (`?status=&team_id=`) | ADMIN |
| POST | `/approvals/{id}/decision` | `{decision: approve\|reject\|modify, reason?, manager_note?, modified_assignee_id?}` | ADMIN |
| POST | `/sprints/{id}/replan` | Request re-plan | ADMIN |
| GET | `/reports/weekly` | Weekly mentor report | ADMIN |
| POST | `/evaluations/run` | Run evaluation suite | ADMIN |
| GET | `/evaluations/results` | Last results | ADMIN |
| POST | `/reliability/simulate/{scenario}` | Test-only simulation, clearly labelled | ADMIN |

### 4.2 Extensions required by the frontend ★

| Method | Path | Purpose |
|--------|------|---------|
| GET ★ | `/me` | Session user + project memberships `[{project_id, team_id, role, status}]`; drives role routing |
| GET ★ | `/agent-runs` | Run history (`?team_id=`, cursor) |
| GET ★ | `/agent-runs/{run_id}/events` | Timeline events; `?after=<cursor>` for polling |
| GET ★ | `/agent-runs/{run_id}/events/{event_id}` | Event detail drawer payload |
| POST ★ | `/agent-runs/{run_id}/pause` · `/resume` · `/stop` · `/retry` | Run controls |
| GET ★ | `/recommendations` · `/recommendations/{id}` | Proposals (a recommendation and its approval share one ID, e.g. `FS-024`) |
| GET ★ | `/recommendations/{id}/evidence` | Supporting evidence records |
| GET ★ | `/teams/{team_id}/evidence` | Evidence explorer (`?member_id=&task_id=&status=`) |
| GET ★ | `/teams/{team_id}/members` · `/tasks` · `/sprints` | Reference data and assignment comparison (workload, capacity, blocked) |
| GET ★ | `/approvals/history` | Decision + audit history |
| POST ★ | `/approvals/{id}/retry` | Retry execution after `failed` |
| GET ★ | `/audit-events` | Audit log (`?entity_id=`), ADMIN |
| GET ★ | `/notifications` | Own notifications |
| GET ★ | `/standups` | Own standups (contributor) or all (admin) |
| GET ★ · POST ★ | `/blockers` | List (own for contributors) · raise `{task_id?, description}` |
| PATCH ★ | `/blockers/{id}` | Resolve own blocker `{status: "resolved"}` |
| PATCH ★ | `/tasks/{id}` | Contributor updates own task `{status}`. Any `assignee_id` in the body is rejected with 403 (reassignment is approval-only) |

**Server-side scoping (contributors):** `/teams/{id}/tasks`, `/evidence`, `/members` and `/standups` return only the caller's own records; `risks` in the dashboard are admin-only. `POST /standups` rejects claims on tasks the caller does not own (403) and is idempotent on `Idempotency-Key`.
| GET ★ · POST ★ | `/projects/{id}/invitations` | List · create `{email}` → `Invitation {invitation_id, email, role: CONTRIBUTOR, status: pending\|accepted\|revoked\|expired, expires_at}`. `422 invalid_email`, `409 already_member`, `409 already_invited` |
| DELETE ★ | `/invitations/{id}` | Revoke a pending invitation (`409 not_pending` otherwise) |
| POST ★ | `/invitations/{token}/accept` | Accept (single-use, expiring). Not built in the frontend yet |

Backend owns `PATCH /tasks/{id}/assignee` only as an internal mutation node; the UI changes owners exclusively via an approval decision.

### 4.3 Decision request/response (key flow)

```json
POST /approvals/AP001/decision
{ "decision": "approve", "manager_note": "Redistributing workload",
  "expected_version": 3 }
→ 200
{ "approval_id": "AP001", "status": "approved_execution_pending",
  "task_id": "T008", "previous_assignee_id": "M007", "new_assignee_id": "M002",
  "reviewed_by": "MENTOR001", "reviewed_at": "…", "execution_status": "pending" }
```

- `expected_version` mismatch or stale proposal → `409 stale_proposal`; UI disables Approve and asks for refresh.
- Reject requires `reason`. Modify requires `modified_assignee_id`, returns the **new** proposal in `pending_review`.
- UI polls `GET /approvals/{id}` / `/agent-runs/{run_id}` until `completed` or `failed`.

### 4.4 Event payload (stable for polling and future SSE)

```json
{ "id": "EV-0012", "run_id": "RUN002", "parent_event_id": null, "cursor": "0012",
  "category": "retrieval", "title": "Retrieved commits and pull requests",
  "status": "completed", "timestamp": "…", "duration_ms": 412, "retries": 0,
  "tool": "github_adapter", "input_summary": "…", "output_summary": "14 events",
  "evidence_ids": ["GH001"], "error": null, "source_label": "synthetic" }
```

No secrets or model chain-of-thought in inputs/outputs.

## 5. Core data shapes (TypeScript names used by the frontend)

Dataset CSV columns map 1:1; additions are marked ★.

- `Member`: `member_id, team_id, name, email, github_username, role, skills[], weekly_capacity_hours, availability_status`
- `Sprint`: `sprint_id, team_id, project_id, name, goal, start_date, end_date, status, capacity_hours`
- `Task`: `task_id, team_id, project_id, sprint_id, title, assignee_id, status, priority, estimate_hours, due_date, dependency_task_ids[], workstream, version ★`
- `Standup`: `standup_id, team_id, member_id, date, yesterday, today, blockers, claimed_task_ids[], submitted_at, source_label`
- `Worklog`, `GithubEvent`: as in CSVs (`GithubEvent.source_url` is a placeholder in synthetic data).
- `RiskAssessment`: `assessment_id, member_id, run_id, status, risk_level, summary, evidence_ids[], missing_context, recommended_action`
- `Replan` / `Recommendation`: `replan_id, task_id, current_assignee_id, proposed_assignee_id, trigger_reason, capacity_check, dependency_check, rationale, proposal_status` plus ★ `recommendation_id, approval_id, expected_impact, potential_downside, version, expires_at, superseded_by`
- `Approval`: `approval_id, team_id, run_id, replan_id, requested_by, reviewer_id, status, decision_reason, created_at` plus ★ `decided_at, manager_note, execution_status, version`
- `AuditEvent`: `audit_event_id, run_id, actor_id, action, target_id, before_json, after_json, reason, created_at, request_id ★`
- `ToolCallLog`: `tool_call_id, run_id, tool_name, status, latency_ms, result_count, source_label` (★ `endpoint`, `http_status` for real calls)

Delimited CSV fields (`;`) become arrays in the API.

## 6. Dataset ↔ contract mapping (to confirm)

| Dataset value | Contract value |
|---------------|----------------|
| approval `pending` | `pending_review` |
| replan `pending_approval` | `pending_review`; replan `draft` = not yet submitted for approval (no approval row) |
| risk `verified_contribution`, `review_required` | Evidence status `verified` with `risk_level`; `risk_level` ∈ `none, low, medium, review_required, high` |
| `MENTOR001` reviewer | An `ADMIN` membership; absent from `team_members.csv`, so add a users/memberships fixture |

## 7. Frontend mock layer (Person 1)

- `frontend/src/api/` — typed client, one function per endpoint above, reading `VITE_API_BASE_URL`.
- `frontend/src/mocks/` — MSW handlers returning dataset-derived fixtures; a stateful in-memory store so approve/reject/modify and run progress behave realistically (including `executing → completed` and an injectable failure).
- Fixtures are generated from `data/synthetic_dataset/dataset.json`; no hand-copied data.

## 8. Open items to settle together

1. Evaluation case count: dataset has 20 (`E01–E20`), plan says 18.
2. Is `expected_version` (optimistic concurrency) accepted as specified in 4.3?
3. Event cursor format and whether `GET /agent-runs/{id}` embeds the latest events.
4. Where contributor-scoped AI assistance lives (post-MVP; no endpoint yet).

## 9. Added during frontend build (please review)

- Contributor endpoints above (standups list, blockers list, task status PATCH) and the scoping rules.
- `GET /reports/weekly` returns `{summary, progress, blockers, discrepancies, contributions, recommendations, basis: "persisted_records"}`.
- **Mentor summary (report writer).** `summary` is `null` until generated, then `{statements: [{text, refs: string[]}], generated_at, provider, model, sample}`. `refs` are IDs of the stored records the statement is based on (tasks `T…`, evidence `GH…/W…/SU…`, assessments `RA…`, approvals `AP…`); the UI links evidence IDs to the evidence explorer. `sample: true` marks mock text (not a model).
- `POST /reports/weekly/generate?team_id=` (ADMIN) runs the report-writer node and returns the full report with `summary` filled. On provider failure return `503 {error.code: "llm_unavailable"}`; the UI then keeps showing the stored-record facts and offers a retry. The backend must write only from persisted records and must not invent figures or accuse anyone. The report must always be re-derivable from the facts sections.
- `POST /evaluations/run` and `GET /evaluations/results` return `{mode: "mock"|"live", cases[], metrics{}}`. Metrics are `null` until a real run computes them. The mock never marks a case as passed.
- `POST /reliability/simulate/{scenario}` returns `{simulated: true, steps[], outcome, assertions[]}`. Scenarios: `unauthorized_reassignment`, `llm_timeout_fallback`, `both_llm_down`, `github_503`, `prompt_injection`, `duplicate_event`.
- Event `status` for the "waiting for approval" event: the mock sends `running`; the UI renders it as amber Pending without a pulse. A distinct state would be cleaner.

### Standup participation (silent members)

`GET /teams/{team_id}/standup-status?date=YYYY-MM-DD` (ADMIN; default today) returns
`{date, min_date, max_date, expected, submitted, members: [{member_id, state: submitted|missing|silent|unavailable, submitted_at, missed_days, other_activity: [{id, source_type, title}], last_activity_at, reminder_sent}]}`.

- Only a submitted standup counts as `submitted`. Other activity (commits, reviews, worklogs) is **context**, never a substitute.
- `unavailable`: no standup and the member's availability is not `available`.
- `silent`: `missed_days >= 2` consecutive days **and** no other recorded activity in that streak. Anything else without a standup is `missing`.
- A missing or silent member is never described as inactive or a free-rider (dataset case E08: missing standup alone => `insufficient_evidence`).

`POST /standups/reminders {member_id, date}` (ADMIN) returns `{created: boolean}`. Idempotent per member + day: a repeat returns `created: false` and sends no second notification (dataset case E16).

### Claims vs evidence

`GET /teams/{team_id}/claims?member_id=` (ADMIN) returns `Page<Claim>`:
`{claim_id, standup_id, member_id, task_id, task_title, task_owner_id, task_status, kind: "completed"|"worked_on", claim_text, claimed_at, verification: verified|partially_verified|unverified|insufficient_evidence, explanation, gaps: string[], matched_evidence: EvidenceRecord[]}`.

One row per (standup, claimed task). The backend's **deterministic verifier** must produce `verification`; the LLM may only add wording. The mock uses these rules, which the real verifier should match or improve on:
- Match by member + task. A standup that only announces unavailability is not a work claim.
- Evidence is *substantive* unless it is an empty commit message, a zero-hour worklog, or a worklog saying no artifact exists.
- Task not owned by the claimant, or no records at all: `insufficient_evidence` (never "no work").
- Records exist but none substantive: `unverified`.
- A completion claim on a task not marked done: at most `partially_verified`.
- Otherwise artifact + worklog: `verified`; one of them: `partially_verified`.
The UI always shows these as questions for the member, never as findings of misconduct.

### GitHub connection (both portals)

| Method | Path | Purpose |
|--------|------|---------|
| GET ★ | `/integrations/github?scope=project\|me` | `GithubConnection {scope, status: connected\|disconnected\|error, account_login, repository_url, connected_at, last_synced_at, error}`. `project` is admin-only (403 otherwise); `me` is the caller's own link |
| POST ★ | `/integrations/github/connect` | Body `{scope, return_to}` returns `{authorize_url}`. The browser navigates to it |
| DELETE ★ | `/integrations/github?scope=` | Disconnect |

- The OAuth code exchange happens in the **backend callback**; the token is stored server-side only and never reaches the browser.
- `return_to` must be a same-origin relative path. The backend validates it (reject `//host` and absolute URLs) and redirects to `{return_to}?github=connected|cancelled|error`; the frontend shows a toast and refetches.
- Not connecting a personal GitHub account must never be treated as inactivity.
- The mock serves a development-only consent page at `/mock/github-consent` (registered only when `VITE_USE_MOCKS=true`).

## 10. Sign-off

- [ ] Person 1 (frontend)
- [ ] Person 2 (backend)
