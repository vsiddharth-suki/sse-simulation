# Scenario matrix

One row is one run. Set `server/config.json`, start the stack again, then connect. `nginx` is the `PROXY_READ_TIMEOUT` you start Docker with (`60s` or `300s`).

Write the result in [FINDINGS.md](FINDINGS.md). Copy the client log and the matching lines from `runs/server.jsonl`.

Clients:

- **Mac fetch** and **Mac EventSource**: Chrome or Safari at `http://127.0.0.1:8080`. Fetch is the app-style client. EventSource is the browser’s own client.
- **iPhone app**: SseSpike on an iPhone. On the same Wi-Fi as the Mac use `http://<mac-lan-ip>:8080`. For cellular or tunnel runs, paste the `trycloudflare.com` base URL into the app.
- **Android Chrome** and **iPhone Safari**: the same web page. On Wi-Fi, use `http://<mac-lan-ip>:8080`. For a radio change, start on the `trycloudflare.com` address while still on Wi-Fi.

`status 5s` means `statusEveryMs` `5000`. `status off` means `0`. `planned off` means `plannedCloseMs` `0`.

## 1. Statuses arrive

Server keeps sending ambient notes. Nobody pushes them from the page.

| ID | Client | Path | nginx | heartbeat | watchdog | status | planned | Look for |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Mac fetch | localhost | 60s | 15s | 0 | 5s | off | `received ambient note …` keeps arriving. No `ping`, because a status resets the wait. |
| S2 | Mac EventSource | localhost | 60s | 15s | 0 | 5s | off | Same statuses. EventSource cannot show a comment `ping` even when the server sends one. |
| S3 | iPhone app | LAN | 60s | 15s | 0 | 5s | off | Same statuses in the iPhone app log. |
| S4 | Android Chrome, fetch | LAN | 60s | 15s | 0 | 5s | off | Same statuses on the phone, still on Wi-Fi. |
| S5 | iPhone Safari, fetch | LAN | 60s | 15s | 0 | 5s | off | Same statuses on the iPhone, still on Wi-Fi. |
| S6 | Android Chrome, fetch | cloudflared | 60s | 15s | 0 | 5s | off | Whether any `received` line appears. The temporary tunnel does not support this kind of stream. |
| S7 | iPhone Safari, fetch | cloudflared | 60s | 15s | 0 | 5s | off | Same check as S6 on the iPhone. |
| S8 | iPhone app | cloudflared | n/a (Node only) | 15s | 0 | 5s | off | Whether `received ambient note …` appears over the quick tunnel in SseSpike. |

## 2. Quiet stream, no ping

No statuses and no pings. nginx is the only thing that can cut the stream.

| ID | Client | Path | nginx | heartbeat | watchdog | status | planned | Look for |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1 | Mac fetch | localhost | 60s | 15s | 0 | off | off | Around 15s: `no bytes for …; connection still open`. Around 60s: browser error such as `Load failed`. State goes closed. No reconnect. |
| Q2 | Mac EventSource | localhost | 60s | 15s | 0 | off | off | Whether the browser reconnects by itself after the 60s cut, and whether the state stays open with no new bytes. |
| Q3 | iPhone app | LAN | 60s | 15s | 0 | off | off | Around 60s URLSession may log `stream ended cleanly` and reconnect with the saved seq. That is the app treating nginx’s cut as a normal end. |
| Q4 | Mac fetch | localhost | 300s | 15s | 0 | off | off | Same as Q1, with the cut near 300s. |
| Q5 | iPhone app | LAN | 300s | 15s | 0 | off | off | Same as Q3, with the cut near 300s. |
| Q6 | Android Chrome, fetch | cloudflared | 300s | 15s | 0 | off | off | Which hop dies first. The tunnel often cuts a quiet stream near 100s, before nginx at 300s. |
| Q7 | iPhone Safari, fetch | cloudflared | 300s | 15s | 0 | off | off | Same as Q6 on the iPhone. |

## 3. Server ping and client watchdog

A ping is sent only after `watchdog × heartbeat` with no status. The client reconnects on its own only when it has gone that same time with neither a ping nor a status. Fetch and the iPhone app can see a comment ping. EventSource cannot.

| ID | Client | Path | nginx | heartbeat | watchdog | status | planned | Look for |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Mac fetch | localhost | 60s | 15s | 2 | off | off | `ping` about every 30s. No `received` line. Stream still open past 60s if the ping keeps nginx satisfied. |
| P2 | Mac fetch | localhost | 60s | 15s | 3 | off | off | `ping` about every 45s. Same question as P1 against the 60s cut. |
| P3 | Mac EventSource | localhost | 60s | 15s | 3 | off | off | No `ping` line in the page log. Record whether the browser still stays up, and whether it reconnects because it never saw the ping. |
| P4 | iPhone app | LAN | 60s | 15s | 3 | off | off | `ping` about every 45s. Record whether the iPhone stays open past 60s. |
| P5 | Mac fetch | localhost | 300s | 15s | 3 | off | off | Whether a 45s ping keeps the stream open past 300s. |
| P6 | iPhone app | LAN | 300s | 15s | 3 | off | off | Same as P5 on the iPhone. |
| P7 | Mac fetch | localhost | 60s | 15s | 3 | 5s | off | Statuses every 5s and no `ping`. A status starts the 45s wait over. |
| P8 | Mac fetch | localhost | 60s | 0 | 3 | off | off | No `ping` and no watchdog reconnect. Heartbeat `0` turns the silence timer off. |

## 4. Planned close and hard cut

