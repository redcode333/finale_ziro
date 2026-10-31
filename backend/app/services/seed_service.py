"""Idempotent loader for the FairSprint synthetic dataset ZIP.

Every imported row is labelled source_label='synthetic'. Run explicitly via
`python -m app.seed` or the protected POST /teams/{team_id}/seed endpoint; never on startup.
"""
import csv
import io
import json
import logging
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

from app.config import get_settings
from app.errors import AppError, NotFoundError
from app.schemas.seed import SeedResponse, TableSeedResult

logger = logging.getLogger("fairsprint.seed")

SYNTHETIC = "synthetic"
ZIP_GLOB = "FairSprint_AI_Gold_Synthetic_Dataset*.zip"


# ---------- ZIP discovery / reading ----------

def find_zip() -> Path:
    settings = get_settings()
    if settings.seed_zip_path:
        p = Path(settings.seed_zip_path)
        if p.is_file():
            return p
        raise NotFoundError(f"SEED_ZIP_PATH does not exist: {p}")
    here = Path(__file__).resolve()
    for parent in here.parents:
        matches = sorted(parent.glob(ZIP_GLOB))
        if matches:
            return matches[-1]
    raise NotFoundError(f"Synthetic dataset ZIP ({ZIP_GLOB}) not found in the project root")


def read_dataset(zip_path: Path) -> dict[str, Any]:
    """Return {'project': {...}, 'tables': {name: [row dicts]}} from the ZIP (CSV tables + dataset.json project)."""
    tables: dict[str, list[dict[str, str]]] = {}
    project: dict[str, Any] = {}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            base = name.rsplit("/", 1)[-1]
            if base.endswith(".csv"):
                text = z.read(name).decode("utf-8-sig")
                tables[base[:-4]] = list(csv.DictReader(io.StringIO(text)))
            elif base == "dataset.json":
                project = json.loads(z.read(name).decode("utf-8")).get("project", {})
    if not project:
        raise AppError("dataset.json with a 'project' section is missing from the ZIP")
    return {"project": project, "tables": tables}


# ---------- value helpers (raise ValueError on malformed input) ----------

def _s(v: Any) -> str | None:
    v = (v or "").strip() if isinstance(v, str) or v is None else str(v).strip()
    return v or None


def _req(row: dict, key: str) -> str:
    v = _s(row.get(key))
    if v is None:
        raise ValueError(f"missing required field '{key}'")
    return v


def _list(v: Any) -> list[str]:
    s = _s(v)
    return [p.strip() for p in s.split(";") if p.strip()] if s else []


def _num(v: Any, key: str) -> float | None:
    s = _s(v)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        raise ValueError(f"'{key}' is not a number: {s!r}")


def _ts(v: Any, key: str) -> str | None:
    s = _s(v)
    if s is None:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError:
        raise ValueError(f"'{key}' is not a timestamp: {s!r}")


def _date(v: Any, key: str) -> str | None:
    s = _s(v)
    if s is None:
        return None
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        raise ValueError(f"'{key}' is not a date: {s!r}")


def _json(v: Any, key: str) -> dict:
    s = _s(v)
    if s is None:
        return {}
    try:
        out = json.loads(s)
    except json.JSONDecodeError:
        raise ValueError(f"'{key}' is not valid JSON")
    return out if isinstance(out, dict) else {"value": out}


# ---------- table specs ----------

class Spec:
    def __init__(self, table: str, pk: str, rows: list[dict], convert: Callable[[dict], dict],
                 fks: dict[str, str] | None = None):
        self.table, self.pk, self.rows, self.convert, self.fks = table, pk, rows, convert, fks or {}


