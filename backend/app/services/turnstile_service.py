"""Cloudflare Turnstile server-side verification.

The widget's success in the browser proves nothing: only Cloudflare's siteverify answer does. Protected actions call
`TurnstileVerifier.verify` and fail closed: when Turnstile is enabled, anything other than a clean, fresh, expected
verification (including Cloudflare being unreachable or the secret missing) is rejected.

The secret and the full token are never logged.
"""
import hashlib
import logging
import threading
import time
from functools import lru_cache

import httpx

from app.config import Settings, get_settings
from app.errors import AppError

logger = logging.getLogger("fairsprint.turnstile")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
MAX_TOKEN_LENGTH = 2048          # Cloudflare's documented maximum
TOKEN_TTL_SECONDS = 300          # a Turnstile token is valid for five minutes, and for one verification only
TIMEOUT = httpx.Timeout(5.0, connect=3.0)

_REQUIRED = ("turnstile_required", 400, "Complete the human verification and try again.")
_FAILED = ("turnstile_failed", 403, "Human verification failed. Please try again.")
_EXPIRED = ("turnstile_expired", 403, "Human verification expired or was already used. Please try again.")
_UNAVAILABLE = ("turnstile_unavailable", 503, "Human verification is temporarily unavailable. Please try again shortly.")


def _reject(kind: tuple[str, int, str]) -> AppError:
    code, status, message = kind
    return AppError(message, status_code=status, code=code)


class _UsedTokens:
    """Short-lived, bounded memory of accepted tokens (SHA-256 only), so a replay is refused without another round trip.

    Process-local; Cloudflare's own duplicate detection (`timeout-or-duplicate`) is the authority across instances.
    """

    def __init__(self, ttl: float = TOKEN_TTL_SECONDS, limit: int = 10_000):
        self._ttl, self._limit, self._seen, self._lock = ttl, limit, {}, threading.Lock()

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def _prune(self, now: float) -> None:
        for k in [k for k, t in self._seen.items() if now - t > self._ttl]:
            del self._seen[k]
        while len(self._seen) >= self._limit:
            del self._seen[next(iter(self._seen))]

    def seen(self, token: str) -> bool:
        with self._lock:
            self._prune(time.monotonic())
            return self._key(token) in self._seen

    def add(self, token: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(now)
            self._seen[self._key(token)] = now


class TurnstileVerifier:
    def __init__(self, settings: Settings | None = None, transport: httpx.BaseTransport | None = None):
        self.settings = settings or get_settings()
        self._transport = transport
        self._used = _UsedTokens()

    def verify(self, token: str | None, remote_ip: str | None = None, action: str | None = None) -> None:
        """Return normally only if the action may proceed; otherwise raise AppError."""
        s = self.settings
        if not s.turnstile_enabled:
            return
        if not s.turnstile_secret_key:
            logger.error("Turnstile is enabled but TURNSTILE_SECRET_KEY is not set; rejecting")
            raise _reject(_UNAVAILABLE)
        if not token or not token.strip():
            raise _reject(_REQUIRED)
        if len(token) > MAX_TOKEN_LENGTH:
            raise _reject(_FAILED)
        if self._used.seen(token):
            logger.warning("Turnstile token replay refused")
            raise _reject(_EXPIRED)

        form = {"secret": s.turnstile_secret_key, "response": token}
        if remote_ip:
            form["remoteip"] = remote_ip
        try:
            with httpx.Client(timeout=TIMEOUT, transport=self._transport) as client:
                resp = client.post(SITEVERIFY_URL, data=form)
            resp.raise_for_status()
            result = resp.json()
        except (httpx.HTTPError, ValueError) as exc:  # timeouts, network errors, non-2xx, non-JSON
            logger.error("Turnstile siteverify unavailable: %s", type(exc).__name__)
            raise _reject(_UNAVAILABLE) from exc
        if not isinstance(result, dict):
            logger.error("Turnstile siteverify returned an unexpected body")
            raise _reject(_UNAVAILABLE)

        if result.get("success") is not True:
            codes = [str(c) for c in result.get("error-codes") or []]
            logger.warning("Turnstile rejected: %s", codes)
            if {"invalid-input-secret", "missing-input-secret"} & set(codes):
                logger.error("Cloudflare rejected our secret key: check TURNSTILE_SECRET_KEY")
                raise _reject(_UNAVAILABLE)
            if "timeout-or-duplicate" in codes:
                raise _reject(_EXPIRED)
            raise _reject(_REQUIRED if "missing-input-response" in codes else _FAILED)

        hostname = str(result.get("hostname") or "").lower()
        if hostname not in s.turnstile_hostname_list:
            logger.warning("Turnstile hostname %r is not allowed", hostname)
            raise _reject(_FAILED)
        if action and result.get("action") != action:
            logger.warning("Turnstile action %r does not match expected %r", result.get("action"), action)
            raise _reject(_FAILED)
        self._used.add(token)


@lru_cache
def get_turnstile_verifier() -> TurnstileVerifier:
    """One shared verifier so the replay memory persists across requests."""
    return TurnstileVerifier()
