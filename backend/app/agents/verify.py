"""Deterministic verification, risk classification and replan scoring. No LLM, no I/O.

The LLM may interpret evidence, but it can never create evidence, raise a status, or decide whether a tool succeeded.
"""
import re
from datetime import date, datetime
from typing import Any

CODE_TYPES = {"commit", "pull_request"}
COLLAB_TYPES = {"issue", "issue_comment"}
REVIEW_TYPES = {"pull_request_review"}
MIN_TITLE_CHARS = 12
MIN_WORKLOG_HOURS = 1.0

_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_INJECTION = re.compile(
    r"(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|system)\b.{0,30}\b(instruction|prompt|rule)s?"
    r"|\bsystem prompt\b|\bmark (me|this|them|it)\b.{0,20}\b(as )?(verified|complete|done)\b"
    r"|\byou are now\b|\bnew instructions?\b|\boverride\b.{0,20}\b(polic|rule|instruction)", re.I | re.S)
_BANNED = re.compile(r"free[\s-]?rider|\blazy\b|\bslack(er|ing)\b|\binactive\b|\bdishonest\b|\blying\b|\bliar\b|\bfraud\w*", re.I)
_EXPLICIT_COMPLETION = re.compile(
    r"\b(all|both|every)\b.{0,40}\btasks?\b.{0,30}\b(complete|completed|done|finished)\b"
    r"|\btasks?\b.{0,30}\b(is|are)\b.{0,10}\b(complete|completed|done|finished)\b"
    r"|^\s*(finished|completed)\s+(the\s+|my\s+)?(sprint|task|replan|feature|report)\b", re.I | re.S)


def sanitize(text: Any, limit: int = 300) -> str:
    """Untrusted text -> short, control-character-free string."""
    s = _CTRL.sub(" ", str(text or ""))
    return re.sub(r"\s+", " ", s).strip()[:limit]


def detect_injection(text: str) -> bool:
    return bool(_INJECTION.search(text or ""))


def scrub_labels(text: str) -> str:
    """Remove accusatory labels from generated text."""
    return _BANNED.sub("[label removed]", text or "")


def explicit_completion(text: str) -> bool:
    return bool(_EXPLICIT_COMPLETION.search(text or ""))


def compact_evidence(e: dict) -> dict:
    return {"id": e["evidence_id"], "member_id": e.get("member_id"), "task_id": e.get("task_id"),
            "type": e.get("evidence_type"), "source": e.get("source"), "source_label": e.get("source_label"),
            "title": sanitize(e.get("title"), 140), "hours": e.get("hours"),
            "occurred_at": str(e["occurred_at"]) if e.get("occurred_at") else None, "url": e.get("url")}


def is_substantive(e: dict) -> bool:
    if e["type"] == "worklog":
        return (e.get("hours") or 0) >= MIN_WORKLOG_HOURS
    return len(e.get("title") or "") >= MIN_TITLE_CHARS


def _kind(e: dict) -> str:
    t = e["type"]
    return "code" if t in CODE_TYPES else "review" if t in REVIEW_TYPES else "collab" if t in COLLAB_TYPES else "worklog"


def in_window(e: dict, window: dict) -> bool:
    if not e.get("occurred_at"):
        return True
    day = str(e["occurred_at"])[:10]
    return window["start"] <= day <= window["end"]


