"""Read-only GitHub REST adapter (HTTPX). Raises GitHubError; never returns fabricated data."""
import logging
import time
from typing import Any, Literal

import httpx

logger = logging.getLogger("fairsprint.github")

ErrorKind = Literal["config", "auth", "rate_limited", "not_found", "unavailable"]


class GitHubError(Exception):
    def __init__(self, kind: ErrorKind, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message


class GitHubClient:
    def __init__(self, token: str, owner: str, repo: str, *, base_url: str = "https://api.github.com",
                 timeout: float = 10.0, max_retries: int = 2, max_pages: int = 3, per_page: int = 50,
                 max_rate_wait: float = 3.0, transport: httpx.BaseTransport | None = None):
        if not (token and owner and repo):
            raise GitHubError("config", "GITHUB_TOKEN, GITHUB_REPO_OWNER and GITHUB_REPO_NAME must all be set")
        self.owner, self.repo = owner, repo
        self.max_retries, self.max_pages, self.per_page, self.max_rate_wait = max_retries, max_pages, per_page, max_rate_wait
        self.rate_limit_remaining: int | None = None
        self._http = httpx.Client(
            base_url=base_url, timeout=timeout, transport=transport,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fairsprint-ai"},
        )

    def close(self) -> None:
        self._http.close()

    # ---- low level ----

    def _get(self, url: str, params: dict | None = None) -> httpx.Response:
        last = "unknown error"
        for attempt in range(self.max_retries + 1):
            try:
                resp = self._http.get(url, params=params)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = f"{type(exc).__name__}: {exc}"
            else:
                remaining = resp.headers.get("x-ratelimit-remaining")
                if remaining is not None and remaining.isdigit():
                    self.rate_limit_remaining = int(remaining)
                code = resp.status_code
                if code < 400:
                    return resp
                if code == 401:
                    raise GitHubError("auth", "GitHub rejected the token (401). Check GITHUB_TOKEN.")
                if code in (403, 429):
                    retry_after = resp.headers.get("retry-after")
                    limited = remaining == "0" or retry_after is not None or "rate limit" in resp.text.lower()
                    if not limited:
                        raise GitHubError("auth", "GitHub denied access (403). The token lacks read access to this repository.")
                    wait = float(retry_after) if retry_after and retry_after.isdigit() else None
                    if wait is not None and wait <= self.max_rate_wait and attempt < self.max_retries:
                        time.sleep(wait)
                        continue
                    reset = resp.headers.get("x-ratelimit-reset")
                    raise GitHubError("rate_limited", f"GitHub rate limit reached (resets at epoch {reset}).")
                if code == 404:
                    raise GitHubError("not_found", f"GitHub returned 404 for {url}. Check repo owner/name and token access.")
                if code >= 500:
                    last = f"GitHub server error {code}"
                else:
                    raise GitHubError("unavailable", f"Unexpected GitHub response {code} for {url}")
            if attempt < self.max_retries:
                time.sleep(0.5 * (2 ** attempt))
        raise GitHubError("unavailable", f"GitHub unreachable after {self.max_retries + 1} attempts: {last}")

    def _paginate(self, path: str, params: dict | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        url: str | None = path
        query: dict | None = {**(params or {}), "per_page": self.per_page}
        for _ in range(self.max_pages):
            resp = self._get(url, query)
            data = resp.json()
            if not isinstance(data, list):
                raise GitHubError("unavailable", f"Expected a list from {path}")
            items.extend(data)
            url = resp.links.get("next", {}).get("url")
            query = None  # the next URL already carries its query string
            if not url:
                break
        return items

    # ---- public read-only API ----

    @property
    def _repo_path(self) -> str:
        return f"/repos/{self.owner}/{self.repo}"

    def validate_repo(self) -> dict[str, Any]:
        return self._get(self._repo_path).json()

    def commits(self, since: str) -> list[dict[str, Any]]:
        return self._paginate(f"{self._repo_path}/commits", {"since": since})

    def pull_requests(self) -> list[dict[str, Any]]:
        return self._paginate(f"{self._repo_path}/pulls", {"state": "all", "sort": "updated", "direction": "desc"})

    def pull_reviews(self, number: int) -> list[dict[str, Any]]:
        return self._paginate(f"{self._repo_path}/pulls/{number}/reviews")

    def issues(self, since: str) -> list[dict[str, Any]]:
        return self._paginate(f"{self._repo_path}/issues", {"state": "all", "since": since})

    def issue_comments(self, since: str) -> list[dict[str, Any]]:
        return self._paginate(f"{self._repo_path}/issues/comments", {"since": since})
