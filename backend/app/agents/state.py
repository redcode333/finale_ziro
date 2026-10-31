from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    """Compact, JSON-serialisable graph state. Durable copy lives in agent_runs.state."""

    run_id: str
    team_id: str
    sprint_id: str
    as_of: str
    window: dict[str, str]
    execution_plan: dict[str, Any]
    member_claims: list[dict[str, Any]]
    members: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    github_evidence: list[dict[str, Any]]      # live API + synthetic fixtures, each labelled by source_label
    worklog_evidence: list[dict[str, Any]]
    standup_evidence: list[dict[str, Any]]
    verification_results: list[dict[str, Any]]
    llm_assessments: list[dict[str, Any]]
    risk_assessments: list[dict[str, Any]]
    replan_proposal: dict[str, Any]
    approval_status: str                       # none | pending | approved | rejected | mixed
    mentor_report: dict[str, Any]
    tool_calls: list[dict[str, Any]]
    tool_errors: list[dict[str, Any]]
    injection_flags: list[dict[str, Any]]
    sprint: dict[str, Any]
    source_label: str                          # 'synthetic' when the team is a seeded fixture team
    resume: bool                               # re-entry after a mentor decision (persisted-state resume path)
    execution_status: str                      # running | awaiting_approval | completed | failed
    error: str
