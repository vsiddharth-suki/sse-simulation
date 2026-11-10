# Findings

Fill this after the runs in [RUNBOOK.md](RUNBOOK.md). Leave a line blank if that run was not done. Experiment B is Chrome on the Android phone. The iOS results are from the simulator on the Mac’s network, not from a phone changing radios.

## Answers

1. Without a ping, does the connection die while the client still shows open?
   - Web EventSource:
   - Web fetch, watchdog off:
   - iOS simulator, watchdog off:

2. Which ping interval kept the connection alive past the idle cut?
   - nginx 60s:
   - nginx 300s:
   - cloudflared / cellular:

3. On Wi-Fi to cellular, cellular to Wi-Fi, and airplane mode, did the page always see an error, or did it stay open?
   - Heartbeat off:
   - Heartbeat 15s, watchdog 3×:

4. Should the design require both a server ping and a client watchdog, rather than reconnecting only when the stream says it closed?

5. With pings flowing, does nginx still cut the stream at `proxy_read_timeout`?

## Go / no-go

Heartbeat required for a production SSE stream: yes / no

Evidence:

## Runs

| When (UTC) | Client | Path | nginx timeout | Heartbeat | Watchdog | What happened |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
