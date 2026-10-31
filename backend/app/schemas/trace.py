"""Response shapes for the run-trace endpoints (see docs/API_CONTRACT.md, "Run trace").

Fields the backend does not persist are `None`, never estimated.
"""
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.data import SourceLabel

LlmOutcome = Literal["success", "timeout", "rate_limited", "server_error", "invalid_schema", "auth_error", "config_error"]


class ToolCallOut(BaseModel):
    tool_call_id: str
    run_id: str
    tool_name: str
    operation: str | None = None
    status: Literal["success", "failed"]
    http_status: int | None = None
    latency_ms: int
    retries: int | None = None
    result_count: int | None = None
    scope: str | None = None
    started_at: str
    error: str | None = None
    source_label: SourceLabel = "live"


class LlmAttemptOut(BaseModel):
    provider: str
    model: str
    outcome: LlmOutcome
    latency_ms: int


class LlmCallOut(BaseModel):
    llm_call_id: str
    run_id: str
    purpose: Literal["planner", "assessor", "report_writer"]
    started_at: str | None = None
    final_provider: str | None = None
    final_model: str | None = None
    status: Literal["success", "failed"]
    latency_ms: int
    attempts: list[LlmAttemptOut]
    fallback_reason: str | None = None
    schema_valid: bool
    tokens_in: int | None = None
    tokens_out: int | None = None
    source_label: SourceLabel = "live"


class ToolCallPage(BaseModel):
    items: list[ToolCallOut]
    next_cursor: str | None = None


class LlmCallPage(BaseModel):
    items: list[LlmCallOut]
    next_cursor: str | None = Field(default=None)