def build_specs(ds: dict[str, Any], team_id: str) -> list[Spec]:
    P, T = ds["project"], ds["tables"]
    project_id = _req(P, "project_id")
    members_rows = T.get("team_members", [])
    run_ids = sorted({r for t in ("risk_assessments", "sprint_replans", "approval_queue", "tool_call_logs", "audit_events")
                      for row in T.get(t, []) if (r := _s(row.get("run_id")))})

    def team_row(_): return {"team_id": team_id, "name": f"{P.get('project_name', team_id)} Team",
                             "description": _s(P.get("description")), "source_label": SYNTHETIC}

    def project_row(_): return {"project_id": project_id, "team_id": team_id,
                                "name": _req(P, "project_name"), "description": _s(P.get("description")),
                                "repository_url": _s(P.get("repository_url")), "source_label": SYNTHETIC}

    def member(r): return {
        "member_id": _req(r, "member_id"), "team_id": _req(r, "team_id"), "name": _req(r, "name"),
        "email": _s(r.get("email")), "github_username": _s(r.get("github_username")), "role": _s(r.get("role")),
        "skills": _list(r.get("skills")), "weekly_capacity_hours": _num(r.get("weekly_capacity_hours"), "weekly_capacity_hours") or 0,
        "availability_status": _s(r.get("availability_status")) or "available", "source_label": SYNTHETIC}

    def sprint(r): return {
        "sprint_id": _req(r, "sprint_id"), "team_id": _req(r, "team_id"), "project_id": _req(r, "project_id"),
        "name": _req(r, "name"), "goal": _s(r.get("goal")), "start_date": _date(r.get("start_date"), "start_date"),
        "end_date": _date(r.get("end_date"), "end_date"), "status": _s(r.get("status")) or "planned",
        "capacity_hours": _num(r.get("capacity_hours"), "capacity_hours"), "source_label": SYNTHETIC}

    def task(r): return {
        "task_id": _req(r, "task_id"), "team_id": _req(r, "team_id"), "project_id": _req(r, "project_id"),
        "sprint_id": _s(r.get("sprint_id")), "title": _req(r, "title"), "assignee_id": _s(r.get("assignee_id")),
        "status": _s(r.get("status")) or "todo", "priority": _s(r.get("priority")) or "medium",
        "estimate_hours": _num(r.get("estimate_hours"), "estimate_hours"), "due_date": _date(r.get("due_date"), "due_date"),
        "dependency_task_ids": _list(r.get("dependency_task_ids")), "workstream": _s(r.get("workstream")),
        "source_label": SYNTHETIC}

    def run(r): return {"run_id": r["run_id"], "team_id": team_id, "workflow": "evidence_assessment",
                        "status": "completed", "source_label": SYNTHETIC}

    def standup(r): return {
        "standup_id": _req(r, "standup_id"), "team_id": _req(r, "team_id"), "member_id": _req(r, "member_id"),
        "date": _date(_req(r, "date"), "date"), "yesterday": _s(r.get("yesterday")), "today": _s(r.get("today")),
        "blockers": _s(r.get("blockers")), "claimed_task_ids": _list(r.get("claimed_task_ids")),
        "submitted_at": _ts(r.get("submitted_at"), "submitted_at"), "source_label": SYNTHETIC}

    def worklog(r): return {
        "worklog_id": _req(r, "worklog_id"), "team_id": _req(r, "team_id"), "member_id": _req(r, "member_id"),
        "task_id": _s(r.get("task_id")), "hours": _num(_req(r, "hours"), "hours"),
        "description": _s(r.get("description")), "work_date": _date(_req(r, "work_date"), "work_date"),
        "evidence_url": _s(r.get("evidence_url")), "source_label": SYNTHETIC}

    def gh_event(r): return {
        "event_id": _req(r, "event_id"), "team_id": _req(r, "team_id"), "member_id": _s(r.get("member_id")),
        "github_username": _s(r.get("github_username")), "event_type": _req(r, "event_type"),
        "task_id": _s(r.get("task_id")), "title_or_message": _s(r.get("title_or_message")),
        "occurred_at": _ts(r.get("occurred_at"), "occurred_at"), "repository_url": _s(r.get("repository_url")),
        "source_url": _s(r.get("source_url")), "source_label": SYNTHETIC}

    def evidence_from_event(r):
        e = gh_event(r)
        return {"evidence_id": e["event_id"], "team_id": e["team_id"], "project_id": project_id,
                "member_id": e["member_id"], "task_id": e["task_id"], "source": "github_synthetic",
                "evidence_type": e["event_type"], "github_username": e["github_username"],
                "title": e["title_or_message"], "url": e["source_url"], "occurred_at": e["occurred_at"],
                "source_label": SYNTHETIC, "raw": {"fixture": True, "repository_url": e["repository_url"]}}

    def evidence_from_worklog(r):
        w = worklog(r)
        return {"evidence_id": w["worklog_id"], "team_id": w["team_id"], "project_id": project_id,
                "member_id": w["member_id"], "task_id": w["task_id"], "source": "worklog",
                "evidence_type": "worklog", "title": w["description"], "url": w["evidence_url"],
                "hours": w["hours"], "occurred_at": f"{w['work_date']}T00:00:00+00:00",
                "source_label": SYNTHETIC, "raw": {"fixture": True}}

    def evidence_from_standup(r):
        s = standup(r)
        return {"evidence_id": s["standup_id"], "team_id": s["team_id"], "project_id": project_id,
                "member_id": s["member_id"], "task_id": (s["claimed_task_ids"] or [None])[0], "source": "standup",
                "evidence_type": "standup_claim", "title": s["today"] or s["yesterday"], "occurred_at": s["submitted_at"],
                "source_label": SYNTHETIC, "raw": {"fixture": True, "self_reported": True,
                                                   "claimed_task_ids": s["claimed_task_ids"]}}

    def risk(r): return {
        "assessment_id": _req(r, "assessment_id"), "team_id": _req(r, "team_id"), "member_id": _s(r.get("member_id")),
        "run_id": _s(r.get("run_id")), "status": _req(r, "status"), "risk_level": _s(r.get("risk_level")) or "none",
        "summary": _s(r.get("summary")), "evidence_ids": _list(r.get("evidence_ids")),
        "missing_context": _s(r.get("missing_context")), "recommended_action": _s(r.get("recommended_action")),
        "source_label": SYNTHETIC, "created_at": _ts(r.get("created_at"), "created_at")}

    def replan(r): return {
        "replan_id": _req(r, "replan_id"), "team_id": _req(r, "team_id"), "sprint_id": _s(r.get("sprint_id")),
        "run_id": _s(r.get("run_id")), "trigger_member_id": _s(r.get("trigger_member_id")),
        "trigger_reason": _s(r.get("trigger_reason")), "task_id": _s(r.get("task_id")),
        "current_assignee_id": _s(r.get("current_assignee_id")), "proposed_assignee_id": _s(r.get("proposed_assignee_id")),
        "proposal_status": _s(r.get("proposal_status")) or "draft", "capacity_check": _s(r.get("capacity_check")),
        "dependency_check": _s(r.get("dependency_check")), "rationale": _s(r.get("rationale")),
        "source_label": SYNTHETIC, "created_at": _ts(r.get("created_at"), "created_at")}

    def approval(r): return {
        "approval_id": _req(r, "approval_id"), "team_id": _req(r, "team_id"), "run_id": _s(r.get("run_id")),
        "replan_id": _s(r.get("replan_id")), "requested_by": _s(r.get("requested_by")),
        "reviewer_id": _s(r.get("reviewer_id")), "status": _s(r.get("status")) or "pending",
        "decision_reason": _s(r.get("decision_reason")), "source_label": SYNTHETIC,
        "created_at": _ts(r.get("created_at"), "created_at")}

    def toolcall(r): return {
        "tool_call_id": _req(r, "tool_call_id"), "run_id": _s(r.get("run_id")), "team_id": team_id,
        "tool_name": _req(r, "tool_name"), "status": _req(r, "status"),
        "latency_ms": int(_num(r.get("latency_ms"), "latency_ms") or 0),
        "result_count": None if _s(r.get("result_count")) is None else int(_num(r.get("result_count"), "result_count")),
        "source_label": SYNTHETIC}

    def audit(r): return {
        "audit_event_id": _req(r, "audit_event_id"), "team_id": _req(r, "team_id"), "run_id": _s(r.get("run_id")),
        "actor_id": _s(r.get("actor_id")), "action": _req(r, "action"), "target_id": _s(r.get("target_id")),
        "before_json": _json(r.get("before_json"), "before_json"), "after_json": _json(r.get("after_json"), "after_json"),
        "reason": _s(r.get("reason")), "source_label": SYNTHETIC, "created_at": _ts(r.get("created_at"), "created_at")}

    return [
        Spec("teams", "team_id", [{}], team_row),
        Spec("projects", "project_id", [{}], project_row, {"team_id": "teams"}),
        Spec("team_members", "member_id", members_rows, member, {"team_id": "teams"}),
        Spec("sprints", "sprint_id", T.get("sprints", []), sprint, {"team_id": "teams", "project_id": "projects"}),
        Spec("tasks", "task_id", T.get("tasks", []), task,
             {"team_id": "teams", "project_id": "projects", "sprint_id": "sprints", "assignee_id": "team_members"}),
        Spec("agent_runs", "run_id", [{"run_id": r} for r in run_ids], run, {"team_id": "teams"}),
        Spec("standups", "standup_id", T.get("standups", []), standup, {"team_id": "teams", "member_id": "team_members"}),
        Spec("worklogs", "worklog_id", T.get("worklogs", []), worklog,
             {"team_id": "teams", "member_id": "team_members", "task_id": "tasks"}),
        Spec("github_events", "event_id", T.get("github_events", []), gh_event,
             {"team_id": "teams", "member_id": "team_members", "task_id": "tasks"}),
        Spec("evidence", "evidence_id", T.get("github_events", []), evidence_from_event,
             {"team_id": "teams", "project_id": "projects", "member_id": "team_members", "task_id": "tasks"}),
        Spec("evidence", "evidence_id", T.get("worklogs", []), evidence_from_worklog,
             {"team_id": "teams", "project_id": "projects", "member_id": "team_members", "task_id": "tasks"}),
        Spec("evidence", "evidence_id", T.get("standups", []), evidence_from_standup,
             {"team_id": "teams", "project_id": "projects", "member_id": "team_members", "task_id": "tasks"}),
        Spec("risk_assessments", "assessment_id", T.get("risk_assessments", []), risk,
             {"team_id": "teams", "member_id": "team_members", "run_id": "agent_runs"}),
        Spec("sprint_replans", "replan_id", T.get("sprint_replans", []), replan,
             {"team_id": "teams", "sprint_id": "sprints", "run_id": "agent_runs", "trigger_member_id": "team_members",
              "task_id": "tasks", "current_assignee_id": "team_members", "proposed_assignee_id": "team_members"}),
        Spec("approval_queue", "approval_id", T.get("approval_queue", []), approval,
             {"team_id": "teams", "run_id": "agent_runs", "replan_id": "sprint_replans"}),
        Spec("tool_call_logs", "tool_call_id", T.get("tool_call_logs", []), toolcall,
             {"team_id": "teams", "run_id": "agent_runs"}),
        Spec("audit_events", "audit_event_id", T.get("audit_events", []), audit,
             {"team_id": "teams", "run_id": "agent_runs"}),
    ]


