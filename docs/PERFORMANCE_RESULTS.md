# Performance and evaluation results

Measured on **2026-10-31**. Every number below comes from a run described here; nothing is estimated or rounded up. Read the [limits](#limits-read-these-before-quoting-a-number) before quoting any of it.

- API latency and throughput (P50 / P95 / P99), reproducible with `scripts/load_test.py`
- Why the latency looks the way it does
- LLM, GitHub and database timings from a real agent run
- The guardrails evaluation scorecard (accuracy side, not speed)

## How the API numbers were produced

| | |
|---|---|
| Target | The Docker stack from `docker-compose.yml`: backend container (Python 3.13, uvicorn, **one worker**) |
| Database | Hosted Supabase, reached over the internet from the test machine |
| Load generator | `scripts/load_test.py`, on the **same** machine (Windows, 12 logical CPUs, Docker Desktop) |
| Requests | Authenticated `GET`s only (read-only), cycling five endpoints: `/teams/{id}/dashboard`, `/members`, `/tasks`, `/evidence`, `/agent-runs/{id}` |
| Data | The synthetic demo dataset |
| Method | Backend restarted before each scenario, so the server-side `/metrics` figures describe only that scenario. Each scenario was run **once** |

Reproduce:

```
export MENTOR_TOKEN=<a valid mentor token>        # never put it in a file or on the command line
python scripts/load_test.py baseline --per-endpoint 20 --server-metrics
python scripts/load_test.py concurrent --clients 8  --seconds 30 --server-metrics
python scripts/load_test.py concurrent --clients 16 --seconds 30 --server-metrics
```

## Results

| Scenario | Requests | Failed | Throughput |
|---|---:|---:|---:|
| 1 client, sequential | 100 | 0 | 1.2 req/s |
| 8 concurrent clients, 30 s | 267 | 0 | 8.7 req/s |
| 16 concurrent clients, 30 s | 391 | 0 | 11.4 req/s |
| **Total** | **758** | **0** | |

No 5xx responses and no `ReadError` appeared in the backend log during the concurrent runs.

Client-side latency, in milliseconds (what a caller experiences, network included):

| Endpoint | 1 client P50 / P95 / P99 | 8 clients P50 / P95 / P99 | 16 clients P50 / P95 / P99 |
|---|---|---|---|
| `GET /teams/{id}/dashboard` | 1317 / 1617 / 3187 | 1312 / 1692 / 2111 | 1581 / 3255 / 4524 |
| `GET /teams/{id}/members` | 554 / 577 / 622 | 562 / 847 / 3854 | 676 / 1706 / 3871 |
| `GET /teams/{id}/tasks` | 563 / 589 / 591 | 565 / 881 / 1213 | 671 / 1669 / 1951 |
| `GET /teams/{id}/evidence` | 569 / 628 / 633 | 571 / 906 / 8243 | 690 / 1803 / 5135 |
| `GET /agent-runs/{id}` | 1138 / 1197 / 1217 | 1139 / 1385 / 3085 | 1433 / 2623 / 8421 |

Requests per endpoint: 20 each (1 client); 53 to 54 (8 clients); 77 to 79 (16 clients).

**Cross-check of the metrics layer.** The server-side P50 and P95 from `GET /metrics` agree with the client-side ones to within about 25 ms in every scenario (for example the 8-client dashboard P95 is 1692 ms client-side and 1675 ms server-side), and the server-side request counts equal the client's. P99 is looser: it differs by up to about 160 ms, because it is close to the single slowest request. So the `/metrics` P50 and P95 can be trusted as a measure of server time.

## Why the latency looks like this

Each request makes several **sequential** calls to the hosted database, and the latency tracks the call count:

| Request | Supabase calls (counted from the backend log) | Median latency | Implied per call |
|---|---:|---:|---:|
| `GET /teams/{id}/tasks` | 3 (`mentors`, `teams`, `tasks`) | 563 ms | about 188 ms |
| `GET /teams/{id}/dashboard` | 7 | 1317 ms | about 188 ms |
| `GET /agent-runs/{id}` | 6 | 1138 ms | about 190 ms |

The first call in every request is the mentor-token lookup. About 185 to 190 ms per call is consistent across all three, which makes sequential database round trips the dominant cost. This is an inference from call counts and timings, not a per-call profile. The round trip is measured from a laptop to a hosted database; a deployment closer to its database should be faster, and **no measurement was taken on Render**.

Under concurrency, throughput rises (1.2 to 8.7 to 11.4 req/s) but tail latency rises too (dashboard P95 1.6 s with 1 client, 1.7 s with 8, 3.3 s with 16). The gain flattens between 8 and 16 clients (8.7 to 11.4 req/s), which suggests this setup is approaching its limit at roughly 11 to 12 req/s; with only three load levels tested, that limit is not pinned down. The service is one worker whose database calls are synchronous.

## Connection fix, before and after

Under a mixed concurrent load the shared Supabase client (HTTP/2) failed with `httpx.ReadError`, returned as 500s. Measured when the fix (PR #4) was made:

| | Requests | Failed |
|---|---:|---:|
| Before (HTTP/2, one shared connection) | 201 | 7 (3.5%) |
| After (HTTP/1.1 connection pool) | 632 over two runs | 0 |

Those runs predate the authentication change and used a different load, so compare the failure counts, not the latencies, with the tables above.

## LLM, GitHub and database timings in the agent

Measured by running the real agent graph with real prompts (database in memory, so shared data was untouched). **One run per model**, so treat these as indicative.

| Step | Time |
|---|---:|
| `gemini-3.5-flash`, two LLM calls | 14.6 s and 24.7 s (about 40 s for the run) |
| `gemini-3.5-flash-lite`, two LLM calls | 7.6 s and 8.8 s (about 17 s for the run) |
| Groq fallback, two LLM calls (from a live run) | 2.5 s and 4.1 s |
| Live GitHub activity call (21 events) | 3.5 s |
| Supabase read | about 190 ms |

Both Gemini models produced the same statuses as the rule-based baseline, because the model is advisory. `gemini-3.5-flash-lite` is the default because 24.7 s sits close to the backend's 30 s per-call timeout. The retired `gemini-2.5-flash` returned HTTP 404.

## Evaluation scorecard (accuracy)

From `pytest tests/test_guardrails.py -s`, a labelled set of 22 cases written by the project team:

```
Labelled corpus                : 22 cases (9 genuine, 10 unsupported, 3 uncertain)
False-positive rate            : 0/9  = 0%
False-negative rate (core)     : 0/7  = 0%
False-negative rate (with gaps): 3/10 = 30%   <- known gaps: U8, U9, U10
Uncertain cases handled        : 3/3  = 100%
Evidence coverage              : 22/22 = 100% (12/12 verified cite evidence)
Approval compliance            : 13/13 = 100%
Failure handling (safe ending) : 11/11 = 100%
Failure recovery (after fix)   : 11/11 = 100%
```

These are development-set results: the cases were written by the people who wrote the code, so they show the guardrails behave as designed, not how well the system generalises. Three of ten unsupported claims still pass as verified. The README's "Agent evaluation methodology" section gives the definitions and the full list of limitations. The tests use scripted models, so real-model behaviour on adversarial text is not covered.

## Limits (read these before quoting a number)

- **Local, not production.** Client and server shared one machine, with one worker, against a remote database. Nothing was measured on Render.
- **One run per scenario.** There is no repeat and no variance estimate.
- **P99 is close to the maximum.** With 20 to 80 requests per endpoint, P99 is effectively the single slowest request (for example an 8.2 s outlier on `evidence`). Quote P50 and P95 rather than P99.
- **Reads only.** Writes (approvals, runs) and the agent analysis under load were not load-tested.
- **Short.** 30-second runs; no soak test and no check of memory growth.
- **Synthetic data.** The dataset is small; latencies will differ with real data volumes.
- **Metrics are in memory** and reset on restart (see [METRICS.md](METRICS.md)).

## What the numbers suggest (not done yet)

Because latency is roughly calls times 188 ms locally, the cheapest wins are fewer sequential calls: cache the mentor-token lookup for a few seconds (one call saved on every request), drop the repeated `teams` existence check on list endpoints, and run the independent dashboard queries in parallel. Running more than one worker would raise the saturation point. These are suggestions from the measurements above; none has been implemented or tested.
