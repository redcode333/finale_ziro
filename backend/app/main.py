import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_error_handlers
from app.logging_config import setup_logging
from app.metrics import MetricsMiddleware
from app.routes import agents, auth, github, health, metrics, teams
from app.spa import mount_spa

settings = get_settings()
setup_logging(settings.log_level)
logger = logging.getLogger("fairsprint")

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added last so it is the outermost user middleware and times everything, including CORS handling.
app.add_middleware(MetricsMiddleware)

register_error_handlers(app)
app.include_router(health.router)
app.include_router(metrics.router)
app.include_router(teams.router)
app.include_router(github.router)
app.include_router(agents.router)
app.include_router(auth.router)

# One service, one URL: when the frontend build exists it is served at "/" (after all API routes, so they take precedence).
# Without a build (local API-only runs, tests) "/" keeps returning the JSON status below.
_dist = Path(settings.frontend_dist_dir) if settings.frontend_dist_dir else Path(__file__).resolve().parents[2] / "frontend" / "dist"
if mount_spa(app, _dist):
    logger.info("Serving the frontend build from %s", _dist)
else:
    logger.warning("No frontend build at %s: serving the API only. Build it first (cd frontend && npm ci && npm run build) "
                   "and make sure the service can see the frontend/ folder.", _dist)

    @app.get("/", tags=["root"])
    def root() -> dict[str, str]:
        return {"name": settings.app_name, "status": "running", "docs": "/docs", "health": "/health"}

if settings.turnstile_enabled and not settings.turnstile_secret_key:
    logger.error("TURNSTILE_ENABLED=true but TURNSTILE_SECRET_KEY is empty: protected actions will be rejected (fail closed)")

logger.info("%s backend initialised (supabase_configured=%s)", settings.app_name, settings.supabase_configured)
