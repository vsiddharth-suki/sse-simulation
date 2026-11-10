import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createApp } from "./server.js";

async function withServer(fn, config = {}) {
  const app = createApp({
    config: { heartbeatMs: 0, plannedCloseMs: 0, statusEveryMs: 0, watchdog: 0, ...config },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  try {
    await fn(app, port);
  } finally {
    app.server.closeAllConnections?.();
    await new Promise((resolve) => app.server.close(resolve));
  }
}

function openStream(port, { path = "/stream", headers = {}, ms = 400 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ status: res.statusCode, raw, ended: false });
      }, ms);
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, raw, ended: true });
      });
    });
    req.on("error", (error) => {
      if (error.code === "ECONNRESET") resolve({ status: 200, raw: "", ended: true, reset: true });
      else reject(error);
    });
  });
}

function connectionId(raw) {
  const match = raw.match(/event: hello\ndata: (\{.*\})/);
  assert.ok(match, `missing hello in:\n${raw}`);
  return JSON.parse(match[1]).connectionId;
}

test("cold start does not replay old events", async () => {
  await withServer(async (app, port) => {
    app.publish("older");
    const result = await openStream(port, { ms: 150 });
    assert.equal(result.status, 200);
    assert.match(result.raw, /event: hello/);
    assert.doesNotMatch(result.raw, /event: status/);
  });
});

test("query cursor replays only newer events", async () => {
  await withServer(async (app, port) => {
    app.publish("one");
    app.publish("two");
    app.publish("three");
    const result = await openStream(port, { path: "/stream?last_seq=1", ms: 150 });
    assert.match(result.raw, /"seq":"2"/);
    assert.match(result.raw, /"seq":"3"/);
    assert.doesNotMatch(result.raw, /"seq":"1"/);
  });
});

test("Last-Event-ID wins over last_seq", async () => {
  await withServer(async (app, port) => {
    app.publish("one");
    app.publish("two");
    app.publish("three");
    const result = await openStream(port, {
      path: "/stream?last_seq=1",
      headers: { "Last-Event-ID": "2" },
      ms: 150,
    });
    assert.match(result.raw, /"seq":"3"/);
    assert.doesNotMatch(result.raw, /"seq":"2"/);
    assert.doesNotMatch(result.raw, /"seq":"1"/);
  });
});

test("watchdog off never pings", async () => {
  await withServer(async (_app, port) => {
    const result = await openStream(port, { ms: 200 });
    assert.doesNotMatch(result.raw, /: ping/);
  }, { heartbeatMs: 40, watchdog: 0 });
});

test("status traffic postpones the server ping", async () => {
  await withServer(
    async (_app, port) => {
      const result = await openStream(port, { ms: 180 });
      assert.match(result.raw, /ambient note \d+: IN_PROGRESS/);
      assert.doesNotMatch(result.raw, /: ping/);
    },
    { heartbeatMs: 200, statusEveryMs: 40, watchdog: 2 },
  );
});

test("server pings after watchdog times the heartbeat of silence", async () => {
  await withServer(async (_app, port) => {
    const result = await openStream(port, { ms: 220 });
    assert.match(result.raw, /"watchdog":2/);
    assert.match(result.raw, /: ping/);
    assert.doesNotMatch(result.raw, /id:.*\n: ping/);
  }, { heartbeatMs: 40, watchdog: 2 });
});

test("planned close ends the response after a finished hello", async () => {
  await withServer(async (_app, port) => {
    const result = await openStream(port, { ms: 800 });
    assert.equal(result.ended, true);
    assert.match(result.raw, /event: hello/);
    assert.match(result.raw, /: bye/);
  }, { plannedCloseMs: 120 });
});

test("hard kill destroys the socket", async () => {
  await withServer(async (app, port) => {
    const seen = await new Promise((resolve, reject) => {
      const req = http.get({ port, path: "/stream" }, (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
          if (raw.includes("connectionId")) resolve({ req, raw });
        });
      });
      req.on("error", reject);
    });
    const id = connectionId(seen.raw);
    const closed = new Promise((resolve) => {
      seen.req.on("error", () => resolve("error"));
      seen.req.on("close", () => resolve("close"));
    });
    app.destroy(id);
    const how = await closed;
    assert.ok(how === "error" || how === "close");
  });
});
