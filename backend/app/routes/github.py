from typing import Annotated

from fastapi import APIRouter, Query

from app.schemas.github import GitHubActivityResponse
from app.services.github_service import collect_activity

router = APIRouter(prefix="/github", tags=["github"])


@router.get("/activity", response_model=GitHubActivityResponse,
            description="Live, read-only GitHub activity for the configured repository, normalized to evidence "
                        "(source_label=live). If GitHub is unreachable, source_status is `unavailable`; that is never "
                        "evidence of zero contribution. Always returns HTTP 200 with the status in the body.")
def github_activity(since_days: Annotated[int, Query(ge=1, le=90)] = 14, team_id: str | None = None):
    return collect_activity(since_days=since_days, team_id=team_id)
