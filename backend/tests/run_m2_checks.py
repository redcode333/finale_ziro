"""Lightweight M2 checks (no pytest needed): python tests/run_m2_checks.py [--live]
Offline checks use mocked transports / an in-memory fake DB. --live also hits real GitHub and Supabase.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.services import evidence_service as ev  # noqa: E402
from app.services import github_service, seed_service  # noqa: E402
from app.tools.github import GitHubClient, GitHubError  # noqa: E402

results: list[tuple[str, bool, str]] = []


def check(name, fn):
    try:
        detail = fn() or ""
        results.append((name, True, str(detail)))
    except Exception as exc:  # noqa: BLE001
        results.append((name, False, f"{type(exc).__name__}: {exc}"))


def client_with(handler, **kw):
    return GitHubClient("tok", "o", "r", transport=httpx.MockTransport(handler), max_retries=kw.pop("max_retries", 1), **kw)


# ---- normalization ----
def t_normalize():
    ctx = dict(team_id="t1", project_id=None, members={"alice": "M001"})
    c = ev.normalize_commit({"sha": "abc", "html_url": "u", "author": {"login": "Alice"},
                             "commit": {"message": "Fix bug\n\nlong", "author": {"date": "2026-10-01T10:00:00Z", "name": "A"}}}, **ctx)
    assert c.evidence_id == "gh:commit:abc" and c.title == "Fix bug" and c.member_id == "M001"
    assert c.source == "github_api" and c.source_label == "live"
    assert ev.normalize_issue({"number": 1, "pull_request": {}}, **ctx) is None
    i = ev.normalize_issue({"number": 2, "title": "T", "user": {"login": "bob"}, "created_at": "2026-10-01T00:00:00Z"}, **ctx)
    assert i.member_id is None and i.evidence_type == "issue"
    r = ev.normalize_review({"id": 9, "state": "APPROVED", "user": {"login": "alice"}, "submitted_at": "2026-10-01T00:00:00Z"}, 5, **ctx)
    assert r.evidence_type == "pull_request_review" and "#5" in r.title
    return "commit/PR/review/issue/comment normalised; PR-in-issues skipped"


# ---- GitHub error handling ----
def t_auth_401():
    c = client_with(lambda req: httpx.Response(401, json={}))
    try:
        c.validate_repo()
    except GitHubError as e:
        assert e.kind == "auth"; return "401 -> auth"
    raise AssertionError("no error")


def t_rate_limit():
    c = client_with(lambda req: httpx.Response(403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1"}, json={"message": "API rate limit exceeded"}))
    try:
        c.validate_repo()
    except GitHubError as e:
        assert e.kind == "rate_limited"; return "403+remaining=0 -> rate_limited"
    raise AssertionError("no error")


def t_retry_5xx():
    calls = []
    def h(req):
        calls.append(1); return httpx.Response(503)
    c = client_with(h, max_retries=2)
    try:
        c.validate_repo()
    except GitHubError as e:
        assert e.kind == "unavailable" and len(calls) == 3; return f"{len(calls)} attempts then unavailable"
    raise AssertionError("no error")


def t_timeout():
    def h(req): raise httpx.ConnectTimeout("t")
    c = client_with(h, max_retries=1)
    try:
        c.validate_repo()
    except GitHubError as e:
        assert e.kind == "unavailable"; return "timeout -> unavailable"
    raise AssertionError("no error")


def t_pagination():
    def h(req):
        page = req.url.params.get("page", "1")
        if page == "1":
            return httpx.Response(200, json=[{"n": 1}], headers={"link": '<https://api.github.com/x?page=2>; rel="next"'})
        return httpx.Response(200, json=[{"n": 2}])
    c = client_with(h)
    assert [i["n"] for i in c._paginate("/x")] == [1, 2]
    return "follows Link rel=next"


def _patch_settings():
    from app.config import get_settings
    s = get_settings(); s.github_repo_owner, s.github_repo_name = "o", "r"


def t_unavailable_not_zero():
    _patch_settings()
    c = client_with(lambda req: httpx.Response(500), max_retries=0)
    out = github_service.collect_activity(client=c)
    assert out.source_status == "unavailable" and out.count == 0 and "NOT evidence" in out.note
    return "API failure -> unavailable (not zero)"


def t_partial():
    _patch_settings()
    def h(req):
        p = req.url.path
        if p == "/repos/o/r": return httpx.Response(200, json={})
        if p.endswith("/commits"): return httpx.Response(500)
        return httpx.Response(200, json=[])
    out = github_service.collect_activity(client=client_with(h, max_retries=0))
    assert out.source_status == "partial", out.source_status
    assert {s.section: s.status for s in out.sections}["commits"] == "unavailable"
    return "one failed section -> partial"


# ---- seed ----
class FakeDB:
    def __init__(self): self.t: dict[str, dict] = {}
    def table(self, name): return FakeTable(self, name)

class FakeTable:
    def __init__(self, db, name): self.db, self.name, self.op, self.pk, self.ids = db, name, None, None, None
    def select(self, pk): self.op, self.pk = "select", pk; return self
    def in_(self, pk, ids): self.ids = ids; return self
    def upsert(self, rows, on_conflict): self.op, self.rows, self.pk = "upsert", rows if isinstance(rows, list) else [rows], on_conflict; return self
    def execute(self):
        store = self.db.t.setdefault(self.name, {})
        if self.op == "select":
            return type("R", (), {"data": [{self.pk: i} for i in self.ids if i in store]})
        for r in self.rows: store[r[self.pk]] = r
        return type("R", (), {"data": self.rows})


def t_seed_idempotent():
    import app.database as database
    fake = FakeDB(); database.get_supabase = lambda: fake
    a = seed_service.run_seed("team_fs_001")
    b = seed_service.run_seed("team_fs_001")
    assert a.failed == 0 and b.failed == 0
    assert a.inserted == 124 and a.updated == 0, (a.inserted, a.updated)
    assert b.inserted == 0 and b.updated == 124, (b.inserted, b.updated)
    assert all(r["source_label"] == "synthetic" for t in fake.t.values() for r in t.values())
    return f"run1 +{a.inserted}, run2 ~{b.updated} (in-memory fake DB; not Supabase)"


def t_fk_consistency():
    fake_ids = {}
    for spec, rows, res in seed_service.validate_specs(seed_service.build_specs(seed_service.read_dataset(seed_service.find_zip()), "team_fs_001")):
        assert res.failed == 0, res.errors
        fake_ids.setdefault(spec.table, set()).update(r[spec.pk] for r in rows)
    ev_ids = fake_ids["evidence"]
    for t in ("risk_assessments",):
        pass
    ds = seed_service.read_dataset(seed_service.find_zip())
    for ra in ds["tables"]["risk_assessments"]:
        for eid in ra["evidence_ids"].split(";"):
            assert eid in ev_ids, f"{ra['assessment_id']} -> {eid}"
    return "all FK columns resolve; risk_assessment evidence_ids all exist as evidence"


def t_sql_constraints():
    """Every seeded value must satisfy the CHECK lists in the migration (dry-run alone can't see these)."""
    import re
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "001_fairsprint_schema.sql").read_text(encoding="utf-8")
    allowed: dict[tuple[str, str], set[str]] = {}
    for m in re.finditer(r"create table if not exists (\w+) \((.*?)\n\);", sql, re.S):
        for c in re.finditer(r"(\w+) text[^;,]*?check \(\s*\1 in \(([^)]*)\)", m.group(2)):
            allowed[(m.group(1), c.group(1))] = set(re.findall(r"'([^']*)'", c.group(2)))
    checked = 0
    for spec, rows, _ in seed_service.validate_specs(seed_service.build_specs(seed_service.read_dataset(seed_service.find_zip()), "team_fs_001")):
        for r in rows:
            for col, val in r.items():
                if (spec.table, col) in allowed:
                    assert val in allowed[(spec.table, col)], f"{spec.table}.{col}={val!r} violates CHECK"
                    checked += 1
    assert checked > 100
    return f"{checked} enum values satisfy the migration's CHECK constraints"


