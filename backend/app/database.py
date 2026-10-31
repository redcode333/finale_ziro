import logging
from functools import lru_cache

import httpx
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from app.config import get_settings
from app.errors import ServiceUnavailableError

logger = logging.getLogger("fairsprint.database")


def _http_client() -> httpx.Client:
    """Plain HTTP/1.1 with a connection pool.

    The client below is cached and shared by every request thread. PostgREST's default is HTTP/2, which multiplexes all
    requests over ONE connection; under concurrent requests that connection fails with
    `httpx.ReadError: [Errno 11] Resource temporarily unavailable` (about 3% of requests under a mixed load) and the
    request becomes a 500. A pool of HTTP/1.1 connections is safe across threads. The short keep-alive recycles idle
    connections before a NAT or proxy (for example Docker Desktop) silently drops them.
    """
    return httpx.Client(
        http2=False,
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=20.0),
    )


@lru_cache
def get_supabase() -> Client:
    """Server-side Supabase client using the service-role key. Never send this key to the frontend."""
    settings = get_settings()
    if not settings.supabase_configured:
        raise ServiceUnavailableError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env."
        )
    logger.info("Creating Supabase client")
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=SyncClientOptions(httpx_client=_http_client()),
    )
