"""Metrics: percentile math, exposition format, middleware labelling, endpoint protection and agent instrumentation."""
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import metrics as M
from app.config import get_settings
from app.main import app as real_app
from conftest import run_analysis
from fakes import FailingProvider, SmartProvider


@pytest.fixture(autouse=True)
def clean_registry():
    M.REGISTRY.reset()
    yield
    M.REGISTRY.reset()


def line(text: str, prefix: str) -> str:
    return next(ln for ln in text.splitlines() if ln.startswith(prefix))


# ---- percentile math ----
def test_quantile_nearest_rank():
    values = [float(i) for i in range(1, 101)]
    assert (M.quantile(values, 0.5), M.quantile(values, 0.95), M.quantile(values, 0.99)) == (50.0, 95.0, 99.0)
    assert M.quantile([7.0], 0.95) == 7.0
    assert math.isnan(M.quantile([], 0.95))


def test_p95_is_not_the_average_and_ignores_nothing():
    reg = M.Metrics()
    for v in [0.01] * 94 + [2.0] * 6:  # 6% slow requests
        reg.observe("http_request_duration_seconds", v, method="GET", route="/x")
    q = reg.snapshot_quantiles("http_request_duration_seconds", method="GET", route="/x")
    assert q[0.5] == 0.01 and q[0.95] == 2.0  # a mean would hide the slow tail


# ---- exposition format ----
def test_render_summary_counter_and_escaping():
    reg = M.Metrics()
    for v in (0.1, 0.2, 0.3):
        reg.observe("tool_call_duration_seconds", v, tool='we"ird\nname', status="success")
    reg.inc("tool_calls_total", 3, tool="t", status="success")
    out = reg.render()
    assert "# TYPE fairsprint_tool_call_duration_seconds summary" in out
    assert "# TYPE fairsprint_tool_calls_total counter" in out
    assert 'quantile="0.95"' in out and "fairsprint_tool_call_duration_seconds_count" in out and "_sum" in out
    assert r'tool="we\"ird\nname"' in out  # quote and newline escaped, one line per sample
    assert 'fairsprint_tool_calls_total{status="success",tool="t"} 3' in out
    assert out.endswith("\n")


def test_series_cap_drops_instead_of_growing():
    reg = M.Metrics()
    for i in range(M.MAX_SERIES + 25):
        reg.inc("http_requests_total", route=f"/r{i}")
    out = reg.render()
    assert line(out, "fairsprint_metrics_dropped_series_total ").endswith(" 25")
    assert sum(1 for ln in out.splitlines() if ln.startswith("fairsprint_http_requests_total{")) == M.MAX_SERIES


def test_reservoir_is_bounded():
    reg = M.Metrics()
    for i in range(M.RESERVOIR + 500):
        reg.observe("http_request_duration_seconds", float(i), method="GET", route="/x")
    out = reg.render()
    assert line(out, "fairsprint_http_request_duration_seconds_count").endswith(f" {M.RESERVOIR + 500}")  # totals are exact
    assert reg.snapshot_quantiles("http_request_duration_seconds", method="GET", route="/x")[0.5] > 500  # window dropped the oldest


# ---- middleware ----
def make_app(reg: M.Metrics) -> TestClient:
    app = FastAPI()
    app.add_middleware(M.MetricsMiddleware, registry=reg)

    @app.get("/items/{item_id}")
    def item(item_id: int):
        return {"id": item_id}

    @app.get("/boom")
    def boom():
        raise RuntimeError("boom")

    return TestClient(app, raise_server_exceptions=False)


def test_middleware_uses_route_templates_and_records_status():
    reg = M.Metrics()
    client = make_app(reg)
    for i in (1, 2, 3):
        assert client.get(f"/items/{i}").status_code == 200
    assert client.get("/boom").status_code == 500
    assert client.get("/no/such/path").status_code == 404
    out = reg.render()
    assert 'route="/items/{item_id}"' in out and "/items/1" not in out  # IDs never become labels
    assert line(out, 'fairsprint_http_requests_total{method="GET",route="/items/{item_id}",status="200"}').endswith(" 3")
    assert 'route="/boom",status="500"} 1' in out  # an unhandled exception is counted as a 500
    assert 'route="unmatched",status="404"} 1' in out
    assert line(out, "fairsprint_http_requests_in_flight ").endswith(" 0")


def test_metrics_endpoint_itself_is_not_counted():
    reg = M.Metrics()
    client = make_app(reg)
    client.get("/items/1")
    before = reg.render()
    client.get("/metrics")  # 404 in this tiny app, but must not be recorded
    assert reg.render().count('route="unmatched"') == before.count('route="unmatched"')


# ---- the real endpoint ----
def test_metrics_endpoint_open_by_default_and_text_format(monkeypatch):
    monkeypatch.setattr(get_settings(), "metrics_token", "")
    r = TestClient(real_app).get("/metrics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "fairsprint_process_uptime_seconds" in r.text


def test_metrics_endpoint_requires_token_when_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "metrics_token", "s3cret-token")
    c = TestClient(real_app)
    assert c.get("/metrics").status_code == 401
    assert c.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/metrics", headers={"Authorization": "Basic s3cret-token"}).status_code == 401
    assert c.get("/metrics", headers={"Authorization": "Bearer s3cret-token"}).status_code == 200


# ---- agent instrumentation (LLM attempts, fallback, tool calls) ----
def test_agent_run_records_llm_attempts_fallback_and_tool_calls(db, make_runner):
    primary = FailingProvider("gemini", "transient", "gemini timeout")
    run_analysis(make_runner(primary, SmartProvider(name="groq")))
    out = M.REGISTRY.render()

    # Two schemas (plan + assessment), two bounded attempts on the failing primary each, then the fallback answers.
    assert 'fairsprint_llm_calls_total{model="mock",outcome="transient",provider="gemini"} 4' in out
    assert 'fairsprint_llm_calls_total{model="mock",outcome="success",provider="groq"} 2' in out
    assert 'fairsprint_llm_fallbacks_total{provider="groq"} 2' in out
    assert 'fairsprint_llm_call_duration_seconds{model="mock",outcome="success",provider="groq",quantile="0.95"}' in out

    for tool in ("supabase.load_context", "supabase.read_evidence", "github.collect_activity"):
        assert f'fairsprint_tool_calls_total{{status="success",tool="{tool}"}} 1' in out, tool
        assert f'fairsprint_tool_call_duration_seconds{{status="success",tool="{tool}",quantile="0.95"}}' in out
