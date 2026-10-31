"""Turnstile verification with Cloudflare's siteverify mocked. No real credentials or network are used."""
import logging
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agents.repository import Repo
from app.auth import get_repo
from app.config import Settings
from app.errors import AppError
from app.main import app
from app.services.turnstile_service import SITEVERIFY_URL, TurnstileVerifier, get_turnstile_verifier
from conftest import TOKEN

SECRET = "test-secret-not-real"
HOST = "finale-ziro-h79s.onrender.com"
GOOD = {"success": True, "hostname": HOST, "action": "mentor_login", "challenge_ts": "2026-10-31T10:00:00Z"}


def settings(**kw) -> Settings:
    base = dict(turnstile_enabled=True, turnstile_secret_key=SECRET, turnstile_allowed_hostnames=HOST)
    return Settings(_env_file=None, **{**base, **kw})


class Cloudflare:
    """Scripted siteverify: replies in order (repeating the last), records every request it receives."""

    def __init__(self, *replies):
        self.replies, self.requests = list(replies), []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        reply = self.replies[min(len(self.requests) - 1, len(self.replies) - 1)]
        if isinstance(reply, Exception):
            raise reply
        status, body = reply if isinstance(reply, tuple) else (200, reply)
        return httpx.Response(status, json=body) if isinstance(body, (dict, list)) else httpx.Response(status, text=body)

    def form(self, i=0) -> dict:
        return {k: v[0] for k, v in parse_qs(self.requests[i].content.decode()).items()}


def verifier(cf: Cloudflare, **kw) -> TurnstileVerifier:
    return TurnstileVerifier(settings(**kw), transport=httpx.MockTransport(cf))


def rejected(v: TurnstileVerifier, token="tok", **kw) -> AppError:
    with pytest.raises(AppError) as e:
        v.verify(token, **kw)
    return e.value


def test_successful_verification_sends_secret_token_and_ip():
    cf = Cloudflare(GOOD)
    verifier(cf).verify("tok-1", remote_ip="203.0.113.7", action="mentor_login")
    assert str(cf.requests[0].url) == SITEVERIFY_URL and cf.requests[0].method == "POST"
    assert cf.form() == {"secret": SECRET, "response": "tok-1", "remoteip": "203.0.113.7"}


def test_remote_ip_is_omitted_when_unknown():
    cf = Cloudflare(GOOD)
    verifier(cf).verify("tok-1", action="mentor_login")
    assert "remoteip" not in cf.form()


def test_invalid_token_is_rejected():
    e = rejected(verifier(Cloudflare({"success": False, "error-codes": ["invalid-input-response"]})))
    assert (e.status_code, e.code) == (403, "turnstile_failed")


def test_expired_token_is_rejected():
    e = rejected(verifier(Cloudflare({"success": False, "error-codes": ["timeout-or-duplicate"]})))
    assert (e.status_code, e.code) == (403, "turnstile_expired")


@pytest.mark.parametrize("token", [None, "", "   "])
def test_missing_token_is_rejected_without_calling_cloudflare(token):
    cf = Cloudflare(GOOD)
    e = rejected(verifier(cf), token=token)
    assert (e.status_code, e.code) == (400, "turnstile_required") and not cf.requests


def test_oversized_token_is_rejected_without_calling_cloudflare():
    cf = Cloudflare(GOOD)
    e = rejected(verifier(cf), token="x" * 2049)
    assert e.code == "turnstile_failed" and not cf.requests


def test_replayed_token_is_refused_without_a_second_cloudflare_call():
    cf = Cloudflare(GOOD)
    v = verifier(cf)
    v.verify("tok-1", action="mentor_login")
    e = rejected(v, token="tok-1", action="mentor_login")
    assert (e.status_code, e.code) == (403, "turnstile_expired") and len(cf.requests) == 1


def test_failed_verification_does_not_burn_the_token_slot_for_a_fresh_token():
    cf = Cloudflare({"success": False, "error-codes": ["invalid-input-response"]}, GOOD)
    v = verifier(cf)
    rejected(v, token="bad", action="mentor_login")
    v.verify("fresh", action="mentor_login")


@pytest.mark.parametrize("failure", [httpx.ReadTimeout("slow"), httpx.ConnectError("down"), (500, {"x": 1}), (200, "<html>not json</html>"),
                                     (200, ["not", "a", "dict"])])
def test_cloudflare_timeout_or_outage_fails_closed(failure):
    e = rejected(verifier(Cloudflare(failure)))
    assert (e.status_code, e.code) == (503, "turnstile_unavailable")


def test_disabled_turnstile_allows_local_development_without_calling_cloudflare():
    cf = Cloudflare(GOOD)
    verifier(cf, turnstile_enabled=False, turnstile_secret_key="").verify(None)
    assert not cf.requests


