# BAC-10368 SSE spike

Throwaway harness for the heartbeat and reconnect tests. It is not the production notifications service.

The Mac runs the mock server and nginx. The Mac does not change networks. Android Chrome does the Wi-Fi and cellular runs. The iOS simulator only covers the URLSession client on the Mac’s network.

Docker is required for nginx. Install Docker Desktop, then from this folder:

```bash
PROXY_READ_TIMEOUT=60s docker compose up --build
```

Open http://127.0.0.1:8080

The step-by-step tests are in [RUNBOOK.md](RUNBOOK.md). The grid of runs is in [SCENARIOS.md](SCENARIOS.md). Write results in [FINDINGS.md](FINDINGS.md). Do not fill findings before the runs.
