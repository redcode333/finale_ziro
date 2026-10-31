from pydantic import BaseModel, Field

from app.schemas.data import Member


class TeamSummary(BaseModel):
    id: str
    name: str | None = None


class TaskStats(BaseModel):
    total: int = 0
    by_status: dict[str, int] = Field(default_factory=dict)


class SprintSummary(BaseModel):
    sprint_id: str
    name: str
    goal: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    capacity_hours: float | None = None


class DashboardResponse(BaseModel):
    team: TeamSummary
    members: list[Member] = Field(default_factory=list)
    tasks: TaskStats = Field(default_factory=TaskStats)
    active_sprint: SprintSummary | None = None
    pending_approvals: int = 0
    evidence_by_source_label: dict[str, int] = Field(default_factory=dict)
    contains_synthetic_data: bool = False