def test_missing_secret_fails_closed_when_enabled():
    cf = Cloudflare(GOOD)
    e = rejected(verifier(cf, turnstile_secret_key=""))
    assert (e.status_code, e.code) == (503, "turnstile_unavailable") and not cf.requests


def test_cloudflare_rejecting_our_secret_fails_closed():
    e = rejected(verifier(Cloudflare({"success": False, "error-codes": ["invalid-input-secret"]})))
    assert e.status_code == 503


def test_hostname_must_match():
    e = rejected(verifier(Cloudflare({**GOOD, "hostname": "evil.example.com"})), action="mentor_login")
    assert (e.status_code, e.code) == (403, "turnstile_failed")


def test_localhost_hostname_is_accepted_only_when_configured():
    local = {**GOOD, "hostname": "localhost"}
    assert rejected(verifier(Cloudflare(local)), action="mentor_login").code == "turnstile_failed"
    verifier(Cloudflare(local), turnstile_allowed_hostnames=f"{HOST}, LOCALHOST").verify("t", action="mentor_login")


def test_action_must_match():
    e = rejected(verifier(Cloudflare({**GOOD, "action": "something_else"})), action="mentor_login")
    assert e.code == "turnstile_failed"


def test_secret_and_full_token_are_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    token = "SUPER-LONG-VERIFICATION-TOKEN-" + "z" * 40
    for reply in ({"success": False, "error-codes": ["invalid-input-response"]}, httpx.ReadTimeout("slow"),
                  {"success": False, "error-codes": ["invalid-input-secret"]}):
        rejected(verifier(Cloudflare(reply)), token=token)
    rejected(verifier(Cloudflare(GOOD), turnstile_secret_key=""), token=token)
    assert caplog.records and SECRET not in caplog.text and token not in caplog.text and token[:20] not in caplog.text


# ---- the sign-in endpoint ----
@pytest.fixture
def login(db):
    holder = {}

    def make(cf: Cloudflare, **kw) -> TestClient:
        holder["v"] = verifier(cf, **kw)
        app.dependency_overrides[get_repo] = lambda: Repo(db)
        app.dependency_overrides[get_turnstile_verifier] = lambda: holder["v"]
        return TestClient(app)

    yield make
    app.dependency_overrides.clear()


def post(client, token=TOKEN, turnstile="tok", extra_headers=None):
    body = {} if turnstile is None else {"turnstile_token": turnstile}
    return client.post("/auth/mentor-login", json=body, headers={"Authorization": f"Bearer {token}", **(extra_headers or {})})


def test_login_succeeds_with_valid_turnstile_and_mentor_token(login):
    cf = Cloudflare(GOOD)
    r = post(login(cf))
    assert r.status_code == 200 and r.json() == {"mentor_id": "MENTOR001", "team_id": "team_fs_001", "name": "Mentor"}
    assert cf.form()["response"] == "tok"


def test_turnstile_is_checked_before_the_mentor_token_so_tokens_cannot_be_probed(login):
    r = post(login(Cloudflare({"success": False, "error-codes": ["invalid-input-response"]})), token="not-a-real-token")
    assert r.status_code == 403 and r.json()["code"] == "turnstile_failed"  # not 401: validity of the token stays hidden


def test_login_without_turnstile_token_is_rejected_when_enabled(login):
    client = login(Cloudflare(GOOD))
    r = post(client, turnstile=None)
    assert r.status_code == 400 and r.json()["code"] == "turnstile_required"
    assert client.post("/auth/mentor-login", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 400  # no body at all


def test_login_with_a_valid_turnstile_but_wrong_mentor_token_is_401(login):
    assert post(login(Cloudflare(GOOD)), token="bogus").status_code == 401


def test_login_endpoint_replay_is_rejected(login):
    client = login(Cloudflare(GOOD))
    assert post(client).status_code == 200
    again = post(client)
    assert again.status_code == 403 and again.json()["code"] == "turnstile_expired"


def test_login_endpoint_fails_closed_on_cloudflare_outage(login):
    r = post(login(Cloudflare(httpx.ConnectError("down"))))
    assert r.status_code == 503 and r.json()["code"] == "turnstile_unavailable"


def test_login_works_without_turnstile_when_disabled_but_still_checks_the_mentor_token(login):
    cf = Cloudflare(GOOD)
    client = login(cf, turnstile_enabled=False, turnstile_secret_key="")
    assert post(client, turnstile=None).status_code == 200 and post(client, token="bogus", turnstile=None).status_code == 401
    assert not cf.requests


def test_forwarded_ip_reaches_cloudflare(login):
    cf = Cloudflare(GOOD)
    post(login(cf), extra_headers={"X-Forwarded-For": "198.51.100.9, 10.0.0.1"})
    assert cf.form().get("remoteip") == "198.51.100.9"
