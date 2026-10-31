"""LLM provider abstraction: Gemini primary, Groq fallback, one validated Pydantic schema out.

Both providers are plain HTTPX REST calls. Secrets are only ever sent as headers and never logged.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Literal, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings

logger = logging.getLogger("fairsprint.llm")
M = TypeVar("M", bound=BaseModel)
Kind = Literal["config", "auth", "transient", "invalid_output"]


class LLMError(Exception):
    def __init__(self, kind: Kind, message: str):
        super().__init__(message)
        self.kind, self.message = kind, message


class LLMUnavailable(Exception):
    """Every configured provider failed. Callers must not fabricate output."""

    def __init__(self, attempts: list[dict]):
        super().__init__("All LLM providers failed: " + "; ".join(f"{a['provider']}:{a.get('error')}" for a in attempts))
        self.attempts = attempts


class Provider:
    name = "base"
    model = ""

    def complete(self, system: str, user: str) -> str:  # returns raw JSON text
        raise NotImplementedError


def _raise_for_status(resp: httpx.Response, name: str) -> None:
    c = resp.status_code
    if c < 400:
        return
    if c in (400, 401, 403, 404):
        raise LLMError("auth" if c in (401, 403) else "config", f"{name} HTTP {c}")
    raise LLMError("transient", f"{name} HTTP {c}")  # 408/429/5xx


def _post(client: httpx.Client, name: str, url: str, **kw) -> httpx.Response:
    try:
        resp = client.post(url, **kw)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise LLMError("transient", f"{name} {type(exc).__name__}") from exc
    _raise_for_status(resp, name)
    return resp


class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout: float, transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise LLMError("config", "GEMINI_API_KEY is not set")
        self.model = model
        self._client = httpx.Client(timeout=timeout, transport=transport)
        self._key = api_key

    def complete(self, system: str, user: str) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
        data = _post(self._client, self.name, url, json=body, headers={"x-goog-api-key": self._key}).json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("invalid_output", "gemini returned no text") from exc


class GroqProvider(Provider):
    name = "groq"

    def __init__(self, api_key: str, model: str, timeout: float, transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise LLMError("config", "GROQ_API_KEY is not set")
        self.model = model
        self._client = httpx.Client(timeout=timeout, transport=transport)
        self._key = api_key

    def complete(self, system: str, user: str) -> str:
        body = {"model": self.model, "temperature": 0, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        data = _post(self._client, self.name, "https://api.groq.com/openai/v1/chat/completions", json=body,
                     headers={"Authorization": f"Bearer {self._key}"}).json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("invalid_output", "groq returned no text") from exc


def parse_structured(raw: str, schema: type[M]) -> M:
    """Parse model text as JSON (tolerating code fences) and validate against the schema."""
    text = raw.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if fence:
        text = fence.group(1)
    try:
        return schema.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LLMError("invalid_output", f"output failed {schema.__name__} validation") from exc


@dataclass
class LLMRouter:
    providers: list[Provider]
    max_attempts: int = 2          # per provider, for transient / invalid-output failures only
    backoff: float = 0.5
    max_total_calls: int = 10      # hard bound per router (i.e. per run)
    calls: list[dict] = field(default_factory=list)
    _total: int = 0

    def generate(self, system: str, user: str, schema: type[M]) -> M:
        schema_hint = json.dumps(schema.model_json_schema())
        system_full = f"{system}\n\nRespond with ONLY a JSON object matching this JSON Schema:\n{schema_hint}"
        attempts: list[dict] = []
        for idx, prov in enumerate(self.providers):
            fallback_reason = attempts[-1].get("error") if idx and attempts else None
            for attempt in range(1, self.max_attempts + 1):
                if self._total >= self.max_total_calls:
                    attempts.append({"provider": prov.name, "model": prov.model, "error": "call budget exhausted"})
                    raise LLMUnavailable(attempts)
                self._total += 1
                t0 = time.monotonic()
                rec = {"provider": prov.name, "model": prov.model, "attempt": attempt, "fallback_reason": fallback_reason,
                       "schema": schema.__name__}
                try:
                    result = parse_structured(prov.complete(system_full, user), schema)
                    rec.update(status="success", latency_ms=int((time.monotonic() - t0) * 1000))
                    self.calls.append(rec)
                    return result
                except LLMError as exc:
                    rec.update(status="error", error=f"{exc.kind}: {exc.message}", latency_ms=int((time.monotonic() - t0) * 1000))
                    self.calls.append(rec)
                    attempts.append(rec)
                    logger.warning("LLM %s attempt %d failed: %s", prov.name, attempt, rec["error"])
                    if exc.kind in ("auth", "config"):
                        break  # never retry credential/config errors
                    if attempt < self.max_attempts:
                        time.sleep(self.backoff * attempt)
        raise LLMUnavailable(attempts)


def build_router(transport: httpx.BaseTransport | None = None) -> LLMRouter:
    """Router from env config. Providers with missing keys are recorded as failed attempts when used."""
    s = get_settings()
    timeout = float(min(s.agent_timeout_seconds, 30))
    providers: list[Provider] = []
    for factory, key, model in ((GeminiProvider, s.gemini_api_key, s.gemini_model),
                                (GroqProvider, s.groq_api_key, s.groq_model)):
        try:
            providers.append(factory(key, model, timeout, transport))
        except LLMError as exc:
            providers.append(_Unconfigured(factory.name, model, exc))
    return LLMRouter(providers=providers, max_total_calls=max(2, s.agent_max_iterations * 2))


class _Unconfigured(Provider):
    def __init__(self, name: str, model: str, err: LLMError):
        self.name, self.model, self._err = name, model, err

    def complete(self, system: str, user: str) -> str:
        raise self._err
