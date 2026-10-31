"""Normalize raw GitHub API payloads into the Evidence schema (source_label='live')."""
from typing import Any

from app.schemas.data import Evidence


def _login(obj: dict | None) -> str | None:
    return (obj or {}).get("login")


def _first_line(text: str | None, limit: int = 140) -> str | None:
    if not text:
        return None
    return text.strip().splitlines()[0][:limit] if text.strip() else None


def _ev(evidence_id: str, evidence_type: str, *, login: str | None, title: str | None, url: str | None,
        occurred_at: str | None, raw: dict, team_id: str | None, project_id: str | None,
        members: dict[str, str]) -> Evidence:
    return Evidence(
        evidence_id=evidence_id, team_id=team_id, project_id=project_id,
        member_id=members.get((login or "").lower()), source="github_api", evidence_type=evidence_type,
        github_username=login, title=title, url=url, occurred_at=occurred_at, source_label="live", raw=raw,
    )


def normalize_commit(c: dict[str, Any], **ctx) -> Evidence:
    commit = c.get("commit") or {}
    author = commit.get("author") or {}
    return _ev(f"gh:commit:{c['sha']}", "commit", login=_login(c.get("author")),
               title=_first_line(commit.get("message")), url=c.get("html_url"), occurred_at=author.get("date"),
               raw={"sha": c["sha"], "author_name": author.get("name")}, **ctx)


def normalize_pull_request(p: dict[str, Any], **ctx) -> Evidence:
    return _ev(f"gh:pr:{p['number']}", "pull_request", login=_login(p.get("user")), title=p.get("title"),
               url=p.get("html_url"), occurred_at=p.get("created_at"),
               raw={"number": p["number"], "state": p.get("state"), "merged_at": p.get("merged_at")}, **ctx)


def normalize_review(r: dict[str, Any], pr_number: int, **ctx) -> Evidence:
    return _ev(f"gh:review:{r['id']}", "pull_request_review", login=_login(r.get("user")),
               title=f"Review ({r.get('state', 'UNKNOWN').lower()}) on PR #{pr_number}", url=r.get("html_url"),
               occurred_at=r.get("submitted_at"), raw={"pr_number": pr_number, "state": r.get("state")}, **ctx)


def normalize_issue(i: dict[str, Any], **ctx) -> Evidence | None:
    if "pull_request" in i:  # the issues API also lists PRs; those are covered by pull_requests
        return None
    return _ev(f"gh:issue:{i['number']}", "issue", login=_login(i.get("user")), title=i.get("title"),
               url=i.get("html_url"), occurred_at=i.get("created_at"),
               raw={"number": i["number"], "state": i.get("state")}, **ctx)


def normalize_issue_comment(c: dict[str, Any], **ctx) -> Evidence:
    return _ev(f"gh:issue_comment:{c['id']}", "issue_comment", login=_login(c.get("user")),
               title=_first_line(c.get("body")), url=c.get("html_url"), occurred_at=c.get("created_at"),
               raw={"issue_url": c.get("issue_url")}, **ctx)
