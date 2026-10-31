import logging
from datetime import datetime, timedelta, timezone

from app.config import get_settings
from app.schemas.data import Evidence
from app.schemas.github import GitHubActivityResponse, SectionStatus
from app.services import evidence_service as ev
from app.tools.github import GitHubClient, GitHubError

logger = logging.getLogger("fairsprint.github_service")

MAX_PR_REVIEW_LOOKUPS = 15
ZERO_NOTE = "Zero events returned is not evidence of inactivity; it only describes this repository and time window."


def _member_lookup(team_id: str | None) -> dict[str, str]:
    """github_username(lower) -> member_id. Best effort: failure just leaves member_id empty."""
    if not team_id:
        return {}
    try:
        from app.database import get_supabase
        rows = get_supabase().table("team_members").select("member_id,github_username").eq("team_id", team_id).execute().data
        return {r["github_username"].lower(): r["member_id"] for r in rows or [] if r.get("github_username")}
    except Exception as exc:
        logger.warning("Member lookup skipped: %s", exc)
        return {}


def collect_activity(since_days: int = 14, team_id: str | None = None,
                     client: GitHubClient | None = None) -> GitHubActivityResponse:
    s = get_settings()
    repo = f"{s.github_repo_owner}/{s.github_repo_name}"
    base = dict(repository=repo, since_days=since_days)
    owns_client = client is None
    try:
        if client is None:
            client = GitHubClient(s.github_token, s.github_repo_owner, s.github_repo_name)
        client.validate_repo()
    except GitHubError as exc:
        logger.warning("GitHub unavailable: %s", exc.message)
        if owns_client and client is not None:
            client.close()
        return GitHubActivityResponse(source_status="unavailable", error=f"{exc.kind}: {exc.message}",
                                      note="GitHub data could not be retrieved. This is NOT evidence of zero contribution.",
                                      **base)

    since = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    ctx = dict(team_id=team_id, project_id=None, members=_member_lookup(team_id))
    evidence: list[Evidence] = []
    sections: list[SectionStatus] = []

    def run(name: str, fn) -> None:
        try:
            items = [e for e in fn() if e is not None]
            evidence.extend(items)
            sections.append(SectionStatus(section=name, status="ok", count=len(items)))
        except GitHubError as exc:
            logger.warning("GitHub section %s failed: %s", name, exc.message)
            sections.append(SectionStatus(section=name, status="unavailable", error=f"{exc.kind}: {exc.message}"))

    prs: list[dict] = []

    def fetch_prs():
        nonlocal prs
        prs = [p for p in client.pull_requests() if (p.get("updated_at") or "") >= since]
        return [ev.normalize_pull_request(p, **ctx) for p in prs]

    def fetch_reviews():
        out = []
        for p in prs[:MAX_PR_REVIEW_LOOKUPS]:
            out += [ev.normalize_review(r, p["number"], **ctx) for r in client.pull_reviews(p["number"])
                    if (r.get("submitted_at") or "") >= since]
        return out

    try:
        run("commits", lambda: [ev.normalize_commit(c, **ctx) for c in client.commits(since)])
        run("pull_requests", fetch_prs)
        if any(sec.section == "pull_requests" and sec.status == "ok" for sec in sections):
            run("pull_request_reviews", fetch_reviews)
        else:
            sections.append(SectionStatus(section="pull_request_reviews", status="unavailable",
                                          error="skipped: pull requests could not be fetched"))
        run("issues", lambda: [ev.normalize_issue(i, **ctx) for i in client.issues(since)])
        run("issue_comments", lambda: [ev.normalize_issue_comment(c, **ctx) for c in client.issue_comments(since)])
        remaining = client.rate_limit_remaining
    finally:
        if owns_client:
            client.close()

    ok = sum(1 for sec in sections if sec.status == "ok")
    status = "ok" if ok == len(sections) else "partial" if ok else "unavailable"
    evidence.sort(key=lambda e: e.occurred_at.isoformat() if e.occurred_at else "", reverse=True)
    note = None
    if status != "ok":
        note = "Some GitHub sections failed; missing data is NOT evidence of zero contribution."
    elif not evidence:
        note = ZERO_NOTE
    return GitHubActivityResponse(source_status=status, rate_limit_remaining=remaining, sections=sections,
                                  count=len(evidence), evidence=evidence, note=note,
                                  error=None if ok else "All GitHub sections failed", **base)
