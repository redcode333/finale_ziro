import logging

from app.agents.repository import Repo, now_iso
from app.auth import Mentor, require_team_scope
from app.errors import AppError, NotFoundError
from app.schemas.agent import ApprovalOut, DecisionResponse

logger = logging.getLogger("fairsprint.approvals")


def list_pending(repo: Repo, mentor: Mentor) -> list[ApprovalOut]:
    out = []
    for a in repo.select("approval_queue", team_id=mentor.team_id, status="pending"):
        replan = repo.one("sprint_replans", replan_id=a["replan_id"]) if a.get("replan_id") else None
        out.append(ApprovalOut(**{k: a.get(k) for k in ApprovalOut.model_fields if k != "replan"}, replan=replan))
    return out


def decide(repo: Repo, approval_id: str, mentor: Mentor, decision: str, reason: str | None) -> tuple[DecisionResponse, str | None]:
    """Record a mentor decision; apply the reassignment only on approval. Returns (response, run_id_to_resume|None)."""
    ap = repo.one("approval_queue", approval_id=approval_id)
    if not ap:
        raise NotFoundError(f"Approval {approval_id} not found")
    require_team_scope(mentor, ap["team_id"])
    target = "approved" if decision == "approve" else "rejected"
    if ap["status"] != "pending":
        if ap["status"] == target:  # idempotent repeat
            return DecisionResponse(approval_id=approval_id, status=ap["status"], applied_changes=[]), None
        raise AppError(f"Approval already {ap['status']}.", status_code=409, code="already_decided")

    applied: list[dict] = []
    replan = repo.one("sprint_replans", replan_id=ap["replan_id"]) if ap.get("replan_id") else None
    if replan and decision == "approve":
        task = repo.one("tasks", task_id=replan["task_id"])
        proposed = repo.one("team_members", member_id=replan["proposed_assignee_id"]) if replan.get("proposed_assignee_id") else None
        if not task or not proposed or proposed["team_id"] != ap["team_id"]:
            raise AppError("Proposal is no longer valid (task or proposed assignee missing).", status_code=409, code="stale_proposal")
        if task["assignee_id"] != replan["current_assignee_id"]:
            raise AppError("Task ownership changed since the proposal; request a new analysis.", status_code=409, code="stale_proposal")
        repo.update("tasks", "task_id", task["task_id"], {"assignee_id": proposed["member_id"]})
        repo.update("sprint_replans", "replan_id", replan["replan_id"], {"proposal_status": "applied"})
        change = {"task_id": task["task_id"], "before": {"assignee_id": task["assignee_id"]}, "after": {"assignee_id": proposed["member_id"]}}
        applied.append(change)
        repo.audit(ap["team_id"], ap["run_id"], mentor.mentor_id, "task_reassigned", task["task_id"], before=change["before"],
                   after=change["after"], reason=reason or "Approved by mentor", event_id=f"AU-{approval_id}-applied")
    elif replan:  # rejection never touches tasks
        repo.update("sprint_replans", "replan_id", replan["replan_id"], {"proposal_status": "rejected"})
    repo.update("approval_queue", "approval_id", approval_id,
                {"status": target, "reviewer_id": mentor.mentor_id, "decision_reason": reason, "decided_at": now_iso()})
    repo.audit(ap["team_id"], ap["run_id"], mentor.mentor_id, f"approval_{target}", approval_id,
               before={"status": "pending"}, after={"status": target}, reason=reason, event_id=f"AU-{approval_id}-decision")

    resume = None
    if ap.get("run_id") and not any(r["status"] == "pending" for r in repo.select("approval_queue", run_id=ap["run_id"])):
        resume = ap["run_id"]
    return DecisionResponse(approval_id=approval_id, status=target, applied_changes=applied), resume
