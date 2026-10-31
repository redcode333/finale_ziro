from datetime import date, datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

SourceLabel = Literal["synthetic", "live"]
T = TypeVar("T")


class ListResponse(BaseModel, Generic[T]):
    """Consistent envelope for list endpoints."""

    team_id: str
    count: int
    items: list[T]


class Member(BaseModel):
    member_id: str
    team_id: str
    name: str
    email: str | None = None
    github_username: str | None = None
    role: str | None = None
    skills: list[str] = Field(default_factory=list)
    weekly_capacity_hours: float = 0
    availability_status: str = "available"
    source_label: SourceLabel = "live"


class Task(BaseModel):
    task_id: str
    team_id: str
    project_id: str
    sprint_id: str | None = None
    title: str
    assignee_id: str | None = None
    status: str
    priority: str
    estimate_hours: float | None = None
    due_date: date | None = None
    dependency_task_ids: list[str] = Field(default_factory=list)
    workstream: str | None = None
    source_label: SourceLabel = "live"


class Standup(BaseModel):
    standup_id: str
    team_id: str
    member_id: str
    date: date
    yesterday: str | None = None
    today: str | None = None
    blockers: str | None = None
    claimed_task_ids: list[str] = Field(default_factory=list)
    submitted_at: datetime | None = None
    source_label: SourceLabel = "live"


class Evidence(BaseModel):
    """Normalized evidence record. `source_label` distinguishes synthetic fixtures from live data."""

    evidence_id: str
    team_id: str | None = None
    project_id: str | None = None
    member_id: str | None = None
    task_id: str | None = None
    source: Literal["github_synthetic", "github_api", "worklog", "standup"]
    evidence_type: str
    github_username: str | None = None
    title: str | None = None
    url: str | None = None
    hours: float | None = None
    occurred_at: datetime | None = None
    source_label: SourceLabel = "live"
    raw: dict = Field(default_factory=dict)
