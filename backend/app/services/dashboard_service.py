import logging
from collections import Counter
from typing import Any

from pydantic import BaseModel

from app.database import get_supabase
from app.errors import AppError, NotFoundError
from app.schemas.dashboard import DashboardResponse, SprintSummary, TaskStats, TeamSummary
from app.schemas.data import ListResponse, Member

logger = logging.getLogger("fairsprint.team")


def _db_call(fn):
    """Run a Supabase call, translating driver errors into AppError."""
    try:
        return fn()
    except AppError:
        raise
    except Exception as exc:
        logger.exception("Supabase query failed")
        raise AppError(f"Database query failed: {exc}") from exc


def require_team(team_id: str) -> dict[str, Any]:
    rows = _db_call(lambda: get_supabase().table("teams").select("*").eq("team_id", team_id).limit(1).execute().data)
    if not rows:
        raise NotFoundError(f"Team {team_id} not found")
    return rows[0]


def list_team_items(table: str, model: type[BaseModel], team_id: str, *, filters: dict[str, Any] | None = None,
                    order: str | None = None, desc: bool = False, limit: int = 100, offset: int = 0) -> ListResponse:
    require_team(team_id)

    def query():
        q = get_supabase().table(table).select("*").eq("team_id", team_id)
        for col, val in (filters or {}).items():
            if val is not None:
                q = q.eq(col, val)
        if order:
            q = q.order(order, desc=desc)
        return q.range(offset, offset + limit - 1).execute().data or []

    rows = _db_call(query)
    return ListResponse(team_id=team_id, count=len(rows), items=[model.model_validate(r) for r in rows])


def get_team_dashboard(team_id: str) -> DashboardResponse:
    team = require_team(team_id)
    db = get_supabase()
    members = _db_call(lambda: db.table("team_members").select("*").eq("team_id", team_id).execute().data) or []
    tasks = _db_call(lambda: db.table("tasks").select("status,source_label").eq("team_id", team_id).execute().data) or []
    sprints = _db_call(lambda: db.table("sprints").select("*").eq("team_id", team_id).eq("status", "active").limit(1).execute().data)
    approvals = _db_call(lambda: db.table("approval_queue").select("approval_id").eq("team_id", team_id).eq("status", "pending").execute().data) or []
    evidence = _db_call(lambda: db.table("evidence").select("source_label").eq("team_id", team_id).execute().data) or []

    by_label = dict(Counter(e["source_label"] for e in evidence))
    return DashboardResponse(
        team=TeamSummary(id=team_id, name=team.get("name")),
        members=[Member.model_validate(m) for m in members],
        tasks=TaskStats(total=len(tasks), by_status=dict(Counter(t.get("status") or "unknown" for t in tasks))),
        active_sprint=SprintSummary(**{k: (str(v) if k.endswith("_date") and v else v) for k, v in sprints[0].items()
                                       if k in SprintSummary.model_fields}) if sprints else None,
        pending_approvals=len(approvals),
        evidence_by_source_label=by_label,
        contains_synthetic_data=team.get("source_label") == "synthetic" or "synthetic" in by_label,
    )
