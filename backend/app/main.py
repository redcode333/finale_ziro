import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_error_handlers
from app.logging_config import setup_logging
from app.routes import agents, github, health, teams

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

@app.get("/", tags=["root"])
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "running", "docs": "/docs", "health": "/health"}


register_error_handlers(app)
app.include_router(health.router)
app.include_router(teams.router)
app.include_router(github.router)
app.include_router(agents.router)

logger.info("%s backend initialised (supabase_configured=%s)", settings.app_name, settings.supabase_configured)
