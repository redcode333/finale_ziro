import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query

from app.auth import scoped_to_team
from app.config import get_settings
from app.errors import AppError
from app.schemas.dashboard import DashboardResponse
from app.schemas.data import Evidence, ListResponse, Member, Standup, Task
from app.schemas.seed import SeedResponse
from app.services.dashboard_service import get_team_dashboard, list_team_items
from app.services.seed_service import run_seed

router = APIRouter(prefix="/teams", tags=["teams"])
TeamScoped = [Depends(scoped_to_team)]  # mentor bearer token for this team; the seed route keeps its own X-Admin-Token

Limit = Annotated[int, Query(ge=1, le=500, description="Page size")]
Offset = Annotated[int, Query(ge=0, description="Rows to skip")]


@router.get("/{team_id}/dashboard", response_model=DashboardResponse, dependencies=TeamScoped)
def team_dashboard(team_id: str) -> DashboardResponse:
    return get_team_dashboard(team_id)


@router.get("/{team_id}/members", response_model=ListResponse[Member], dependencies=TeamScoped)
def team_members(team_id: str, limit: Limit = 100, offset: Offset = 0):
    return list_team_items("team_members", Member, team_id, order="member_id", limit=limit, offset=offset)


@router.get("/{team_id}/tasks", response_model=ListResponse[Task], dependencies=TeamScoped)
def team_tasks(team_id: str, status: str | None = None, sprint_id: str | None = None,
               assignee_id: str | None = None, limit: Limit = 200, offset: Offset = 0):
    return list_team_items("tasks", Task, team_id, order="task_id", limit=limit, offset=offset,
                           filters={"status": status, "sprint_id": sprint_id, "assignee_id": assignee_id})


@router.get("/{team_id}/standups", response_model=ListResponse[Standup], dependencies=TeamScoped)
def team_standups(team_id: str, member_id: str | None = None, limit: Limit = 100, offset: Offset = 0):
    return list_team_items("standups", Standup, team_id, order="date", desc=True, limit=limit, offset=offset,
                           filters={"member_id": member_id})


@router.get("/{team_id}/evidence", response_model=ListResponse[Evidence], dependencies=TeamScoped,
            description="Normalized evidence. `source_label` is `synthetic` for fixtures and `live` for GitHub API data.")
def team_evidence(team_id: str, source_label: Literal["synthetic", "live"] | None = None,
                  member_id: str | None = None, task_id: str | None = None, evidence_type: str | None = None,
                  limit: Limit = 200, offset: Offset = 0):
    return list_team_items("evidence", Evidence, team_id, order="occurred_at", desc=True, limit=limit, offset=offset,
                           filters={"source_label": source_label, "member_id": member_id, "task_id": task_id,
                                    "evidence_type": evidence_type})


@router.post("/{team_id}/seed", response_model=SeedResponse, tags=["admin"],
             description="Idempotently imports the synthetic demo dataset. Requires the `X-Admin-Token` header "
                         "matching SEED_ADMIN_TOKEN; disabled when that variable is unset.")
def seed_team(team_id: str, dry_run: bool = False, x_admin_token: Annotated[str | None, Header()] = None):
    expected = get_settings().seed_admin_token
    if not expected:
        raise AppError("Seeding is disabled: set SEED_ADMIN_TOKEN in backend/.env to enable it.", status_code=403, code="seed_disabled")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, expected):
        raise AppError("Invalid or missing X-Admin-Token.", status_code=401, code="unauthorized")
    return run_seed(team_id, dry_run=dry_run)
