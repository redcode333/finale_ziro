"""Builds the run-trace views from persisted data only.

Tool calls come from `tool_call_logs`; model calls are regrouped from the per-attempt records the LLM router stores in
`agent_runs.llm_calls`. Nothing here invents rows or values: unknown fields stay `None`.
"""
import logging

from app.agents.repository import Repo
from app.schemas.trace import LlmAttemptOut, LlmCallOut, ToolCallOut

logger = logging.getLogger("fairsprint.trace")

PURPOSE_BY_SCHEMA = {"ExecutionPlan": "planner", "AssessmentBatch": "assessor"}


def tool_calls(repo: Repo, run: dict) -> list[ToolCallOut]:
    rows = [r for r in repo.select("tool_call_logs", run_id=run["run_id"]) if r.get("team_id") == run["team_id"]]
    rows.sort(key=lambda r: (str(r.get("started_at") or r.get("created_at") or ""), r["tool_call_id"]))
    out = []
    for r in rows:
        ok = r.get("status") == "success"
        out.append(ToolCallOut(
            tool_call_id=r["tool_call_id"], run_id=run["run_id"], tool_name=r["tool_name"], status="success" if ok else "failed",
            latency_ms=r.get("latency_ms") or 0,
            result_count=r.get("result_count") if ok else None,  # a failed call's row count is unknown, never zero
            started_at=str(r.get("started_at") or r.get("created_at") or ""), error=r.get("error"),
            source_label=r.get("source_label") or "live"))
    return out


def _outcome(rec: dict) -> str:
    if rec.get("status") == "success":
        return "success"
    kind, _, msg = (rec.get("error") or "").partition(": ")
    msg = msg.lower()
    if kind == "invalid_output":
        return "invalid_schema"
    if kind == "auth":
        return "auth_error"
    if kind == "config":
        return "config_error"
    if "timeout" in msg or "http 408" in msg:
        return "timeout"
    if "http 429" in msg:
        return "rate_limited"
    return "server_error"


def _group(attempts: list[dict]) -> list[list[dict]]:
    """One router.generate() call = consecutive attempts ending at a success, or until a (provider, attempt) repeats."""
    groups: list[list[dict]] = []
    for rec in attempts:
        cur = groups[-1] if groups else None
        seen = {(a.get("provider"), a.get("attempt")) for a in cur} if cur else set()
        new = (cur is None or cur[-1].get("status") == "success" or (rec.get("provider"), rec.get("attempt")) in seen
               or rec.get("schema") != cur[0].get("schema"))
        if new:
            groups.append([rec])
        else:
            cur.append(rec)
    return groups


def llm_calls(run: dict) -> list[LlmCallOut]:
    out = []
    for n, grp in enumerate(_group(run.get("llm_calls") or []), start=1):
        purpose = PURPOSE_BY_SCHEMA.get(grp[0].get("schema"))
        if not purpose:
            logger.warning("[%s] skipping model call with unknown schema %r", run["run_id"], grp[0].get("schema"))
            continue
        attempts = [LlmAttemptOut(provider=a.get("provider") or "unknown", model=a.get("model") or "unknown", outcome=_outcome(a),
                                  latency_ms=a.get("latency_ms") or 0) for a in grp]
        won = grp[-1] if grp[-1].get("status") == "success" else None
        last_provider = grp[-1].get("provider")
        fallback = None
        if last_provider != grp[0].get("provider"):  # the answering (or last-tried) provider is not the primary
            first_of_last = next(i for i, a in enumerate(grp) if a.get("provider") == last_provider)
            fallback = attempts[first_of_last - 1].outcome
        out.append(LlmCallOut(
            llm_call_id=f"{run['run_id']}-LLM-{n:02d}", run_id=run["run_id"], purpose=purpose, started_at=grp[0].get("started_at"),
            final_provider=won.get("provider") if won else None, final_model=won.get("model") if won else None,
            status="success" if won else "failed", latency_ms=sum(a.latency_ms for a in attempts), attempts=attempts,
            fallback_reason=fallback, schema_valid=won is not None))
    return out
