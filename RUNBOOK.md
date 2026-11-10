# Runbook

The Mac stays connected the whole time. Node and nginx run on it. Only the Android phone changes Wi-Fi, cellular, and airplane mode.

## Before the first run

1. Install Docker Desktop.
2. For the cellular runs, install a tunnel on the Mac: `brew install cloudflared`.
3. From this folder:

```bash
PROXY_READ_TIMEOUT=60s docker compose up --build
```

`60s` is the dress rehearsal. The comparison with the gateway uses `300s`:

```bash
PROXY_READ_TIMEOUT=300s docker compose up --build
```

4. Desktop Chrome on the Mac: http://127.0.0.1:8080
5. iPhone: install SseSpike from `ios/SseSpike.xcodeproj` onto the phone. Safari on that phone uses the same addresses as Android Chrome.
6. Android phone/iPhone, same Wi-Fi as the Mac: http://<mac-lan-ip>:8080
   Find the address with `ipconfig getifaddr en0`.

Server lines are appended to `runs/server.jsonl`. Each client has a Copy log button. Paste both into the findings note. Timestamps are UTC.

## Who is who

- The web page and the iPhone app are the **client**. Connect opens the stream. Disconnect closes it. The log prints each ambient note status as it arrives.
- **nginx** is ms-gateway.
- The Node process is ms-notifications. It holds the stream.
- A timer in that process is ms-jobber. It sends `ambient note 1234: IN_PROGRESS`, then the same note as `SUCCESS`, then starts another note.

## Server settings

Heartbeat and planned close are not on the page. Edit `server/config.json`, then start the stack again:

- `heartbeatMs`: one heartbeat interval. Default `15000`. `0` turns the silence timer off.
- `watchdog`: `0`, `2`, or `3`. The server and the client both learn this from `server/config.json`. The server tells the client in the hello frame. It is not a control on the page or in the iPhone app. `0` means the server never pings and the client does not reconnect on silence. `2` or `3` means: if no status arrives for that many heartbeat intervals, the server writes a ping. If the client has received neither a ping nor a status for that same time, it reconnects with its last seq. A status resets the wait.
- `plannedCloseMs`: how long until the server ends the stream on purpose. `0` leaves it open. Default `0`.
- `statusEveryMs`: how often jobber sends the next ambient status. Default `5000`.

After a suspected silent drop, watch the log. New `received ambient note …` lines mean the stream is alive. If they stop while the state stays open, the socket is dead.

On a network-switch run, open the **cloudflared URL** while the phone is still on Wi-Fi. The LAN address dies as soon as Wi-Fi goes off, which is a different failure.

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

The command prints an `https://….trycloudflare.com` URL. The tunnel itself often cuts a quiet connection around 100 seconds, sooner than nginx at 300 seconds. Write down which one you were measuring.

## A. Heartbeat on and off

Do this on desktop Chrome (EventSource and fetch) and on the iPhone app. Use the LAN or localhost URL. Start with nginx at 60s. Repeat one passing case at 300s.

### A1, heartbeat off, watchdog off

1. In `server/config.json` set `heartbeatMs` to `0`, `watchdog` to `0`, and `plannedCloseMs` to `0`. Start the stack again.
2. Connect. The log should keep printing `received ambient note …` and the state stays open.
3. Wait past the nginx timeout (60s, then later 300s).
4. Record whether the client logs an error, stays open, or reconnects by itself.
5. If the state stays open but new `received` lines stop, the socket is dead. Jobber is still sending. The client is not getting them.

### A2, server ping after silence

1. Set `heartbeatMs` to `15000`. Run once with `watchdog` at `0` and once at `3`. `0` never prints `ping`, and the client stays open through silence. With statuses every 5 seconds, `3` also stays quiet, because a status resets the wait. To see a ping, set `statusEveryMs` to `0` and start again: the server writes `ping` after three heartbeat intervals with no status. If that ping does not arrive, the client reconnects with its last seq.
2. Wait past the same nginx timeout.
3. Record whether `received` lines continue, whether nginx still cuts the stream, and any note about heat or radio use. Battery notes can be qualitative.

## B. Wi-Fi and cellular

Mobile browsers. Start on the cloudflared URL, on Wi-Fi. Run each step twice: heartbeat off with watchdog off, and heartbeat 15s with watchdog 3×.

1. Wi-Fi to cellular: turn Wi-Fi off.
2. Cellular to Wi-Fi: turn Wi-Fi on.
3. Airplane mode on for a few seconds, then off.

For each, record:

- Did the page log an error or a clean end?
- Did EventSource reconnect by itself? Did fetch stay silent?
- After the switch, did new `received ambient note …` lines arrive without tapping Reconnect?
- If you reconnect, do events from the gap show up?

## C. Planned close and hard kill

Desktop Chrome, Android Chrome, iPhone Safari, and the iPhone app.

1. Set `plannedCloseMs` to `60000`, start the stack again, and connect. After about 60 seconds the server ends the stream. The page connects again on its own and `received` lines continue.
2. Set `plannedCloseMs` back to `0` and start again. To imitate a hard cut, stop the `sse` container while the page is connected (`docker compose stop sse`). Record whether the client sees an error immediately or stays open until the watchdog fires.

## What to write down every time

- Client: EventSource, fetch, or iPhone app
- URL shape: localhost, LAN, or cloudflared
- nginx timeout: 60s or 300s
- Heartbeat and watchdog settings
- Clock time of connect, last byte, error or reconnect, and the push that did or did not arrive
- Copy of the client log and the matching lines from `runs/server.jsonl`
