import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app.database as database  # noqa: E402
from app.agents.repository import Repo  # noqa: E402
from app.agents.runner import AgentRunner  # noqa: E402
from app.auth import hash_token  # noqa: E402
from app.schemas.agent import AnalyzeRequest  # noqa: E402
from app.schemas.github import GitHubActivityResponse  # noqa: E402
from app.services import seed_service  # noqa: E402
from fakes import FakeSupabase, SmartProvider, router  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402

TOKEN, OTHER_TOKEN = "fsm_test_token_team1", "fsm_test_token_other"


def gh_ok(**kw):
    return GitHubActivityResponse(source_status="ok", repository="o/r", since_days=kw.get("since_days", 1), note="zero events is not inactivity")


def gh_unavailable(**kw):
    return GitHubActivityResponse(source_status="unavailable", repository="o/r", since_days=kw.get("since_days", 1),
                                  error="auth: GitHub rejected the token (401).", note="NOT evidence of zero contribution")


@pytest.fixture
def db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(database, "get_supabase", lambda: fake)
    res = seed_service.run_seed("team_fs_001")
    assert res.failed == 0
    repo = Repo(fake)
    repo.upsert("teams", {"team_id": "team_other", "name": "Other", "source_label": "live"}, "team_id")
    repo.upsert("mentors", [
        {"mentor_id": "MENTOR001", "team_id": "team_fs_001", "name": "Mentor", "token_hash": hash_token(TOKEN), "active": True},
        {"mentor_id": "MENTOR_X", "team_id": "team_other", "name": "Other", "token_hash": hash_token(OTHER_TOKEN), "active": True}], "mentor_id")
    return fake


@pytest.fixture
def make_runner(db):
    def _make(*providers, github=gh_ok, checkpointer=None, **router_kw):
        provs = providers or (SmartProvider(),)
        return AgentRunner(Repo(db), router_factory=lambda: router(*provs, **router_kw),
                           deps_overrides={"github": github, "today": lambda: date(2026, 10, 31)},
                           checkpointer=checkpointer or InMemorySaver())
    return _make


REQ = AnalyzeRequest(team_id="team_fs_001", sprint_id="SP001")


def run_analysis(runner, req=REQ):
    run, created = runner.start(req, "MENTOR001")
    if created:
        runner.execute(run["run_id"], req)
    return runner.repo.get_run(run["run_id"])


def statuses(db, run_id):
    return {a["member_id"]: a for a in db.rows("risk_assessments") if a["run_id"] == run_id}
