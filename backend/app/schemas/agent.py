"""Pydantic contracts for LLM output and the agent API. LLM output is always validated against these."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RiskStatus = Literal["verified", "partially_verified", "unverified", "insufficient_evidence"]
ClaimSupport = Literal["supported", "partially_supported", "unsupported", "cannot_assess"]


# ---- LLM outputs ----
class ClaimToVerify(BaseModel):
    member_id: str
    task_ids: list[str] = Field(default_factory=list)
    claim_summary: str = Field(max_length=300)


class ExecutionPlan(BaseModel):
    claims_to_verify: list[ClaimToVerify]
    evidence_sources: list[str] = Field(default_factory=list)
    notes: str = Field(default="", max_length=500)


class MemberAssessment(BaseModel):
    member_id: str
    claim_support: ClaimSupport
    reasoning: str = Field(max_length=600)
    evidence_ids: list[str] = Field(default_factory=list)
    non_code_contribution: bool = False


class AssessmentBatch(BaseModel):
    assessments: list[MemberAssessment]


# ---- API ----
class AnalyzeRequest(BaseModel):
    team_id: str
    sprint_id: str | None = Field(default=None, description="Defaults to the team's active sprint")
    as_of: str | None = Field(default=None, description="ISO date used as 'today'; defaults to the latest standup date")
    wait: bool = Field(default=False, description="Run synchronously until the graph finishes or pauses for approval")


class RunSummary(BaseModel):
    run_id: str
    team_id: str
    sprint_id: str | None = None
    status: str
    phase: str | None = None
    error: str | None = None


class RiskAssessmentOut(BaseModel):
    assessment_id: str
    member_id: str | None = None
    status: str
    risk_level: str
    summary: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    missing_context: str | None = None
    recommended_action: str | None = None
    source_label: str = "live"


class AgentRunDetail(RunSummary):
    plan: dict[str, Any] = Field(default_factory=dict)
    evidence_summary: dict[str, Any] = Field(default_factory=dict)
    assessments: list[RiskAssessmentOut] = Field(default_factory=list)
    replans: list[dict[str, Any]] = Field(default_factory=list)
    approvals: list[dict[str, Any]] = Field(default_factory=list)
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    llm_calls: list[dict[str, Any]] = Field(default_factory=list)


class ApprovalOut(BaseModel):
    approval_id: str
    team_id: str
    run_id: str | None = None
    replan_id: str | None = None
    status: str
    requested_by: str | None = None
    reviewer_id: str | None = None
    decision_reason: str | None = None
    replan: dict[str, Any] | None = None
    created_at: datetime | None = None


class DecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    reason: str | None = Field(default=None, max_length=500)


class DecisionResponse(BaseModel):
    approval_id: str
    status: str
    applied_changes: list[dict[str, Any]] = Field(default_factory=list)
    run_status: str | None = None


class WeeklyReport(BaseModel):
    report_id: str
    team_id: str
    run_id: str | None = None
    sprint_id: str | None = None
    status: str
    summary: str | None = None
    body: dict[str, Any] = Field(default_factory=dict)
