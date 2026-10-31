#!/usr/bin/env python3
"""Small, dependency-free load test for the FairSprint API. Produces the numbers in docs/PERFORMANCE_RESULTS.md.

  python scripts/load_test.py baseline                      # one client, sequential
  python scripts/load_test.py concurrent --clients 8 --seconds 30

Config (environment):
  BASE_URL       default http://localhost:8000
  MENTOR_TOKEN   bearer token for the protected endpoints (never put it in a file or a command line)
  METRICS_TOKEN  only if the server sets METRICS_TOKEN
  TEAM_ID, RUN_ID  defaults team_fs_001 and run_1f203cb83560

It prints client-side latency percentiles per endpoint (what a caller experiences, including the network) and, with
--server-metrics, the server-side percentiles read from GET /metrics. Restart the backend first if you want the
server-side numbers to describe only this run: /metrics is in-memory and cumulative since the last restart.
Read-only: it only issues GET requests.
"""
import argparse
import collections
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
TOKEN = os.environ.get("MENTOR_TOKEN", "")
TEAM = os.environ.get("TEAM_ID", "team_fs_001")
RUN = os.environ.get("RUN_ID", "run_1f203cb83560")

ENDPOINTS = [
    ("GET /teams/{team_id}/dashboard", f"/teams/{TEAM}/dashboard"),
    ("GET /teams/{team_id}/members", f"/teams/{TEAM}/members?limit=500"),
    ("GET /teams/{team_id}/tasks", f"/teams/{TEAM}/tasks?limit=500"),
    ("GET /teams/{team_id}/evidence", f"/teams/{TEAM}/evidence?limit=500"),
    ("GET /agent-runs/{run_id}", f"/agent-runs/{RUN}"),
]


def pct(sorted_values, q):
    """Nearest-rank percentile (same rule as the server)."""
    return sorted_values[max(1, math.ceil(q * len(sorted_values))) - 1] if sorted_values else float("nan")


def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:  # network error, timeout
        code = type(e).__name__
    return code, time.perf_counter() - start


class Results:
    def __init__(self):
        self.lock = threading.Lock()
        self.lat = collections.defaultdict(list)
        self.codes = collections.Counter()

    def add(self, name, code, seconds):
        with self.lock:
            self.codes[code] += 1
            if code == 200:
                self.lat[name].append(seconds)


def report(res, wall):
    total = sum(res.codes.values())
    failed = sum(v for k, v in res.codes.items() if k != 200)
    print(f"\nrequests: {total}   failed: {failed} ({100 * failed / max(total, 1):.1f}%)   wall time: {wall:.1f}s   "
          f"throughput: {total / wall:.1f} req/s   status codes: {dict(res.codes)}")
    print("\n| Endpoint | Requests | P50 | P95 | P99 |\n|---|---:|---:|---:|---:|")
    for name, _ in ENDPOINTS:
        v = sorted(res.lat[name])
        if v:
            print(f"| `{name}` | {len(v)} | {pct(v, .5) * 1000:.0f} ms | {pct(v, .95) * 1000:.0f} ms | {pct(v, .99) * 1000:.0f} ms |")


def server_metrics():
    req = urllib.request.Request(BASE + "/metrics", headers={"Authorization": f"Bearer {os.environ.get('METRICS_TOKEN', '')}"})
    text = urllib.request.urlopen(req, timeout=30).read().decode()
    rows, counts = collections.defaultdict(dict), {}
    for ln in text.splitlines():
        m = re.match(r'fairsprint_http_request_duration_seconds\{method="(\w+)",route="([^"]+)",quantile="([0-9.]+)"\} ([0-9.]+)', ln)
        if m:
            rows[(m[1], m[2])][m[3]] = float(m[4])
        m = re.match(r'fairsprint_http_request_duration_seconds_count\{method="(\w+)",route="([^"]+)"\} (\d+)', ln)
        if m:
            counts[(m[1], m[2])] = int(m[3])
    print("\nServer-side latency from GET /metrics (cumulative since the last backend restart):")
    print("\n| Route | Requests | P50 | P95 | P99 |\n|---|---:|---:|---:|---:|")
    for k, v in sorted(rows.items(), key=lambda kv: -kv[1].get("0.95", 0)):
        print(f"| `{k[0]} {k[1]}` | {counts[k]} | {v['0.5'] * 1000:.0f} ms | {v['0.95'] * 1000:.0f} ms | {v['0.99'] * 1000:.0f} ms |")


def baseline(per_endpoint):
    res, start = Results(), time.perf_counter()
    for name, path in ENDPOINTS:
        for _ in range(per_endpoint):
            res.add(name, *get(path))
    report(res, time.perf_counter() - start)


def concurrent(clients, seconds):
    res, stop = Results(), time.time() + seconds

    def worker(i):
        n = 0
        while time.time() < stop:
            name, path = ENDPOINTS[(i + n) % len(ENDPOINTS)]
            res.add(name, *get(path))
            n += 1

    start = time.perf_counter()
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(clients)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    report(res, time.perf_counter() - start)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["baseline", "concurrent"])
    ap.add_argument("--per-endpoint", type=int, default=20, help="baseline: requests per endpoint")
    ap.add_argument("--clients", type=int, default=8, help="concurrent: parallel clients")
    ap.add_argument("--seconds", type=int, default=30, help="concurrent: duration")
    ap.add_argument("--server-metrics", action="store_true", help="also print server-side percentiles from /metrics")
    a = ap.parse_args()
    if not TOKEN:
        sys.exit("Set MENTOR_TOKEN in the environment (a valid mentor token).")
    print(f"target {BASE}   mode {a.mode}")
    baseline(a.per_endpoint) if a.mode == "baseline" else concurrent(a.clients, a.seconds)
    if a.server_metrics:
        server_metrics()