def t_malformed():
    ds = seed_service.read_dataset(seed_service.find_zip())
    ds["tables"]["tasks"][0]["estimate_hours"] = "abc"
    ds["tables"]["tasks"][1]["assignee_id"] = "M999"
    ds["tables"]["standups"][0]["member_id"] = ""
    out = seed_service.validate_specs(seed_service.build_specs(ds, "team_fs_001"))
    failed = {s.table: r.failed for s, _, r in out}
    assert failed["tasks"] == 2 and failed["standups"] == 1, failed
    return f"bad rows rejected, rest kept: {failed['tasks']} tasks, {failed['standups']} standup"


for name, fn in [("normalization", t_normalize), ("github 401", t_auth_401), ("github rate limit", t_rate_limit),
                 ("github 5xx retry", t_retry_5xx), ("github timeout", t_timeout), ("github pagination", t_pagination),
                 ("unavailable != zero", t_unavailable_not_zero), ("partial status", t_partial),
                 ("seed FK consistency", t_fk_consistency), ("seed malformed rows", t_malformed), ("SQL CHECK vs dataset", t_sql_constraints),
                 ("seed idempotency (fake db)", t_seed_idempotent)]:
    check(name, fn)

if "--live" in sys.argv:
    from app.config import get_settings
    get_settings.cache_clear()

    def live_github():
        out = github_service.collect_activity(since_days=30)
        return f"status={out.source_status} count={out.count} sections={[(s.section, s.status, s.count) for s in out.sections]} err={out.error}"
    check("LIVE github activity", live_github)

    def live_supabase():
        from importlib import reload
        import app.database as database
        reload(database)
        r = database.get_supabase().table("teams").select("team_id").limit(1).execute()
        return f"teams query ok, rows={len(r.data)}"
    check("LIVE supabase query", live_supabase)

for name, ok, detail in results:
    print(("PASS " if ok else "FAIL ") + name + (f" -- {detail}" if detail else ""))
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
