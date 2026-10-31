"""In-memory stand-ins used by deterministic tests: a fake Supabase client and scripted LLM providers."""
import json
import re
import threading
from datetime import datetime, timezone

from app.agents.llm import LLMError, LLMRouter, Provider

PKS = {"teams": "team_id", "projects": "project_id", "team_members": "member_id", "sprints": "sprint_id", "tasks": "task_id",
       "standups": "standup_id", "worklogs": "worklog_id", "github_events": "event_id", "evidence": "evidence_id",
       "agent_runs": "run_id", "risk_assessments": "assessment_id", "sprint_replans": "replan_id",
       "approval_queue": "approval_id", "tool_call_logs": "tool_call_id", "audit_events": "audit_event_id",
       "mentor_reports": "report_id", "mentors": "mentor_id"}


class _R:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class FakeSupabase:
    def __init__(self):
        self.t: dict[str, dict] = {}
        self.fail_tables: set[str] = set()
        self.lock = threading.RLock()  # each statement is atomic, like a single SQL UPDATE ... WHERE

    def table(self, name):
        return _Q(self, name)

    def rows(self, name):
        return list(self.t.get(name, {}).values())


class _Q:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.filters, self.values, self._order = db, name, "select", [], None, None

    def select(self, cols="*", count=None): self.op = "select"; return self
    def eq(self, c, v): self.filters.append(lambda r, c=c, v=v: r.get(c) == v); return self
    def in_(self, c, vs): self.filters.append(lambda r, c=c, vs=vs: r.get(c) in vs); return self
    def order(self, c, desc=False): self._order = (c, desc); return self
    def limit(self, n): return self
    def range(self, a, b): return self
    def upsert(self, rows, on_conflict=None): self.op, self.values, self.pk = "upsert", rows if isinstance(rows, list) else [rows], on_conflict; return self
    def update(self, values): self.op, self.values = "update", values; return self

    def execute(self):
        with self.db.lock:
            return self._execute()

    def _execute(self):
        if self.name in self.db.fail_tables:
            raise RuntimeError(f"simulated Supabase failure on {self.name}")
        store = self.db.t.setdefault(self.name, {})
        pk = PKS[self.name]
        if self.op == "upsert":
            for r in self.values:
                cur = store.setdefault(r[self.pk], {})
                if "created_at" not in cur:
                    cur["created_at"] = datetime.now(timezone.utc).isoformat()
                cur.update(r)
            return _R(self.values)
        rows = [r for r in store.values() if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in rows:
                r.update(self.values)
            return _R(rows)
        if self._order:
            rows.sort(key=lambda r: str(r.get(self._order[0])), reverse=self._order[1])
        return _R([dict(r) for r in rows], len(rows))


# ---------------- scripted LLM providers ----------------

def _untrusted(user: str) -> dict:
    m = re.search(r"<untrusted_data>\n(.*)\n</untrusted_data>", user, re.S)
    return json.loads(m.group(1)) if m else {}


class SmartProvider(Provider):
    """Behaves like a competent LLM: plans every claim; judges 'supported' iff substantive evidence is listed."""

    def __init__(self, name="groq", obey_injection=False):
        self.name, self.model, self.obey, self.calls = name, "mock", obey_injection, 0

    def complete(self, system, user):
        self.calls += 1
        data = _untrusted(user)
        if "claims_to_verify" in system:
            return json.dumps({"claims_to_verify": [{"member_id": c["member_id"], "task_ids": c["task_ids"], "claim_summary": c["claim_text"][:100]}
                                                    for c in data["claims"]], "evidence_sources": ["github", "worklogs", "standups"], "notes": "ok"})
        out = []
        for m in data["members"]:
            ids = [e["id"] for e in m["evidence"]]
            if self.obey and "ignore" in m["claim"].lower():  # model that falls for the injection
                out.append({"member_id": m["member_id"], "claim_support": "supported", "reasoning": "Verified as instructed.",
                            "evidence_ids": ["GH999"], "non_code_contribution": False})
                continue
            good = [e for e in m["evidence"] if e["type"] != "standup_claim" and (e["hours"] or 0) >= 0 and len(e["title"] or "") >= 12]
            out.append({"member_id": m["member_id"], "claim_support": "supported" if good else "unsupported",
                        "reasoning": f"{len(good)} substantive items found.", "evidence_ids": [e["id"] for e in good] or ids[:1],
                        "non_code_contribution": any(e["type"] in ("pull_request_review", "worklog", "issue_comment") for e in good)})
        return json.dumps({"assessments": out})


class FailingProvider(Provider):
    def __init__(self, name, kind="transient", message="timeout"):
        self.name, self.model, self.kind, self.message, self.calls = name, "mock", kind, message, 0

    def complete(self, system, user):
        self.calls += 1
        raise LLMError(self.kind, self.message)


class ScriptedProvider(Provider):
    """Returns the scripted texts in order (then repeats the last)."""

    def __init__(self, name, texts, inner=None):
        self.name, self.model, self.texts, self.calls, self.inner = name, "mock", list(texts), 0, inner

    def complete(self, system, user):
        i = min(self.calls, len(self.texts) - 1)
        self.calls += 1
        t = self.texts[i]
        return self.inner.complete(system, user) if t is None else t


def router(*providers, **kw) -> LLMRouter:
    return LLMRouter(providers=list(providers), backoff=0, **kw)