def verify_member(claim: dict, tasks_by_id: dict, evidence: list[dict]) -> dict:
    """Match one member's standup claim to evidence. `evidence` = all collected items (all members)."""
    mid = claim["member_id"]
    mine = [e for e in evidence if e.get("member_id") == mid and e["type"] != "standup_claim"]  # standups are self-reported
    claimed = claim["task_ids"]
    explicit = claim["explicit_completion"]
    per_task, contradictions = [], []
    for tid in claimed:
        t = tasks_by_id.get(tid)
        ev = [e for e in mine if e.get("task_id") == tid]
        sub = [e for e in ev if is_substantive(e)]
        contradicted = bool(explicit and t and t["status"] != "done")
        if contradicted:
            contradictions.append(tid)
        per_task.append({"task_id": tid, "task_status": t["status"] if t else "unknown", "evidence_ids": [e["id"] for e in ev],
                         "substantive_ids": [e["id"] for e in sub], "kinds": sorted({_kind(e) for e in sub}),
                         "contradicts_completion_claim": contradicted})
    claimed_ev = [e for e in mine if e.get("task_id") in claimed]
    sub_all = [e for e in claimed_ev if is_substantive(e)]
    return {"member_id": mid, "standup_id": claim["standup_id"], "claim_text": claim["claim_text"],
            "claimed_task_ids": claimed, "explicit_completion_claim": explicit, "per_task": per_task,
            "independent_evidence_ids": [e["id"] for e in claimed_ev],
            "substantive_evidence_ids": [e["id"] for e in sub_all],
            "substantive_kinds": sorted({_kind(e) for e in sub_all}), "contradicted_tasks": contradictions,
            "source_labels": sorted({e["source_label"] for e in claimed_ev if e.get("source_label")})}


def classify(v: dict | None, member_id: str, llm: dict | None, valid_ids: set[str], unavailable_sources: list[str],
             has_standup: bool = True) -> dict:
    """Deterministic status from linked evidence and task state. The LLM is advisory: it supplies the explanation and a
    flagged disagreement, but it can neither raise nor lower a status (a model opinion must not create false positives).

    `valid_ids` must be the ids of evidence owned by `member_id`: a model-cited id outside it is ignored, so one member's
    assessment can never rest on a teammate's work."""
    missing = [f"Source unavailable: {s} (not evidence of zero contribution)" for s in unavailable_sources]
    llm_ids = [i for i in (llm or {}).get("evidence_ids", []) if i in valid_ids]
    note = ""
    if llm:
        note = f"Model interpretation (advisory, {llm.get('claim_support')}): " + scrub_labels(sanitize(llm.get("reasoning"), 450))
    if not has_standup or v is None:
        status = "insufficient_evidence"
        missing.append("No standup in the sprint window; a missing standup is not evidence of non-contribution.")
        facts = "No standup claim available to verify."
        ids: list[str] = []
    else:
        sub, contra = v["substantive_evidence_ids"], v["contradicted_tasks"]
        ids = list(dict.fromkeys(v["independent_evidence_ids"] + llm_ids))
        if not sub:
            if contra and not unavailable_sources:
                status, facts = "unverified", f"Completion was claimed for {', '.join(contra)} but no substantive linked evidence was found and task state disagrees."
            else:
                status, facts = "insufficient_evidence", "No substantive linked evidence found for the claimed tasks."
        elif contra:
            status = "partially_verified"
            facts = f"Some supporting evidence exists, but completion claimed for {', '.join(contra)} conflicts with task state."
        else:
            status = "verified"
            kinds = "/".join(v["substantive_kinds"])
            facts = f"Substantive linked evidence found ({kinds}): {', '.join(sub)}."
        for t in (v["per_task"] if v else []):
            if t["contradicts_completion_claim"]:
                missing.append(f"{t['task_id']} is '{t['task_status']}' but was claimed complete; clarify.")
            elif not t["substantive_ids"]:
                missing.append(f"No substantive evidence linked to {t['task_id']}.")
    risk = {"verified": "none", "partially_verified": "review_required" if (v and v["contradicted_tasks"]) else "low",
            "unverified": "review_required", "insufficient_evidence": "low"}[status]
    action = {"verified": "No action needed. Non-code work (QA, review, research, docs) counts as contribution.",
              "partially_verified": "Ask the member to link the missing artifacts; mentor to review. This is not a finding of misconduct.",
              "unverified": "Request clarification and mentor review before any conclusion. Do not treat as a finding of misconduct.",
              "insufficient_evidence": "Collect more context (clarify with the member or retry the unavailable source)."}[status]
    disagrees = bool(llm and status == "verified" and llm.get("claim_support") in ("partially_supported", "unsupported"))
    if disagrees:
        missing.append("Model interpretation was more cautious than the deterministic evidence match; mentor may wish to glance at the cited evidence.")
    return {"member_id": member_id, "status": status, "llm_disagrees": disagrees, "risk_level": risk,
            "summary": (facts + (" " + note if note else "")).strip(), "evidence_ids": ids,
            "missing_context": " ".join(missing) or None, "recommended_action": action,
            "claim_support": (llm or {}).get("claim_support"), "needs_mentor_review": risk == "review_required"}


