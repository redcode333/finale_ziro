# Metrics: latency (P50 / P95 / P99), throughput and errors

`GET /metrics` on the backend serves metrics in the Prometheus text format. It covers every HTTP request, every LLM provider attempt and every tool call. It is built into the backend (`backend/app/metrics.py`), so there is nothing extra to deploy.

```
curl http://localhost:8000/metrics
```

## What is measured

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `fairsprint_http_request_duration_seconds` | summary | `method`, `route` | Request latency with `quantile` 0.5, 0.95, 0.99 plus `_sum` and `_count` |
| `fairsprint_http_requests_total` | counter | `method`, `route`, `status` | Requests by exact status code |
| `fairsprint_http_requests_in_flight` | gauge | | Requests being served right now |
| `fairsprint_llm_call_duration_seconds` | summary | `provider`, `model`, `outcome` | Latency of one provider attempt (a retry or a fallback is a separate attempt) |
| `fairsprint_llm_calls_total` | counter | `provider`, `model`, `outcome` | Attempts; `outcome` is `success`, `transient`, `config`, `auth` or `invalid_output` |
| `fairsprint_llm_fallbacks_total` | counter | `provider` | Answers that came from a fallback provider after the primary failed |
| `fairsprint_tool_call_duration_seconds` | summary | `tool`, `status` | Latency of one allowlisted tool call (Supabase reads, GitHub) |
| `fairsprint_tool_calls_total` | counter | `tool`, `status` | Tool calls by status |
| `fairsprint_process_uptime_seconds` | gauge | | Seconds since this process started |
| `fairsprint_metrics_dropped_series_total` | counter | | Observations dropped by the series limit (should stay 0) |

**P95 is in the output.** The percentiles are computed in the backend, so `fairsprint_http_request_duration_seconds{route="/teams/{team_id}/dashboard",quantile="0.95"}` is already the P95 in seconds. No Prometheus is needed to read it.

Routes are labelled with the **route template** (`/teams/{team_id}/dashboard`), never the raw URL, so IDs cannot create unbounded series. Requests that match no route are `unmatched`. `/metrics` itself is not counted.

## Quick reads

```
# P95 latency per route, slowest first, in milliseconds
curl -s localhost:8000/metrics | grep 'http_request_duration_seconds.*quantile="0.95"'

# How often did the fallback model have to answer?
curl -s localhost:8000/metrics | grep -E 'llm_(fallbacks|calls)_total'

# Failing tools
curl -s localhost:8000/metrics | grep 'tool_calls_total' | grep -v 'status="success"'
```

With Prometheus, error rate over 5 minutes: `sum(rate(fairsprint_http_requests_total{status=~"5.."}[5m])) / sum(rate(fairsprint_http_requests_total[5m]))`.

## Securing it

Set `METRICS_TOKEN` in `backend/.env` to require `Authorization: Bearer <token>` (401 otherwise). It is empty by default, which leaves the endpoint open; **set it before any public deployment**. Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: fairsprint
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["backend:8000"] }]
```

## Limits (read before trusting a number)

- **Per process, in memory.** Metrics reset on restart. With several backend instances each reports its own numbers, and summary quantiles cannot be averaged across instances.
- **Sliding window.** Each series keeps its last 2048 observations; the quantiles describe that window. `_count` and `_sum` are exact totals since start.
- **Series limit.** At most 500 label combinations per metric; extra ones are dropped and counted in `fairsprint_metrics_dropped_series_total`.
- **Not measured:** time spent in the browser, and Supabase latency inside a request beyond what the tool-call timings show. The agent run itself is covered through its LLM and tool calls.

Measured results (P50/P95/P99 under load, the reason for the latency, and the evaluation scorecard) are in [PERFORMANCE_RESULTS.md](PERFORMANCE_RESULTS.md); `scripts/load_test.py` reproduces them.

## What it already shows

Under a 12-client mixed load against the real Supabase from the Docker stack, `/teams/{team_id}/dashboard` was the slowest route (P50 about 1.4 s, P95 about 3.6 s) because it issues several sequential Supabase queries; the single-query routes had P50 of about 0.45 s. That is the first place to look if latency matters.
