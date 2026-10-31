from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.data import Evidence


class SectionStatus(BaseModel):
    section: str
    status: Literal["ok", "unavailable"]
    count: int = 0
    error: str | None = None


class GitHubActivityResponse(BaseModel):
    """Live GitHub API result. `unavailable` / `partial` NEVER means zero contribution."""

    source: Literal["github_api"] = "github_api"
    source_status: Literal["ok", "partial", "unavailable"]
    repository: str
    since_days: int
    error: str | None = None
    rate_limit_remaining: int | None = None
    sections: list[SectionStatus] = Field(default_factory=list)
    count: int = 0
    evidence: list[Evidence] = Field(default_factory=list)
    note: str | None = None
