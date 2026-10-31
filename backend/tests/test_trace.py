"""Run-trace endpoints: built from persisted tool_call_logs and agent_runs.llm_calls, authenticated and team-scoped."""
from fastapi.testclient import TestClient

from app.agents.repository import Repo
from app.auth import get_repo
from app.main import app
from app.routes import agents as agent_routes
from app.services import trace_service
from conftest import OTHER_TOKEN, REQ, TOKEN, run_analysis
from fakes import FailingProvider

import pytest


def auth(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def api(db, make_runner):
    def _make(*providers, **kw):
        runner = make_runner(*providers, **kw)
        app.dependency_overrides[get_repo] = lambda: Repo(db)
        app.dependency_overrides[agent_routes.get_runner] = lambda: runner
        return TestClient(app), runner
    yield _make
    app.dependency_overrides.clear()


def _rec(provider, attempt, status="success", error=None, schema="ExecutionPlan", reason=None, ms=10):
    return {"provider": provider, "model": "m", "attempt": attempt, "fallback_reason": reason, "schema": schema,
            "status": status, "error": error, "latency_ms": ms, "started_at": "2026-10-31T10:00:00+00:00"}


def test_tool_calls_match_persisted_logs(db, api):
    client, runner = api()
    run = run_analysis(runner)
    body = client.get(f"/agent-runs/{run['run_id']}/tool-calls", headers=auth(TOKEN)).json()
    stored = {t["tool_call_id"]: t for t in db.rows("tool_call_logs") if t["run_id"] == run["run_id"]}
    assert body["next_cursor"] is None and {i["tool_call_id"] for i in body["items"]} == set(stored) and stored
    for i in body["items"]:
        s = stored[i["tool_call_id"]]
        assert i["tool_name"] == s["tool_name"] and i["latency_ms"] == s["latency_ms"] and i["status"] == "success"
        assert i["result_count"] == s["result_count"] and i["started_at"] == s["started_at"]
        assert i["operation"] is None and i["scope"] is None and i["retries"] is None and i["http_status"] is None


def test_tool_call_without_started_at_falls_back_to_created_at(db, api):
    client, runner = api()
    run = run_analysis(runner)
    row = next(t for t in db.rows("tool_call_logs") if t["run_id"] == run["run_id"])
    row["started_at"] = None  # rows written before migration 003
    items = client.get(f"/agent-runs/{run['run_id']}/tool-calls", headers=auth(TOKEN)).json()["items"]
    assert next(i for i in items if i["tool_call_id"] == row["tool_call_id"])["started_at"] == row["created_at"]


def test_failed_tool_call_has_unknown_row_count_not_zero(db, api):
    client, runner = api()
    run = run_analysis(runner)
    row = next(t for t in db.rows("tool_call_logs") if t["run_id"] == run["run_id"])
    row.update(status="unavailable", result_count=0, error="GitHub 503")
    item = client.get(f"/agent-runs/{run['run_id']}/tool-calls", headers=auth(TOKEN)).json()["items"]
    failed = next(i for i in item if i["tool_call_id"] == row["tool_call_id"])
    assert failed["status"] == "failed" and failed["result_count"] is None and failed["error"] == "GitHub 503"


def test_tool_calls_never_cross_teams(db, api):
    client, runner = api()
    run = run_analysis(runner)
    foreign = next(t for t in db.rows("tool_call_logs") if t["run_id"] == run["run_id"])
    foreign["team_id"] = "team_other"
    ids = {i["tool_call_id"] for i in client.get(f"/agent-runs/{run['run_id']}/tool-calls", headers=auth(TOKEN)).json()["items"]}
    assert foreign["tool_call_id"] not in ids and ids


def test_llm_calls_group_attempts_per_call(db, api):
    client, runner = api()
    run = run_analysis(runner)
    items = client.get(f"/agent-runs/{run['run_id']}/llm-calls", headers=auth(TOKEN)).json()["items"]
    assert [i["purpose"] for i in items] == ["planner", "assessor"]
    assert sum(len(i["attempts"]) for i in items) == len(run["llm_calls"])
    for i in items:
        assert i["status"] == "success" and i["schema_valid"] and i["final_provider"] == "groq" and i["fallback_reason"] is None
        assert i["tokens_in"] is None and i["tokens_out"] is None and i["started_at"]


def test_llm_fallback_chain_and_outcomes(db, api):
    client, runner = api()
    run = run_analysis(runner)
    run_id = run["run_id"]
    # replace the router log with a known primary-to-fallback sequence
    Repo(db).save_run(run_id, {"llm_calls": [
        _rec("gemini", 1, "error", "transient: gemini HTTP 429"), _rec("groq", 1),
        _rec("gemini", 1, "error", "transient: gemini ReadTimeout", schema="AssessmentBatch"),
        _rec("groq", 1, "error", "invalid_output: output failed AssessmentBatch validation", schema="AssessmentBatch")]})
    plan, assess = client.get(f"/agent-runs/{run_id}/llm-calls", headers=auth(TOKEN)).json()["items"]
    assert [a["outcome"] for a in plan["attempts"]] == ["rate_limited", "success"]
    assert plan["fallback_reason"] == "rate_limited" and plan["final_provider"] == "groq" and plan["status"] == "success"
    assert [a["outcome"] for a in assess["attempts"]] == ["timeout", "invalid_schema"]
    assert assess["status"] == "failed" and assess["final_provider"] is None and assess["schema_valid"] is False
    assert assess["fallback_reason"] == "timeout" and assess["latency_ms"] == 20


def test_failed_run_still_exposes_its_attempts(db, api):
    client, runner = api(FailingProvider("gemini", "auth", "HTTP 401"), FailingProvider("groq", "transient", "HTTP 503"), max_attempts=2)
    run = run_analysis(runner)
    items = client.get(f"/agent-runs/{run['run_id']}/llm-calls", headers=auth(TOKEN)).json()["items"]
    assert len(items) == 1 and items[0]["status"] == "failed"
    assert [a["outcome"] for a in items[0]["attempts"]] == ["auth_error", "server_error", "server_error"]
    assert items[0]["fallback_reason"] == "auth_error"


def test_grouping_splits_back_to_back_failed_calls():
    log = [_rec("gemini", 1, "error", "transient: t"), _rec("gemini", 2, "error", "transient: t"),
           _rec("gemini", 1, "error", "transient: t", schema="AssessmentBatch")]
    assert [len(g) for g in trace_service._group(log)] == [2, 1]


def test_auth_and_team_isolation(db, api):
    client, runner = api()
    run = run_analysis(runner)
    for path in ("tool-calls", "llm-calls"):
        url = f"/agent-runs/{run['run_id']}/{path}"
        assert client.get(url).status_code == 401
        assert client.get(url, headers=auth("bogus")).status_code == 401
        assert client.get(url, headers=auth(OTHER_TOKEN)).status_code == 403
        assert client.get(url, headers=auth(TOKEN)).status_code == 200
        assert client.get(f"/agent-runs/nope/{path}", headers=auth(TOKEN)).status_code == 404


def test_run_without_calls_returns_empty_pages(db, api):
    client, runner = api()
    rid, _ = runner.start(REQ, "MENTOR001")  # created, never executed
    for path in ("tool-calls", "llm-calls"):
        r = client.get(f"/agent-runs/{rid['run_id']}/{path}", headers=auth(TOKEN))
        assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}