# ---------- replan ----------

def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#.]+", (text or "").lower()) if len(w) >= 2}


def propose_replan(members: list[dict], tasks: list[dict], sprint: dict) -> dict:
    """Proposal only. Never mutates assignments."""
    start, end = date.fromisoformat(sprint["start_date"]), date.fromisoformat(sprint["end_date"])
    weeks = max(1.0, (end - start).days / 7)
    by_id = {m["member_id"]: m for m in members}
    tasks_by_id = {t["task_id"]: t for t in tasks}
    load = {m["member_id"]: 0.0 for m in members}
    for t in tasks:
        if t["status"] != "done" and t.get("assignee_id") in load:
            load[t["assignee_id"]] += t.get("estimate_hours") or 0
    at_risk = [t for t in tasks if t["status"] != "done" and by_id.get(t.get("assignee_id"), {}).get("availability_status") not in (None, "available")]
    proposals = []
    for t in at_risk:
        est = t.get("estimate_hours") or 0
        want = _tokens(f"{t['title']} {t.get('workstream') or ''}")
        cands = []
        for m in members:
            if m["availability_status"] != "available" or m["member_id"] == t["assignee_id"]:
                continue
            remaining = m["weekly_capacity_hours"] * weeks - load[m["member_id"]]
            overlap = len(want & _tokens(" ".join(m.get("skills", [])) + " " + (m.get("role") or "")))
            cands.append((overlap, remaining, m["member_id"]))
        cands.sort(reverse=True)
        pick = next((c for c in cands if c[1] >= est), None)
        deps = [d for d in t.get("dependency_task_ids", []) if d in tasks_by_id]
        open_deps = [d for d in deps if tasks_by_id[d]["status"] != "done"]
        dependents = [x["task_id"] for x in tasks if t["task_id"] in x.get("dependency_task_ids", [])]
        entry = {"task_id": t["task_id"], "task_title": t["title"], "current_assignee_id": t["assignee_id"],
                 "proposed_assignee_id": pick[2] if pick else None, "estimate_hours": est,
                 "capacity_check": ("pass_within_remaining_capacity" if pick else "no_candidate_with_capacity"),
                 "dependency_check": "pass" if not open_deps else f"needs_confirmation: open prerequisites {', '.join(open_deps)}",
                 "dependent_tasks": dependents, "trigger_reason": f"{t['assignee_id']} is {by_id[t['assignee_id']]['availability_status']}",
                 "rationale": (f"{pick[2]} has {pick[1]:.0f}h remaining capacity and skill-overlap {pick[0]}; mentor must approve."
                               if pick else "No available member has enough capacity; mentor decision needed.")}
        if pick:
            load[pick[2]] += est
        proposals.append(entry)
    total = sum(t.get("estimate_hours") or 0 for t in tasks) or 1
    risk_h = sum(p["estimate_hours"] for p in proposals)
    return {"proposals": proposals, "requires_mentor_approval": True, "mutates_assignments": False,
            "impact": {"at_risk_tasks": [p["task_id"] for p in proposals], "at_risk_hours": risk_h,
                       "share_of_sprint_hours": round(risk_h / total, 3),
                       "blocked_dependents": sorted({d for p in proposals for d in p["dependent_tasks"]}),
                       "summary": (f"{len(proposals)} task(s) / {risk_h:g}h ({risk_h / total:.0%} of sprint estimate) are at risk "
                                   "because their owner is unavailable." if proposals else "No tasks at risk from availability.")}}