# ---------- engine ----------

def validate_specs(specs: list[Spec]) -> list[tuple[Spec, list[dict], TableSeedResult]]:
    """Convert rows and check FK consistency in dependency order. Pure: no database access."""
    known: dict[str, set[str]] = {}
    out = []
    for spec in specs:
        res = TableSeedResult(table=spec.table)
        good: list[dict] = []
        for i, raw in enumerate(spec.rows, start=1):
            try:
                row = spec.convert(raw)
                for col, ref_table in spec.fks.items():
                    val = row.get(col)
                    if val is not None and val not in known.get(ref_table, set()):
                        raise ValueError(f"{col}={val!r} references missing {ref_table} row")
                good.append(row)
            except (ValueError, KeyError, TypeError) as exc:
                res.failed += 1
                res.errors.append(f"{spec.table} row {i}: {exc}")
        known.setdefault(spec.table, set()).update(r[spec.pk] for r in good)
        out.append((spec, good, res))
    return out


def _existing_ids(db, table: str, pk: str, ids: list[str]) -> set[str]:
    found: set[str] = set()
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        found.update(r[pk] for r in db.table(table).select(pk).in_(pk, chunk).execute().data or [])
    return found


def run_seed(team_id: str | None = None, dry_run: bool = False) -> SeedResponse:
    ds = read_dataset(find_zip())
    dataset_team = _req(ds["project"], "team_id")
    if team_id and team_id != dataset_team:
        raise NotFoundError(f"No synthetic dataset for team '{team_id}' (available: {dataset_team})")
    validated = validate_specs(build_specs(ds, dataset_team))

    db = None
    if not dry_run:
        from app.database import get_supabase
        db = get_supabase()

    merged: dict[str, TableSeedResult] = {}
    for spec, rows, res in validated:
        if db is not None and rows:
            ids = [r[spec.pk] for r in rows]
            try:
                existing = _existing_ids(db, spec.table, spec.pk, ids)
            except Exception as exc:
                raise AppError(f"Database unavailable while seeding '{spec.table}': {exc}") from exc
            try:
                db.table(spec.table).upsert(rows, on_conflict=spec.pk).execute()
                done = rows
            except Exception as exc:
                logger.warning("Batch upsert into %s failed (%s); retrying row by row", spec.table, exc)
                done = []
                for r in rows:
                    try:
                        db.table(spec.table).upsert(r, on_conflict=spec.pk).execute()
                        done.append(r)
                    except Exception as row_exc:
                        res.failed += 1
                        res.errors.append(f"{spec.table} {r[spec.pk]}: {row_exc}")
            res.updated = sum(1 for r in done if r[spec.pk] in existing)
            res.inserted = len(done) - res.updated
        else:
            res.inserted = len(rows)  # dry run: everything would be written
        tot = merged.setdefault(spec.table, TableSeedResult(table=spec.table))
        tot.inserted += res.inserted
        tot.updated += res.updated
        tot.failed += res.failed
        tot.errors += res.errors
        logger.info("seed %s: +%d ~%d !%d", spec.table, res.inserted, res.updated, res.failed)

    tables = list(merged.values())
    return SeedResponse(
        team_id=dataset_team, dry_run=dry_run,
        inserted=sum(t.inserted for t in tables), updated=sum(t.updated for t in tables),
        failed=sum(t.failed for t in tables), tables=tables,
    )
