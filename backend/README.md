# FairSprint AI – Backend

FastAPI backend for FairSprint AI (repo: https://github.com/redcode333/finale_ziro). The React + Vite frontend lives separately.

## Setup
```
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # then fill in values
uvicorn app.main:app --reload --port 8000
```
Docs: http://localhost:8000/docs

## Endpoints
- `GET /health`
- `GET /teams/{team_id}/dashboard` – assumes Supabase tables `teams`, `team_members`, `tasks` (with `team_id`, `tasks.status`). Adjust in `app/services/dashboard_service.py` to your schema.

## M2: database, seed data, GitHub
1. Run `migrations/001_fairsprint_schema.sql` in the Supabase SQL Editor.
2. Seed the synthetic demo data (idempotent, never automatic): `python -m app.seed` (add `--dry-run` to validate only),
   or `POST /teams/team_fs_001/seed` with header `X-Admin-Token: <SEED_ADMIN_TOKEN>`.
3. Endpoints: `/teams/{id}/dashboard|members|tasks|standups|evidence`, `/github/activity` (live, read-only).
4. Checks: `python tests/run_m2_checks.py` (offline) or `--live` (real GitHub + Supabase).

Every row has `source_label` = `synthetic` (fixture) or `live`. Synthetic GitHub events are fixtures, not API results.
If GitHub fails, `/github/activity` returns `source_status: unavailable|partial`, never zero activity.

## M3: agent (LangGraph)
1. Run `migrations/002_agent_runtime.sql` in the Supabase SQL Editor (adds run-state columns + `mentors`).
2. Create a mentor token (printed once): `python -m app.mentor_cli create --team team_fs_001`
3. `uvicorn app.main:app --port 8000`, then (token as `Authorization: Bearer <token>`):
   - `POST /agents/analyze` `{"team_id":"team_fs_001","sprint_id":"SP001","wait":true}` -> run pauses at `awaiting_approval`
   - `GET /agent-runs/{run_id}`, `GET /approvals`, `POST /approvals/{id}/decision` `{"decision":"approve"}`, `GET /reports/weekly`
4. Tests: `pytest tests` (mocked, deterministic). Real-service check: `python tests/live_checks.py`.
Dataset fixtures AP001/AP002 are also pending approvals for the seeded team; approving them applies the fixture replans.
LLM: Gemini primary (`GEMINI_MODEL`), Groq fallback (`GROQ_MODEL`). The LLM is advisory; statuses are deterministic.

## Environment variables
`SEED_ADMIN_TOKEN` enables the seed endpoint (disabled when empty).
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required for the dashboard), `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GEMINI_API_KEY`, `OPENAI_API_KEY` (future milestones).
Optional: `CORS_ORIGINS` (comma-separated, default `http://localhost:5173`), `LOG_LEVEL`.

The service-role key is server-only: never put it in the frontend or commit `.env`.

## Layout
`app/routes` HTTP routes · `app/schemas` Pydantic models · `app/services` business logic · `app/tools` future GitHub tools · `app/agents` future LangGraph agents.

## Human verification (Cloudflare Turnstile)

Mentor sign-in goes through `POST /auth/mentor-login` (mentor token as the bearer token, `{"turnstile_token": ...}` in the body).
With `TURNSTILE_ENABLED=true` the Turnstile token is verified server-side with Cloudflare **before** the mentor token is checked;
anything but a fresh, valid token for an allowed hostname (`TURNSTILE_ALLOWED_HOSTNAMES`) is rejected, and so is a Cloudflare outage
or a missing `TURNSTILE_SECRET_KEY`. With `TURNSTILE_ENABLED=false` (the default) only the mentor token is checked.
