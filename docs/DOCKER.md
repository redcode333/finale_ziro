# Running FairSprint AI with Docker

Two images, one compose file:

| Service | Image | Port | What it is |
|---|---|---|---|
| `backend` | `python:3.13-slim` + FastAPI/uvicorn, runs as a non-root user | 8000 | API and LangGraph agent. API docs at `/docs` |
| `frontend` | Node build stage, then `nginx:1.27-alpine` | 8080 | Static React app with single-page-app routing |

## Run it

```
cp backend/.env.example backend/.env     # then fill in your values (Supabase, Gemini, Groq, GitHub)
docker compose up --build
```

Open http://localhost:8080 and sign in as Admin with a mentor token (see below). Stop with `docker compose down`.

`backend/.env` is read **at runtime** through `env_file` and is never copied into an image (`backend/.dockerignore` excludes it). The images contain no secrets.

## Mentor token

The token is created in the same container image, against the database named in `backend/.env`:

```
docker compose run --rm backend python -m app.mentor_cli create --team team_fs_001 --mentor-id MENTOR_FE --name "Frontend Demo Mentor"
```

The CLI **upserts by `--mentor-id`** (default `MENTOR001`). Always pass a new id, or you replace that mentor's token and break anyone using the old one. To deactivate one: `update mentors set active = false where mentor_id = 'MENTOR_FE';` in the Supabase SQL editor.

## Settings

| Where | What |
|---|---|
| `backend/.env` | All backend settings and keys |
| compose `environment` | Forces `PORT=8000` and `CORS_ORIGINS` (default `http://localhost:8080,http://127.0.0.1:8080`) so the frontend's origin is allowed. Override with a `CORS_ORIGINS` shell variable or a root `.env` |
| compose build args | `VITE_USE_MOCKS`, `VITE_LIVE_API_URL`, `VITE_LIVE_TEAM_ID`, `VITE_LIVE_PROJECT_ID` |

**Vite inlines `VITE_*` values into the bundle at build time.** Changing them needs a rebuild (`docker compose build frontend`). `VITE_LIVE_API_URL` must be a URL the *browser* can reach (not a Docker-internal name like `http://backend:8000`). They are public: never put secrets or tokens in them.

## Notes and limits

- **Seeding** is not done by the container: the seeder reads `FairSprint_AI_Gold_Synthetic_Dataset_v2.zip` from the project root, which is git-ignored and not in the image. Seed once from your machine (`python -m app.seed` from `backend/`) or mount the zip and set `SEED_ZIP_PATH`.
- **Healthchecks:** the backend answers `/health`; the frontend waits for it (`depends_on: service_healthy`).
- **Frontend image** includes the demo dataset (`dataset.json`) because the mock layer imports it. That is the known "mock data in the production bundle" item.
- **TLS and a public URL:** the compose file serves plain HTTP for local use. In production put a TLS-terminating proxy in front and rebuild the frontend with the public API URL.
- **Hosting:** the backend Dockerfile honours `$PORT` (Render and similar set their own). The frontend build needs the repo root as context, so a static-site host must build with `cd frontend && npm ci && npm run build` from the repo root, or use the frontend Dockerfile.
- Compose prints interpolated config with `docker compose config`, which can include values from `env_file`. Use `--quiet` to only validate.
