"""In-process latency and error metrics for HTTP requests, LLM calls and tool calls, served at GET /metrics.

Output is the Prometheus text format. Latency series are exposed as summaries: P50, P95 and P99 are computed here
(nearest-rank over the last RESERVOIR observations of each series), so a percentile can be read straight from /metrics
without Prometheus. Counters give request, call and error totals.

Limits, on purpose: metrics live in this process only. They reset on restart and are not aggregated across several
backend instances (summary quantiles cannot be averaged). Memory is bounded: RESERVOIR observations per series and
MAX_SERIES series per metric.
"""
import math
import threading
import time
from collections import deque
from typing import Any

PREFIX = "fairsprint_"
QUANTILES = (0.5, 0.95, 0.99)
RESERVOIR = 2048
MAX_SERIES = 500

HELP = {
    "http_request_duration_seconds": "HTTP request latency by method and route template",
    "http_requests_total": "HTTP requests by method, route template and status code",
    "http_requests_in_flight": "HTTP requests currently being served",
    "llm_call_duration_seconds": "Latency of one LLM provider attempt",
    "llm_calls_total": "LLM provider attempts by provider, model and outcome",
    "llm_fallbacks_total": "LLM answers produced by a fallback provider after the primary failed",
    "tool_call_duration_seconds": "Latency of one allowlisted tool call",
    "tool_calls_total": "Tool calls by tool and status",
    "metrics_dropped_series_total": "Observations dropped because a metric reached its series limit",
}

_Key = tuple[tuple[str, str], ...]


def _key(labels: dict[str, Any]) -> _Key:
    return tuple(sorted((k, str(v)) for k, v in labels.items()))


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _fmt(pairs: _Key, extra: tuple[tuple[str, str], ...] = ()) -> str:
    items = (*pairs, *extra)
    return "{" + ",".join(f'{k}="{_escape(v)}"' for k, v in items) + "}" if items else ""


def quantile(sorted_values: list[float], q: float) -> float:
    """Nearest-rank percentile of an already sorted list."""
    if not sorted_values:
        return math.nan
    return sorted_values[max(1, math.ceil(q * len(sorted_values))) - 1]


class _Latency:
    __slots__ = ("count", "total", "window")

    def __init__(self) -> None:
        self.count = 0
        self.total = 0.0
        self.window: deque[float] = deque(maxlen=RESERVOIR)


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with getattr(self, "_lock", threading.Lock()):
            self._latency: dict[str, dict[_Key, _Latency]] = {}
            self._counters: dict[str, dict[_Key, float]] = {}
            self._gauges: dict[str, float] = {}
            self._dropped = 0

    def observe(self, name: str, seconds: float, **labels: Any) -> None:
        with self._lock:
            series = self._latency.setdefault(name, {})
            k = _key(labels)
            if k not in series and len(series) >= MAX_SERIES:
                self._dropped += 1
                return
            s = series.setdefault(k, _Latency())
            s.count += 1
            s.total += seconds
            s.window.append(seconds)

    def inc(self, name: str, amount: float = 1, **labels: Any) -> None:
        with self._lock:
            series = self._counters.setdefault(name, {})
            k = _key(labels)
            if k not in series and len(series) >= MAX_SERIES:
                self._dropped += 1
                return
            series[k] = series.get(k, 0.0) + amount

    def gauge_add(self, name: str, delta: float) -> None:
        with self._lock:
            self._gauges[name] = self._gauges.get(name, 0.0) + delta

    def snapshot_quantiles(self, name: str, **labels: Any) -> dict[float, float]:
        """P50/P95/P99 for one series (used by tests and callers that want numbers instead of text)."""
        with self._lock:
            s = self._latency.get(name, {}).get(_key(labels))
            values = sorted(s.window) if s else []
        return {q: quantile(values, q) for q in QUANTILES}

    def render(self) -> str:
        out: list[str] = []
        with self._lock:
            for name, series in sorted(self._latency.items()):
                full = PREFIX + name
                out += [f"# HELP {full} {HELP.get(name, name)} (quantiles over the last {RESERVOIR} observations)", f"# TYPE {full} summary"]
                for k, s in sorted(series.items()):
                    values = sorted(s.window)
                    for q in QUANTILES:
                        out.append(f"{full}{_fmt(k, (('quantile', str(q)),))} {quantile(values, q):.6f}")
                    out.append(f"{full}_sum{_fmt(k)} {s.total:.6f}")
                    out.append(f"{full}_count{_fmt(k)} {s.count}")
            for name, series in sorted(self._counters.items()):
                full = PREFIX + name
                out += [f"# HELP {full} {HELP.get(name, name)}", f"# TYPE {full} counter"]
                out += [f"{full}{_fmt(k)} {v:g}" for k, v in sorted(series.items())]
            for name, value in sorted(self._gauges.items()):
                full = PREFIX + name
                out += [f"# HELP {full} {HELP.get(name, name)}", f"# TYPE {full} gauge", f"{full} {value:g}"]
            name = PREFIX + "metrics_dropped_series_total"
            out += [f"# HELP {name} {HELP['metrics_dropped_series_total']}", f"# TYPE {name} counter", f"{name} {self._dropped}"]
            up = PREFIX + "process_uptime_seconds"
            out += [f"# HELP {up} Seconds since this process started", f"# TYPE {up} gauge", f"{up} {time.time() - START_TIME:.0f}"]
        return "\n".join(out) + "\n"


START_TIME = time.time()
REGISTRY = Metrics()


class MetricsMiddleware:
    """Pure ASGI middleware (safe with background tasks). Labels use the route template, never the raw path, so IDs in
    URLs cannot create unbounded series. Requests that match no route are labelled `unmatched`."""

    def __init__(self, app: Any, registry: Metrics = REGISTRY) -> None:
        self.app = app
        self.registry = registry

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("path") == "/metrics":
            await self.app(scope, receive, send)
            return
        status = 500  # stays 500 if the app raises before it starts a response
        started = time.perf_counter()
        self.registry.gauge_add("http_requests_in_flight", 1)

        async def send_wrapper(message: dict) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - started
            route = getattr(scope.get("route"), "path", None) or "unmatched"
            method = scope.get("method", "GET")
            self.registry.gauge_add("http_requests_in_flight", -1)
            self.registry.observe("http_request_duration_seconds", elapsed, method=method, route=route)
            self.registry.inc("http_requests_total", method=method, route=route, status=status)
