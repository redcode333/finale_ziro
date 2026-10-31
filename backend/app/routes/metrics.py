import secrets
from typing import Annotated

from fastapi import APIRouter, Header
from fastapi.responses import PlainTextResponse

from app.config import get_settings
from app.errors import AppError
from app.metrics import REGISTRY

router = APIRouter(tags=["ops"])


@router.get("/metrics", include_in_schema=False, response_class=PlainTextResponse)
def metrics(authorization: Annotated[str | None, Header()] = None) -> PlainTextResponse:
    """Prometheus text format. When METRICS_TOKEN is set, a matching `Authorization: Bearer <token>` is required."""
    token = get_settings().metrics_token
    if token:
        scheme, _, given = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not secrets.compare_digest(given.strip().encode(), token.encode()):
            raise AppError("Metrics require a valid bearer token.", status_code=401, code="unauthorized")
    return PlainTextResponse(REGISTRY.render(), media_type="text/plain; version=0.0.4; charset=utf-8")
