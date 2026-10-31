from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field

from app.agents.repository import Repo
from app.auth import get_repo, mentor_from_authorization
from app.services.turnstile_service import TurnstileVerifier, get_turnstile_verifier

router = APIRouter(tags=["auth"])
RepoDep = Annotated[Repo, Depends(get_repo)]
VerifierDep = Annotated[TurnstileVerifier, Depends(get_turnstile_verifier)]


class MentorLoginRequest(BaseModel):
    turnstile_token: str | None = Field(default=None, max_length=4096)


class MentorLoginResponse(BaseModel):
    mentor_id: str
    team_id: str
    name: str


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()  # Render's proxy sets this
    return forwarded or (request.client.host if request.client else None)


@router.post("/auth/mentor-login", response_model=MentorLoginResponse,
             description="Sign-in gate for the mentor token (sent as the bearer token). Human verification (Cloudflare Turnstile, "
                         "when enabled) is checked FIRST, so this endpoint cannot be used to probe which tokens are valid.")
def mentor_login(request: Request, repo: RepoDep, verifier: VerifierDep, authorization: Annotated[str | None, Header()] = None,
                 body: MentorLoginRequest | None = None):
    verifier.verify(body.turnstile_token if body else None, _client_ip(request), action="mentor_login")
    mentor = mentor_from_authorization(repo, authorization)
    return MentorLoginResponse(mentor_id=mentor.mentor_id, team_id=mentor.team_id, name=mentor.name)
