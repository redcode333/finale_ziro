"""Thin Supabase access layer for the agent. Uses only select/eq/in_/order/upsert/update so it is easy to fake."""
import json
from datetime import datetime, timezone
from typing import Any

from app.database import get_supabase


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Repo:
    def __init__(self, db=None):
        self.db = db or get_supabase()

    # ---- generic ----
    def select(self, table: str, **eq: Any) -> list[dict]:
        q = self.db.table(table).select("*")
        for k, v in eq.items():
            q = q.eq(k, v)
        return q.execute().data or []

    def one(self, table: str, **eq: Any) -> dict | None:
        rows = self.select(table, **eq)
        return rows[0] if rows else None

    def upsert(self, table: str, rows: list[dict] | dict, pk: str) -> None:
        rows = rows if isinstance(rows, list) else [rows]
        if rows:
            self.db.table(table).upsert(rows, on_conflict=pk).execute()

    def update(self, table: str, pk: str, pk_value: str, values: dict) -> None:
        self.db.table(table).update(values).eq(pk, pk_value).execute()

    # ---- runs ----
    def get_run(self, run_id: str) -> dict | None:
        return self.one("agent_runs", run_id=run_id)

    def save_run(self, run_id: str, values: dict) -> None:
        self.upsert("agent_runs", {"run_id": run_id, **values}, "run_id")

    def save_state(self, run_id: str, phase: str, state: dict, status: str | None = None, **extra) -> None:
        values = {"phase": phase, "state": json.loads(json.dumps(state, default=str)), **extra}
        if status:
            values["status"] = status
        self.update("agent_runs", "run_id", run_id, values)

    # ---- audit ----
    def audit(self, team_id: str, run_id: str | None, actor: str, action: str, target: str | None,
              before: dict | None = None, after: dict | None = None, reason: str | None = None,
              event_id: str | None = None) -> None:
        eid = event_id or f"AU-{run_id or 'x'}-{action}-{target}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        self.upsert("audit_events", {
            "audit_event_id": eid, "team_id": team_id, "run_id": run_id, "actor_id": actor, "action": action,
            "target_id": target, "before_json": before or {}, "after_json": after or {}, "reason": reason,
            "source_label": "live"}, "audit_event_id")
