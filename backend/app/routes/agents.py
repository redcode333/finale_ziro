from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from app.agents.repository import Repo
from app.agents.runner import AgentRunner
from app.auth import Mentor, get_current_mentor, get_repo, require_team_scope
from app.errors import NotFoundError
from app.schemas.agent import (AgentRunDetail, AnalyzeRequest, ApprovalOut, DecisionRequest, DecisionResponse,
                               RiskAssessmentOut, RunSummary, WeeklyReport)
from app.services import approval_service

router = APIRouter(tags=["agent"])
CurrentMentor = Annotated[Mentor, Depends(get_current_mentor)]
RepoDep = Annotated[Repo, Depends(get_repo)]


def get_runner(repo: RepoDep) -> AgentRunner:
    return AgentRunner(repo)


Runner = Annotated[AgentRunner, Depends(get_runner)]


def _summary(r: dict) -> RunSummary:
    return RunSummary(**{k: r.get(k) for k in RunSummary.model_fields})


@router.post("/agents/analyze", response_model=RunSummary,
             description="Starts (or returns the existing) analysis run for the team/sprint/as_of. Idempotent: repeating the "
                         "same request returns the same run_id. With wait=false (default) the graph runs in the background; "
                         "poll GET /agent-runs/{run_id}. The run pauses at `awaiting_approval` until a mentor decides.")
def analyze(req: AnalyzeRequest, bg: BackgroundTasks, mentor: CurrentMentor, runner: Runner):
    require_team_scope(mentor, req.team_id)
    run, created = runner.start(req, mentor.mentor_id)
    if created:
        if req.wait:
            runner.execute(run["run_id"], req)
            run = runner.repo.get_run(run["run_id"])
        else:
            bg.add_task(runner.execute, run["run_id"], req)
    return _summary(run)


@router.get("/agent-runs/{run_id}", response_model=AgentRunDetail)
def get_run(run_id: str, mentor: CurrentMentor, repo: RepoDep):
    run = repo.get_run(run_id)
    if not run:
        raise NotFoundError(f"Run {run_id} not found")
    require_team_scope(mentor, run["team_id"])
    state = run.get("state") or {}
    ev = {"github": len(state.get("github_evidence", [])), "worklogs": len(state.get("worklog_evidence", [])),
          "standups": len(state.get("standup_evidence", [])),
          "by_source_label": {lbl: sum(1 for e in state.get("github_evidence", []) + state.get("worklog_evidence", [])
                                       if e.get("source_label") == lbl) for lbl in ("synthetic", "live")},
          "tool_errors": state.get("tool_errors", [])}
    return AgentRunDetail(
        **_summary(run).model_dump(), plan=run.get("plan") or {}, evidence_summary=ev,
        assessments=[RiskAssessmentOut(**{k: a.get(k) for k in RiskAssessmentOut.model_fields}) for a in repo.select("risk_assessments", run_id=run_id)],
        replans=repo.select("sprint_replans", run_id=run_id), approvals=repo.select("approval_queue", run_id=run_id),
        tool_calls=repo.select("tool_call_logs", run_id=run_id) or state.get("tool_calls", []), llm_calls=run.get("llm_calls") or [])


@router.get("/approvals", response_model=list[ApprovalOut], description="Pending approvals for the authenticated mentor's team.")
def pending_approvals(mentor: CurrentMentor, repo: RepoDep):
    return approval_service.list_pending(repo, mentor)


@router.post("/approvals/{approval_id}/decision", response_model=DecisionResponse,
             description="Approve or reject. Approval applies the proposed reassignment and audits it; rejection never changes "
                         "assignments. Requires a mentor token for the approval's team. When the last pending approval of a run "
                         "is decided the paused graph resumes and generates the report.")
def decide(approval_id: str, body: DecisionRequest, mentor: CurrentMentor, runner: Runner):
    resp, resume_run = approval_service.decide(runner.repo, approval_id, mentor, body.decision, body.reason)
    if resume_run:
        runner.resume(resume_run)
        resp.run_status = (runner.repo.get_run(resume_run) or {}).get("status")
    return resp


@router.get("/reports/weekly", response_model=WeeklyReport, description="Latest generated weekly mentor report for the mentor's team.")
def weekly_report(mentor: CurrentMentor, repo: RepoDep, run_id: Annotated[str | None, Query()] = None):
    rows = repo.select("mentor_reports", team_id=mentor.team_id)
    if run_id:
        rows = [r for r in rows if r.get("run_id") == run_id]
    if not rows:
        raise NotFoundError("No report yet. Reports are generated after the run's approvals are decided.")
    r = sorted(rows, key=lambda r: str(r.get("created_at")))[-1]
    return WeeklyReport(**{k: r.get(k) for k in WeeklyReport.model_fields})
