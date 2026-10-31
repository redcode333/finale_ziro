"""Mentor authentication: opaque bearer token, only its SHA-256 hash is stored in `mentors`."""
import hashlib
import secrets
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header

from app.agents.repository import Repo
from app.errors import AppError


@dataclass(frozen=True)
class Mentor:
    mentor_id: str
    team_id: str
    name: str


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return "fsm_" + secrets.token_urlsafe(32)


def get_repo() -> Repo:
    return Repo()


def mentor_from_authorization(repo: Repo, authorization: str | None) -> Mentor:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise AppError("Missing bearer token.", status_code=401, code="unauthorized")
    row = repo.one("mentors", token_hash=hash_token(token.strip()))
    if not row or not row.get("active", True):
        raise AppError("Invalid mentor token.", status_code=401, code="unauthorized")
    return Mentor(mentor_id=row["mentor_id"], team_id=row["team_id"], name=row["name"])


def get_current_mentor(repo: Annotated[Repo, Depends(get_repo)],
                       authorization: Annotated[str | None, Header()] = None) -> Mentor:
    return mentor_from_authorization(repo, authorization)


def require_team_scope(mentor: Mentor, team_id: str) -> None:
    if mentor.team_id != team_id:
        raise AppError("This mentor is not authorised for that team.", status_code=403, code="forbidden")


def scoped_to_team(team_id: str, mentor: Annotated[Mentor, Depends(get_current_mentor)]) -> Mentor:
    """Route dependency for /teams/{team_id}/...: 401 without a valid mentor token, 403 for another team's mentor.

    The team check runs before any data access, so an unknown team and another team's team answer identically.
    """
    require_team_scope(mentor, team_id)
    return mentor
