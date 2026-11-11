# Findings

Fill this after the runs in [RUNBOOK.md](RUNBOOK.md). Leave a line blank if that run was not done. Experiment B is Chrome on the Android phone and Safari on the iPhone.

## Answers

1. Without a ping, does the connection die while the client still shows open?
   - Web EventSource: Client reconnects when a connection drops
   - Web fetch, watchdog off: Same as above
   - iPhone app, watchdog off: Same as above

2. Which ping interval kept the connection alive past the idle cut?
   - nginx 60s: Any interval less than 60s
   - nginx 300s: Any interval less than 300s
   - cloudflared / cellular: Any interval less than the minimum of nginx proxy and cloudflare tunnel's timeout (\~125s)

3. On Wi-Fi to cellular, cellular to Wi-Fi, and airplane mode, did the page always see an error, or did it stay open?
   - Heartbeat off: Connection drop is detected
   - Heartbeat 15s, watchdog 3×: Connection drop is detected

4. Should the design require both a server ping and a client watchdog, rather than reconnecting only when the stream says it closed?
Yes, heartbeat pings from the server to the client make disconnection detection more reliable, regardless of whether the client can independently detect the disconnection.

5. With pings flowing, does nginx still cut the stream at `proxy_read_timeout`? 
It does not cut the stream if ping interval is less than the timeout.

## Go / no-go

Heartbeat required for a production SSE stream: yes / no: Yes

Evidence: Although both web and mobile clients can detect SSE disconnections in various simulated scenarios—including planned cuts, hard cuts, proxy server and Cloudflare tunnel idle timeouts, and network switches—having the server send periodic heartbeat pings to the client when no status updates are available adds another layer of reliability.

This makes the end-to-end system more resilient to unforeseen edge cases where client-side disconnection detection may fail.

## Runs

| When (UTC) | Client | Path | nginx timeout | Heartbeat | Watchdog | What happened |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-11 ~06:12–06:14 | iPhone app (S8/C6) | cloudflared | n/a (Node only) | 15s | 0 | Planned close 5s. `received` notes over tunnel. Each cycle: `bye` → clean end → auto-reconnect with advancing `last_seq` (58→84). |
