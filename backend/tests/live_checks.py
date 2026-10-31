"""Integration check with REAL services: Supabase reads, Gemini/Groq calls, GitHub API.
Writes go to an in-memory copy (migration 002 is required before the agent can persist to Supabase).
Run: python tests/live_checks.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app.database as database  # noqa: E402
from app.agents.llm import build_router  # noqa: E402
from app.agents.repository import Repo  # noqa: E402
from app.agents.runner import AgentRunner  # noqa: E402
from app.auth import Mentor  # noqa: E402
from app.schemas.agent import AnalyzeRequest  # noqa: E402
from app.services import approval_service as svc  # noqa: E402
from fakes import PKS, FakeSupabase  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402

LABELS = {"M001": "verified", "M002": "verified", "M003": "verified", "M006": "verified", "M005": "partially_verified"}
LABELLED_EVIDENCE = {"M003": "GH004 GH005 GH013 W004 W005 W013".split(), "M005": "GH008 GH009 W007 W008".split()}

real = database.get_supabase()
mem = FakeSupabase()
counts = {}
for table, pk in PKS.items():
    if table in ("mentors", "agent_runs"):
        continue
    rows = real.table(table).select("*").execute().data or []   # REAL Supabase reads
    mem.t[table] = {r[pk]: r for r in rows}
    counts[table] = len(rows)
print("REAL Supabase rows read:", {k: v for k, v in counts.items() if v})

repo = Repo(mem)
runner = AgentRunner(repo, router_factory=build_router, deps_overrides={"today": lambda: date(2026, 10, 31)},
                     checkpointer=InMemorySaver())
req = AnalyzeRequest(team_id="team_fs_001", sprint_id="SP001")
run, _ = runner.start(req, "MENTOR001")
runner.execute(run["run_id"], req)
run = repo.get_run(run["run_id"])
rid = run["run_id"]
print("\nstatus after execute:", run["status"], "| error:", run.get("error"))
print("\nLLM calls (real):")
for c in run["llm_calls"]:
    print(f"  {c['schema']:<18} {c['provider']:<7} {c['model']:<22} attempt={c['attempt']} {c['status']:<7} {c['latency_ms']}ms"
          f" fallback_reason={c['fallback_reason']} {c.get('error', '')}")
print("\nTool calls (real GitHub + Supabase):")
for t in mem.rows("tool_call_logs"):
    print(f"  {t['tool_name']:<26} {t['status']:<12} {t['latency_ms']}ms count={t['result_count']} {t.get('error') or ''}")

assess = {a["member_id"]: a for a in mem.rows("risk_assessments") if a["run_id"] == rid}
print("\nAssessments:")
for mid, a in sorted(assess.items()):
    print(f"  {mid} {a['status']:<22} {a['risk_level']:<16} ev={len(a['evidence_ids'])}  {a['summary'][:110]}")

# ---- approval pause / resume ----
tasks_before = {k: v["assignee_id"] for k, v in mem.t["tasks"].items()}
print("\npaused:", run["status"] == "awaiting_approval", "| assignments unchanged while paused:", tasks_before["T008"] == "M007")
mentor = Mentor("MENTOR001", "team_fs_001", "Demo Mentor")
pend = [a for a in mem.rows("approval_queue") if a["run_id"] == rid and a["status"] == "pending"]
resume = None
for a in pend:
    _, resume = svc.decide(repo, a["approval_id"], mentor, "approve", "demo approval")
if resume:
    runner.resume(resume)
print("after approval -> run status:", repo.get_run(rid)["status"], "| T008 owner:", mem.t["tasks"]["T008"]["assignee_id"])
rep = mem.t["mentor_reports"].get(f"REP-{rid}")
print("report:", rep["summary"] if rep else None)

# ---- metrics against labelled data ----
correct = sum(1 for m, lab in LABELS.items() if assess[m]["status"] == lab)
fp = [m for m, lab in LABELS.items() if lab == "verified" and assess[m]["status"] != "verified"]
print(f"\nMETRICS: accuracy {correct}/{len(LABELS)} on labelled members; false positives (verified member flagged): {len(fp)} {fp}")
for m, ids in LABELLED_EVIDENCE.items():
    got = set(assess[m]["evidence_ids"])
    print(f"  evidence recall {m}: {len(got & set(ids))}/{len(ids)} labelled ids cited (missing: {sorted(set(ids) - got)})")
nonins = [a for a in assess.values() if a["status"] != "insufficient_evidence"]
valid = {e["evidence_id"] for e in mem.rows("evidence")}
cov = sum(1 for a in nonins if a["evidence_ids"] and set(a["evidence_ids"]) <= valid)
print(f"  evidence coverage: {cov}/{len(nonins)} non-insufficient assessments cite >=1 resolvable evidence id and no unresolvable ids")
