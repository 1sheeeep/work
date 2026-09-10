import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { connectOverCDPWithRetry, preflightCDP } from "./cdp_connect_utils.mjs";

test("CDP preflight fails quickly when target list hangs", async () => {
  const server = await startFakeCDPServer((req, res) => {
    if (req.url === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Browser: "FakeChrome/1.0" }));
      return;
    }
    if (req.url === "/json/list") {
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await assert.rejects(
      preflightCDP(server.url, 80),
      /cdp_http_list_unavailable/
    );
  } finally {
    await server.close();
  }
});

test("CDP connect timeout is reported as cdp_handshake_timeout", async () => {
  const server = await startFakeCDPServer((req, res) => {
    if (req.url === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Browser: "FakeChrome/1.0" }));
      return;
    }
    if (req.url === "/json/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ id: "page-1", type: "page", url: "https://example.test" }]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await assert.rejects(
      connectOverCDPWithRetry(server.url, {
        attempts: [{ delay: 0, connectTimeout: 60, preflightTimeout: 80 }],
        connector: () => new Promise(() => {})
      }),
      /cdp_handshake_timeout/
    );
  } finally {
    await server.close();
  }
});

test("CDP preflight requires at least one target page", async () => {
  const server = await startFakeCDPServer((req, res) => {
    if (req.url === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Browser: "FakeChrome/1.0" }));
      return;
    }
    if (req.url === "/json/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await assert.rejects(
      preflightCDP(server.url, 80),
      /cdp_no_targets/
    );
  } finally {
    await server.close();
  }
});

async function startFakeCDPServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
