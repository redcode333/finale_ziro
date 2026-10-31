import logging
from typing import Callable

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


def _stale(message: str) -> AppError:
    return AppError(message, status_code=409, code="stale_proposal")


def _apply_reassignment(repo: Repo, ap: dict, replan: dict, mentor: Mentor, approval_id: str,
                        reason: str | None) -> tuple[list[dict], Callable[[], None] | None]:
    """Apply the approved reassignment. Safe to run again: a task already at the proposed assignee is not touched twice.

    Returns (applied_changes, undo). `undo` reverts the assignment if this call made it, for use if a later step fails.
    """
    task = repo.one("tasks", task_id=replan["task_id"])
    proposed = repo.one("team_members", member_id=replan["proposed_assignee_id"]) if replan.get("proposed_assignee_id") else None
    if not task or not proposed or proposed["team_id"] != ap["team_id"]:
        raise _stale("Proposal is no longer valid (task or proposed assignee missing).")
    before, after = {"assignee_id": replan["current_assignee_id"]}, {"assignee_id": proposed["member_id"]}
    undo = None
    if task["assignee_id"] != proposed["member_id"]:  # an earlier, unfinished attempt may already have made this change
        if task["assignee_id"] != replan["current_assignee_id"]:
            raise _stale("Task ownership changed since the proposal; request a new analysis.")
        # Atomic: succeeds only while the task still has the assignee the proposal was made against.
        if not repo.update_if("tasks", "task_id", task["task_id"], {"assignee_id": proposed["member_id"]},
                              assignee_id=replan["current_assignee_id"]):
            raise _stale("Task ownership changed since the proposal; request a new analysis.")
        undo = lambda: repo.update_if("tasks", "task_id", task["task_id"], {"assignee_id": replan["current_assignee_id"]},  # noqa: E731
                                      assignee_id=proposed["member_id"])
    try:
        repo.update("sprint_replans", "replan_id", replan["replan_id"], {"proposal_status": "applied"})
        repo.audit(ap["team_id"], ap["run_id"], mentor.mentor_id, "task_reassigned", task["task_id"], before=before, after=after,
                   reason=reason or "Approved by mentor", event_id=f"AU-{approval_id}-applied")
    except Exception:
        if undo:
            _best_effort(undo, "revert reassignment")
        raise
    return [{"task_id": task["task_id"], "before": before, "after": after}], undo


def _best_effort(fn: Callable[[], object], what: str) -> None:
    try:
        fn()
    except Exception:  # noqa: BLE001 - never mask the original failure
        logger.exception("could not %s", what)


def decide(repo: Repo, approval_id: str, mentor: Mentor, decision: str, reason: str | None) -> tuple[DecisionResponse, str | None]:
    """Record a mentor decision; apply the reassignment only on approval. Returns (response, run_id_to_resume|None).

    The pending -> approved/rejected transition is a compare-and-set, so when two requests race exactly one wins and a decided
    approval can never be overwritten. If anything after that transition fails, it is rolled back to pending (and a reassignment
    this call made is undone) so the mentor can simply retry; a retry of an approval whose reassignment never finished completes it.
    """
    ap = repo.one("approval_queue", approval_id=approval_id)
    if not ap:
        raise NotFoundError(f"Approval {approval_id} not found")
    require_team_scope(mentor, ap["team_id"])
    target = "approved" if decision == "approve" else "rejected"
    replan = repo.one("sprint_replans", replan_id=ap["replan_id"]) if ap.get("replan_id") else None

    if ap["status"] != "pending":
        if ap["status"] != target:
            raise AppError(f"Approval already {ap['status']}.", status_code=409, code="already_decided")
        if not (target == "approved" and replan and replan.get("proposal_status") != "applied"):  # idempotent repeat
            return DecisionResponse(approval_id=approval_id, status=ap["status"], applied_changes=[]), None
        # approved earlier, but that attempt stopped before the reassignment finished: complete it below
    elif not repo.update_if("approval_queue", "approval_id", approval_id,
                            {"status": target, "reviewer_id": mentor.mentor_id, "decision_reason": reason, "decided_at": now_iso()},
                            status="pending"):
        raise AppError("This approval was decided by another request; reload and review its current status.",
                       status_code=409, code="already_decided")

    applied: list[dict] = []
    undo = None
    try:
        if replan and target == "approved":
            applied, undo = _apply_reassignment(repo, ap, replan, mentor, approval_id, reason)
        elif replan:  # rejection never touches tasks
            repo.update("sprint_replans", "replan_id", replan["replan_id"], {"proposal_status": "rejected"})
        repo.audit(ap["team_id"], ap["run_id"], mentor.mentor_id, f"approval_{target}", approval_id,
                   before={"status": "pending"}, after={"status": target}, reason=reason, event_id=f"AU-{approval_id}-decision")
    except Exception:
        if undo:
            _best_effort(undo, "revert reassignment")
        if replan:
            _best_effort(lambda: repo.update("sprint_replans", "replan_id", replan["replan_id"],
                                             {"proposal_status": replan.get("proposal_status")}), "restore the proposal status")
        _best_effort(lambda: repo.update_if("approval_queue", "approval_id", approval_id,
                                            {"status": "pending", "reviewer_id": None, "decision_reason": None, "decided_at": None},
                                            status=target), "return the approval to pending")
        raise

    resume = None
    if ap.get("run_id") and not any(r["status"] == "pending" for r in repo.select("approval_queue", run_id=ap["run_id"])):
        resume = ap["run_id"]
    return DecisionResponse(approval_id=approval_id, status=target, applied_changes=applied), resume
