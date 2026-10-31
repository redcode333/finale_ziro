import logging
from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings
from app.errors import ServiceUnavailableError

logger = logging.getLogger("fairsprint.database")


@lru_cache
def get_supabase() -> Client:
    """Server-side Supabase client using the service-role key. Never send this key to the frontend."""
    settings = get_settings()
    if not settings.supabase_configured:
        raise ServiceUnavailableError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env."
        )
    logger.info("Creating Supabase client")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