| ID | Client | Path | nginx | heartbeat | watchdog | status | planned | Look for |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Mac fetch | localhost | 60s | 15s | 0 | 5s | 60s | Around 60s: `comment bye`, then `fetch stream ended cleanly`, then a new connect with the same `last_seq`. Statuses continue. |
| C2 | Mac EventSource | localhost | 60s | 15s | 0 | 5s | 60s | Whether the browser reconnects by itself after `bye`, and whether the cursor moves. |
| C3 | iPhone app | LAN | 60s | 15s | 0 | 5s | 60s | `comment bye`, then `stream ended cleanly`, then a new connect with the saved seq. |
| C4 | Android Chrome, fetch | LAN | 60s | 15s | 0 | 5s | 60s | Same clean reconnect on the phone. |
| C5 | iPhone Safari, fetch | LAN | 60s | 15s | 0 | 5s | 60s | Same clean reconnect on the iPhone. |
| C6 | iPhone app | cloudflared | n/a (Node only) | 15s | 0 | 5s | 5s | Dress rehearsal of C3 over the tunnel: `comment bye` about every 5s, clean end, auto-reconnect with advancing `last_seq` / `Last-Event-ID`. |
| K1 | Mac fetch | localhost | 60s | 15s | 0 | 5s | off | While connected, run `docker compose stop sse`. Record an immediate error, or a state that stays open with no new statuses. No reconnect from the watchdog. |
| K2 | Mac fetch | localhost | 60s | 15s | 3 | off | off | Same hard stop. After about 45s with no ping and no status, the page reconnects with the saved seq. The new connect fails until `sse` is started again. |
| K3 | iPhone app | LAN | 60s | 15s | 3 | off | off | Same hard stop. Record whether the iPhone reconnects at 45s or treats the cut as a clean end sooner. |

Start `sse` again after K1–K3 (`docker compose start sse`, or bring the whole stack back).

## 5. Saved seq

The page keeps `last_seq` for the life of the tab. The iPhone app keeps it until the app is deleted. Connect always sends that number. A ping does not change it.

| ID | Client | Path | Setup | What you do | Look for |
| --- | --- | --- | --- | --- | --- |
| R1 | Mac fetch | localhost | status 5s, watchdog 0, planned off | Connect, wait for a few `received` lines, Disconnect, Connect again | The second open shows `last_seq` and `Last-Event-ID` equal to the last status. The log does not reprint older notes. |
| R2 | Mac fetch | localhost | same as R1 | Reload the tab, then Connect | The same seq is still there. |
| R3 | Mac fetch | localhost | same as R1 | Close the tab, open a new one, Connect | No `last_seq`. Old notes are not replayed. |
| R4 | iPhone app | LAN | same as R1 | Connect, receive a few notes, stop the app, launch it again, Connect | The seq is still on screen and is sent again. |
| R5 | Android Chrome, fetch | LAN | same as R1 | Same steps as R1 | Same cursor behavior on the phone. |
| R6 | iPhone Safari, fetch | LAN | same as R1 | Same steps as R1 | Same cursor behavior on the iPhone. |

## 6. Wi-Fi, cellular, airplane

Start on the cloudflared URL while the phone is still on Wi-Fi. Turning Wi-Fi off makes the LAN address die, which is a different failure. The tunnel address changes every time `cloudflared` is started, and it dies when that process stops.

Do each row twice: once with **quiet** settings (`heartbeat 15s`, `watchdog 0`, `status off`, `planned off`, nginx `300s`) and once with **live** settings (`heartbeat 15s`, `watchdog 3`, `status 5s`, `planned off`, nginx `300s`).

| ID | Client | Switch | Look for |
| --- | --- | --- | --- |
| N1 | Android Chrome, fetch | Wi-Fi off, so the phone moves to cellular | Error, clean end, or state still open. Whether new `received` lines arrive with no extra tap. |
| N2 | Android Chrome, fetch | Wi-Fi back on | Same notes as N1. |
| N3 | Android Chrome, fetch | Airplane mode on for a few seconds, then off | Same notes as N1. After it returns, whether missed notes appear because of the saved seq. |
| N4 | iPhone Safari, fetch | Wi-Fi off, so the phone moves to cellular | Same notes as N1. |
| N5 | iPhone Safari, fetch | Wi-Fi back on | Same notes as N2. |
| N6 | iPhone Safari, fetch | Airplane mode on for a few seconds, then off | Same notes as N3. |
| N7 | Android Chrome, EventSource | Wi-Fi off, quiet settings only | Whether the browser reconnects by itself. Fetch in N1 is the comparison. |
| N8 | iPhone Safari, EventSource | Wi-Fi off, quiet settings only | Same comparison as N7 on the iPhone. |

## What every row should record

- The row id
- Client and path
- nginx timeout, heartbeat, watchdog, status interval, planned close
- Time of connect, time of the last byte, time of the error or reconnect
- Whether `received` lines continued, stopped while the state stayed open, or resumed after a reconnect
- The `last_seq` sent on the next connect

## Results (recorded)

| ID | When (UTC) | Settings | Result |
| --- | --- | --- | --- |
| S8 / C6 | 2026-11-11 ~06:12–06:14 | iPhone app, cloudflared (`build-hydrogen-hoping-host.trycloudflare.com`), heartbeat 15s, watchdog 0, status 5s, planned 5s, Node only (no nginx) | **Pass.** Statuses arrived over the quick tunnel. On each planned close: `comment bye` → `URLSession stream ended cleanly` → `reconnecting after clean end` → new `URLSession open` with advancing `last_seq` / `Last-Event-ID` (58 → 84). Client identifies the server drop and auto-reconnects with cursor. |
