import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "public", "index.html");
const configPath = path.join(__dirname, "config.json");
const ambientSteps = ["IN_PROGRESS", "IN_PROGRESS", "SUCCESS"];

function loadConfig(override = {}) {
  const file = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    heartbeatMs: Number(file.heartbeatMs) || 0,
    plannedCloseMs: Number(file.plannedCloseMs) || 0,
    statusEveryMs: Number(file.statusEveryMs) || 0,
    watchdog: Number(file.watchdog) || 0,
    ...override,
  };
}

function createApp(options = {}) {
  const logPath = options.logPath ?? null;
  const config = options.config ?? loadConfig();
  const events = [];
  let ambientStep = 0;
  let noteId = 1000 + Math.floor(Math.random() * 9000);
  let nextId = 1;
  const connections = new Map();

  function log(entry) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    if (!logPath) return;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + "\n");
  }

  function writeFrame(res, text) {
    if (!res.destroyed && !res.writableEnded) res.write(text);
  }

  function statusFrame(event) {
    const data = JSON.stringify({ seq: event.id, text: event.text, at: event.at });
    return `id: ${event.id}\nevent: status\ndata: ${data}\n\n`;
  }

  function numericId(value) {
    if (value == null || value === "") return null;
    if (!/^\d+$/.test(String(value))) return null;
    return Number(value);
  }

  // Last-Event-ID wins when both are present. An empty cursor replays nothing.
  function cursorOf(req, url) {
    const header = req.headers["last-event-id"];
    if (header != null && header !== "") return { raw: String(header), source: "header" };
    const query = url.searchParams.get("last_seq");
    if (query) return { raw: query, source: "query" };
    return { raw: "", source: "none" };
  }

  function eventsAfter(rawCursor) {
    const cursor = numericId(rawCursor);
    if (cursor == null) return [];
    return events.filter((event) => Number(event.id) > cursor);
  }

  function pingWaitMs() {
    const multiplier = Number(config.watchdog) || 0;
    if (multiplier <= 0 || config.heartbeatMs <= 0) return 0;
    return multiplier * config.heartbeatMs;
  }

  function armHeartbeat(connection) {
    clearTimeout(connection.heartbeat);
    const wait = pingWaitMs();
    if (wait <= 0) return;
    connection.heartbeat = setTimeout(() => {
      if (!connections.has(connection.id)) return;
      writeFrame(connection.res, ": ping\n\n");
      log({ type: "ping", connectionId: connection.id });
      armHeartbeat(connection);
    }, wait);
  }

  function publish(text) {
    const event = { id: String(nextId++), at: new Date().toISOString(), text };
    events.push(event);
    const frame = statusFrame(event);
    for (const connection of connections.values()) {
      writeFrame(connection.res, frame);
      armHeartbeat(connection);
    }
    log({ type: "event", id: event.id, text });
    return event;
  }

  function endClean(connection, reason) {
    if (!connections.has(connection.id)) return;
    connections.delete(connection.id);
    clearTimeout(connection.heartbeat);
    clearTimeout(connection.planned);
    log({ type: "close", connectionId: connection.id, reason });
    writeFrame(connection.res, ": bye\n\n");
    connection.res.end();
  }

  function destroySocket(connection, reason) {
    if (!connections.has(connection.id)) return;
    connections.delete(connection.id);
    clearTimeout(connection.heartbeat);
    clearTimeout(connection.planned);
    log({ type: "kill", connectionId: connection.id, reason });
    connection.res.socket.destroy();
  }

  function nextAmbientStatus() {
    const text = `ambient note ${noteId}: ${ambientSteps[ambientStep]}`;
    ambientStep += 1;
    if (ambientStep >= ambientSteps.length) {
      ambientStep = 0;
      noteId = 1000 + Math.floor(Math.random() * 9000);
    }
    return text;
  }

  function openStream(req, res, url) {
    const connectionId = randomUUID();
    const heartbeatMs = config.heartbeatMs;
    const plannedCloseMs = config.plannedCloseMs;
    const watchdog = Number(config.watchdog) || 0;
    const cursor = cursorOf(req, url);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    res.write(`event: hello\ndata: ${JSON.stringify({ connectionId, serverTime: new Date().toISOString(), heartbeatMs, watchdog })}\n\n`);

    const missed = eventsAfter(cursor.raw);
    for (const event of missed) res.write(statusFrame(event));

    const connection = { id: connectionId, res, heartbeat: null, planned: null };
    connections.set(connectionId, connection);
    log({
      type: "connect",
      connectionId,
      heartbeatMs,
      plannedCloseMs,
      watchdog,
      cursor: cursor.raw,
      cursorSource: cursor.source,
      replayed: missed.map((event) => event.id),
    });

    armHeartbeat(connection);

    if (plannedCloseMs > 0) {
      connection.planned = setTimeout(() => endClean(connection, "planned"), plannedCloseMs);
    }

    req.on("close", () => {
      if (!connections.has(connectionId)) return;
      connections.delete(connectionId);
      clearTimeout(connection.heartbeat);
      clearTimeout(connection.planned);
      log({ type: "disconnect", connectionId });
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, connections: connections.size, events: events.length }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/stream") {
        openStream(req, res, url);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  const statusTimer =
    config.statusEveryMs > 0
      ? setInterval(() => publish(nextAmbientStatus()), config.statusEveryMs)
      : null;
  server.on("close", () => clearInterval(statusTimer));

  return {
    server,
    publish,
    connections,
    events,
    destroy(id) {
      const connection = connections.get(id);
      if (connection) destroySocket(connection, "test");
    },
  };
}

function start() {
  const port = Number(process.env.PORT || 8080);
  const logPath = process.env.LOG_PATH || path.join(__dirname, "..", "runs", "server.jsonl");
  const config = loadConfig();
  const { server } = createApp({ logPath, config });
  server.listen(port, "0.0.0.0", () => {
    console.log(
      `sse spike listening on ${port} (heartbeat ${config.heartbeatMs}ms, watchdog ${config.watchdog}, planned close ${config.plannedCloseMs}ms, status every ${config.statusEveryMs}ms)`,
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();

export { createApp };
