"""Starts, runs and resumes agent runs. Durable state is in agent_runs; the in-process checkpointer only
enables LangGraph's native interrupt/resume while the process is alive."""
import hashlib
import logging
from typing import Callable

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.agents.graph import Deps, build_graph
from app.agents.llm import LLMRouter, build_router
from app.agents.repository import Repo, now_iso
from app.schemas.agent import AnalyzeRequest

logger = logging.getLogger("fairsprint.runner")
_CHECKPOINTER = InMemorySaver()
RECURSION_LIMIT = 30  # hard bound on graph steps (the graph has 10 nodes and no loops)


def run_id_for(team_id: str, sprint_id: str | None, as_of: str | None) -> str:
    key = f"{team_id}|{sprint_id or 'active'}|{as_of or 'latest'}"
    return "run_" + hashlib.sha1(key.encode()).hexdigest()[:12]


class AgentRunner:
    def __init__(self, repo: Repo | None = None, router_factory: Callable[[], LLMRouter] = build_router,
                 deps_overrides: dict | None = None, checkpointer=None):
        self.repo = repo or Repo()
        self.router_factory = router_factory
        self.deps_overrides = deps_overrides or {}
        self.checkpointer = checkpointer or _CHECKPOINTER

    def _graph(self, run: dict):
        router = self.router_factory()
        router.calls = list(run.get("llm_calls") or [])
        return build_graph(Deps(repo=self.repo, router=router, **self.deps_overrides), self.checkpointer)

    def start(self, req: AnalyzeRequest, mentor_id: str) -> tuple[dict, bool]:
        """Idempotent: returns (run_row, created). A failed run is retried under the same id."""
        rid = run_id_for(req.team_id, req.sprint_id, req.as_of)
        existing = self.repo.get_run(rid)
        if existing and existing["status"] != "failed":
            return existing, False
        self.repo.save_run(rid, {"team_id": req.team_id, "sprint_id": req.sprint_id, "status": "running", "phase": "queued",
                                 "workflow": "evidence_assessment", "started_at": now_iso(), "error": None,
                                 "requested_by": mentor_id, "source_label": "live"})
        self.repo.audit(req.team_id, rid, mentor_id, "run_started", rid, reason="Analysis requested by mentor",
                        event_id=f"AU-{rid}-started-{int(__import__('time').time())}")
        return self.repo.get_run(rid), True

    def execute(self, run_id: str, req: AnalyzeRequest) -> None:
        run = self.repo.get_run(run_id)
        graph = self._graph(run)
        init = {"run_id": run_id, "team_id": req.team_id, "execution_status": "running"}
        if req.sprint_id:
            init["sprint_id"] = req.sprint_id
        if req.as_of:
            init["as_of"] = req.as_of
        try:
            graph.invoke(init, {"configurable": {"thread_id": run_id}, "recursion_limit": RECURSION_LIMIT})
        except Exception as exc:  # noqa: BLE001 - keep run state, mark failed
            logger.exception("run %s crashed", run_id)
            self.repo.update("agent_runs", "run_id", run_id, {"status": "failed", "error": f"graph error: {exc}"[:500]})

    def resume(self, run_id: str) -> None:
        """Called after the last pending approval for a run is decided."""
        run = self.repo.get_run(run_id)
        if not run or run["status"] != "awaiting_approval":
            return
        graph = self._graph(run)
        cfg = {"configurable": {"thread_id": run_id}, "recursion_limit": RECURSION_LIMIT}
        try:
            snapshot = graph.get_state(cfg)
            if snapshot and snapshot.next:  # live checkpoint: native LangGraph resume
                graph.invoke(Command(resume="decided"), cfg)
            else:  # process restarted: rebuild from the persisted state and re-enter at the approval node
                state = dict(run.get("state") or {})
                state.update(resume=True, execution_status="running")
                graph.invoke(state, {"configurable": {"thread_id": f"{run_id}:resume-{int(__import__('time').time())}"},
                                     "recursion_limit": RECURSION_LIMIT})
        except Exception as exc:  # noqa: BLE001
            logger.exception("resume of %s failed", run_id)
            self.repo.update("agent_runs", "run_id", run_id, {"status": "failed", "error": f"resume error: {exc}"[:500]})
