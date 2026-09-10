import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { createConnection, createServer } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../frontend",
);
const NGINX_CONFIG = resolve(FRONTEND_DIR, "nginx.conf");
const READINESS_MARKERS = resolve(FRONTEND_DIR, "readiness");
const NGINX_IMAGE = "xz-erp-local-web:latest";
const MAX_RESPONSE_BYTES = 64 * 1024;

function docker(args, { allowFailure = false, timeout = 30_000 } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  if (result.error) {
    if (allowFailure) return result;
    throw new Error(`Docker invocation failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `Docker command failed (${result.status}): ${
        (result.stderr || result.stdout || "").trim()
      }`,
    );
  }
  return result;
}

function requireLocalImage() {
  const result = docker(
    ["image", "inspect", NGINX_IMAGE, "--format", "{{.Id}}"],
    { allowFailure: true },
  );
  assert.equal(
    result.status,
    0,
    `Required local image is unavailable: ${NGINX_IMAGE}. `
      + "The edge routing gate never pulls and never skips.",
  );
}

async function findLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  assert.notEqual(typeof address, "string");
  return address.port;
}

function backendConfig() {
  const route = (name, status, body) => `
        add_header X-Stub-Route "${name}" always;
        add_header X-Stub-Method $request_method always;
        add_header X-Stub-Wire-Shape $stub_wire_shape always;
        return ${status} "${body}\\n";
`;
  return `client_body_temp_path /tmp/client_temp;
proxy_temp_path /tmp/proxy_temp;
fastcgi_temp_path /tmp/fastcgi_temp;
uwsgi_temp_path /tmp/uwsgi_temp;
scgi_temp_path /tmp/scgi_temp;

map $request_uri $stub_wire_shape {
    ~*%2e encoded-dot;
    ~*%2f encoded-slash;
    ~\\.\\. raw-dot-dot;
    ~// duplicate-slash;
    default clean;
}

server {
    listen 8080;
    server_tokens off;
    access_log off;

    location = /actuator/health/readiness {
${route("readiness", 200, "ready")}    }

    location = /actuator/health {
${route("actuator", 200, "actuator")}    }

    location = /api/v1/system/info {
${route("public", 200, "public")}    }

    location = /api/v1/product-center/spus {
${route("tenant", 200, "tenant")}    }

    location = /api/v1/platform-admin/system-admins {
${route("platform", 200, "platform")}    }

    location / {
${route("other", 404, "other")}    }
}
`;
}

async function waitForEdge(port) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await rawRequest(port, "GET", "/healthz");
      if (response.status === 200 && response.body === "ok\n") return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `Disposable edge did not start: ${lastError?.message ?? "unknown error"}`,
  );
}

async function rawRequest(
  port,
  method,
  target,
  headers = {},
  body = "",
) {
  const requestHeaders = new Map(Object.entries(headers));
  if (
    Buffer.byteLength(body) > 0
    && ![...requestHeaders.keys()].some(
      (name) =>
        name.toLowerCase() === "content-length"
        || name.toLowerCase() === "transfer-encoding",
    )
  ) {
    requestHeaders.set("Content-Length", String(Buffer.byteLength(body)));
  }
  const request = [
    `${method} ${target} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Connection: close",
    ...[...requestHeaders].map(([name, value]) => `${name}: ${value}`),
    "",
    body,
  ].join("\r\n");

  const raw = await new Promise((resolveResponse, rejectResponse) => {
    const chunks = [];
    let size = 0;
    const socket = createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => {
      socket.destroy(new Error("edge response timeout"));
    }, 6_000);
    socket.once("connect", () => socket.write(request, "latin1"));
    socket.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        socket.destroy(new Error("edge response exceeded the bounded limit"));
        return;
      }
      chunks.push(chunk);
    });
    socket.once("end", () => {
      clearTimeout(timeout);
      resolveResponse(Buffer.concat(chunks).toString("latin1"));
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      rejectResponse(error);
    });
  });

  const boundary = raw.indexOf("\r\n\r\n");
  assert.ok(boundary > 0, "edge response must contain an HTTP header block");
  const headerLines = raw.slice(0, boundary).split("\r\n");
  assert.match(headerLines[0], /^HTTP\/1\.[01] [0-9]{3}/);
  const responseHeaders = {};
  for (const line of headerLines.slice(1)) {
    const separator = line.indexOf(":");
    assert.ok(separator > 0);
    const name = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    (responseHeaders[name] ??= []).push(value);
  }
  return {
    status: Number(headerLines[0].slice(9, 12)),
    headers: responseHeaders,
    body: raw.slice(boundary + 4),
    header(name) {
      return responseHeaders[name.toLowerCase()]?.[0] ?? null;
    },
  };
}

async function accessLogs(container, expected) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = docker(["logs", container]);
    const raw = `${result.stdout}\n${result.stderr}`;
    const records = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    if (records.length === expected) return { raw, records };
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Expected exactly ${expected} edge access-log records`);
}

function assertSafeResponse(response, forbidden) {
  const surface =
    JSON.stringify(response.headers) + "\n" + response.body;
  for (const value of forbidden) {
    assert.equal(
      surface.includes(value),
      false,
      "edge response reflected a sensitive request canary",
    );
  }
  assert.equal(response.header("location"), null);
  assert.equal(response.status >= 300 && response.status < 400, false);
  assert.equal(surface.includes("backend:8080"), false);
  assert.equal(surface.includes("jdbc:postgresql:"), false);
}

test(
  "real repository edge preserves route and method while every access log stays redacted",
  { timeout: 60_000 },
  async () => {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const network = `erp-http-route-net-${suffix}`;
    const backend = `erp-http-route-backend-${suffix}`;
    const edge = `erp-http-route-edge-${suffix}`;
    const fixture = await mkdtemp(join(tmpdir(), "erp-http-route-edge-"));
    const backendConfigPath = join(fixture, "backend.conf");
    const queryCanary = `query-password-${suffix}`;
    const authorizationCanary = `authorization-token-${suffix}`;
    const headerCanary = `header-credential-${suffix}.invalid`;
    const cookieCanary = `cookie-password-${suffix}`;
    const bodyCanary = `body-secret-${suffix}`;
    const forbidden = [
      queryCanary,
      authorizationCanary,
      headerCanary,
      cookieCanary,
      bodyCanary,
    ];
    let loggedRequests = 0;

    try {
      assert.equal(
        docker(
          ["version", "--format", "{{.Server.Version}}"],
          { allowFailure: true },
        ).status,
        0,
        "Docker is required; the real edge routing gate never skips.",
      );
      requireLocalImage();
      const dockerfile = await readFile(
        resolve(FRONTEND_DIR, "Dockerfile"),
        "utf8",
      );
      assert.match(
        dockerfile,
        /^FROM nginx:1\.28-alpine@sha256:[a-f0-9]{64}$/m,
      );
      const nginxVersion = docker([
        "run", "--rm", "--pull=never", "--network", "none",
        NGINX_IMAGE, "nginx", "-v",
      ]);
      assert.match(
        `${nginxVersion.stdout}\n${nginxVersion.stderr}`,
        /^nginx version: nginx\/1\.28\./m,
      );

      await writeFile(backendConfigPath, backendConfig(), "utf8");
      docker(["network", "create", network]);
      docker([
        "run", "-d", "--pull=never",
        "--name", backend,
        "--network", network,
        "--network-alias", "backend",
        "--mount",
        `type=bind,source=${backendConfigPath},target=/etc/nginx/conf.d/default.conf,readonly`,
        NGINX_IMAGE,
      ]);
      const port = await findLoopbackPort();
      docker([
        "run", "-d", "--pull=never",
        "--name", edge,
        "--network", network,
        "--publish", `127.0.0.1:${port}:8080`,
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
        "--mount",
        `type=bind,source=${NGINX_CONFIG},target=/etc/nginx/conf.d/default.conf,readonly`,
        "--mount",
        `type=bind,source=${READINESS_MARKERS},target=/usr/share/nginx/readiness,readonly`,
        NGINX_IMAGE,
      ]);
      await waitForEdge(port);
      docker(["exec", edge, "nginx", "-t"]);

      const hostileHeaders = {
        Authorization: `Bearer ${authorizationCanary}`,
        Cookie: `session=${cookieCanary}`,
        Forwarded: `for=192.0.2.80;host=${headerCanary};proto=https`,
        Origin: `https://${headerCanary}`,
        Referer: `https://${headerCanary}/?token=${queryCanary}`,
        "User-Agent": `route-gate-${headerCanary}`,
        "X-Forwarded-For": "192.0.2.81",
        "X-Forwarded-Host": headerCanary,
        "X-Forwarded-Prefix": `/internal-${suffix}`,
        "X-Forwarded-Proto": "https",
        "X-HTTP-Method-Override": "DELETE",
        "X-Method-Override": "PATCH",
        "X-Original-URL": "/actuator/health",
        "X-Rewrite-URL": "/actuator/health",
      };
      const query =
        `?token=${queryCanary}&password=${queryCanary}&credential=${queryCanary}`;

      const pathCases = [
        ["/api/v1/system/info", "public"],
        ["/api//v1/system/info", "public"],
        ["/api/./v1/system/info", "public"],
        ["/api/route-gate/../v1/system/info", "public"],
        ["/api/%2e/v1/system/info", "public"],
        ["/api/%2E/v1/system/info", "public"],
        ["/api/v1/%73ystem/info", "public"],
        ["/api%2fv1/system/info", "public"],
        ["/api%2Fv1/system/info", "public"],
        ["/api/v1%2fsystem/info", "public"],
        ["/api/v1%2Fsystem/info", "public"],
        ["/api/v1%5csystem/info", "other"],
        ["/api/v1%5Csystem/info", "other"],
        ["/api/v1/system/info;route=gate", "other"],
        ["/api/v1/system/info.", "other"],
        ["/api/v1/system/info/", "other"],
        ["/api/v1/system/info/%C0%AF", "other"],
        ["/api/v1/system/info/" + "a".repeat(2_048), "other"],
        [
          "/api/v1/product-center/../platform-admin/system-admins",
          "platform",
        ],
      ];
      for (const [index, [target, route]] of pathCases.entries()) {
        let response;
        try {
          response = await rawRequest(
            port,
            "GET",
            target + query,
            hostileHeaders,
          );
        } catch (error) {
          throw new Error(`edge path case ${index} failed safely to parse`, {
            cause: error,
          });
        }
        loggedRequests += 1;
        assert.equal(response.header("x-stub-route"), route);
        assert.equal(response.header("x-stub-method"), "GET");
        if (target.includes("/../")) {
          assert.equal(
            response.header("x-stub-wire-shape"),
            "raw-dot-dot",
            "proxy_pass without a URI component must retain the original dot segment on the upstream wire",
          );
        }
        assertSafeResponse(response, forbidden);
      }

      const actuatorLogPaths = new Set();
      for (const [target, expectedStatus, expectedLogPath] of [
        ["/actuator", 404, "/actuator"],
        ["/actuator/", 404, "/actuator/"],
        ["/ACTUATOR/ENV", 404, "/ACTUATOR/ENV"],
        ["/actuator//metrics", 404, "/actuator/metrics"],
        ["/actuator/./env", 404, "/actuator/env"],
        ["/%61ctuator/configprops", 404, "/actuator/configprops"],
        ["/actuator/%65nv", 404, "/actuator/env"],
        ["/actuator/%2e/loggers", 404, "/actuator/loggers"],
        ["/actuator/%2Fenv", 404, "/actuator/env"],
        ["/api/actuator", 404, "/api/actuator"],
        ["/api/actuator/", 404, "/api/actuator/"],
        ["/api/ACTUATOR/ENV", 404, "/api/ACTUATOR/ENV"],
        ["/api/actuator//metrics", 404, "/api/actuator/metrics"],
        ["/api/actuator/./env", 404, "/api/actuator/env"],
        ["/api/%61ctuator/configprops", 404, "/api/actuator/configprops"],
        ["/api/actuator/%65nv", 404, "/api/actuator/env"],
        ["/api/actuator/%2e/loggers", 404, "/api/actuator/loggers"],
        ["/api/actuator/%2Fenv", 404, "/api/actuator/env"],
      ]) {
        const response = await rawRequest(
          port,
          "GET",
          target + query,
          hostileHeaders,
        );
        loggedRequests += 1;
        assert.equal(response.status, expectedStatus);
        assert.equal(response.header("x-stub-route"), null);
        assert.equal(response.header("x-stub-method"), null);
        if (expectedStatus === 404) {
          assert.equal(response.header("content-type"), "text/plain");
          assert.equal(response.body, "not found\n");
          actuatorLogPaths.add(expectedLogPath);
        }
        assertSafeResponse(response, forbidden);
      }

      for (const [target, status, route] of [
        ["/api/%GG/system" + query, 400, null],
        ["/api/%00/system" + query, 400, null],
        ["/api/%1F/system" + query, 404, "other"],
      ]) {
        const response = await rawRequest(
          port,
          "GET",
          target,
          hostileHeaders,
        );
        loggedRequests += 1;
        assert.equal(response.status, status);
        assert.equal(response.header("x-stub-route"), route);
        assertSafeResponse(response, forbidden);
      }

      for (const target of [
        "/api%5cv1/system/info",
        "/api%5Cv1/system/info",
        "/api\\v1/system/info",
      ]) {
        const response = await rawRequest(
          port,
          "GET",
          target + query,
          hostileHeaders,
        );
        loggedRequests += 1;
        assert.equal(response.status, 200);
        assert.equal(response.header("x-stub-route"), null);
        assertSafeResponse(response, forbidden);
      }

      for (const target of [
        "/api/../actuator/health",
        "/api/%2e%2e/actuator/health",
      ]) {
        const response = await rawRequest(
          port,
          "GET",
          target + query,
          hostileHeaders,
        );
        loggedRequests += 1;
        assert.equal(
          response.status,
          404,
          `actuator traversal must fail closed: ${target}`,
        );
        assert.equal(response.header("x-stub-route"), null);
        assert.equal(response.header("content-type"), "text/plain");
        assert.equal(response.body, "not found\n");
        actuatorLogPaths.add("/actuator/health");
        assertSafeResponse(response, forbidden);
      }

      for (const method of [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ]) {
        const response = await rawRequest(
          port,
          method,
          "/api/v1/system/info" + query,
          hostileHeaders,
          method === "POST" ? bodyCanary : "",
        );
        loggedRequests += 1;
        assert.equal(response.status, 200);
        assert.equal(response.header("x-stub-route"), "public");
        assert.equal(response.header("x-stub-method"), method);
        assertSafeResponse(response, forbidden);
      }

      const trace = await rawRequest(
        port,
        "TRACE",
        "/api/v1/system/info" + query,
        hostileHeaders,
      );
      loggedRequests += 1;
      assert.equal(trace.status, 405);
      assert.equal(trace.header("x-stub-route"), null);
      assertSafeResponse(trace, forbidden);

      const conflictingFraming = await rawRequest(
        port,
        "POST",
        "/api/v1/system/info" + query,
        {
          ...hostileHeaders,
          "Content-Length": "4",
          "Transfer-Encoding": "chunked",
          "Content-Type": "application/json",
        },
        "0\r\n\r\n",
      );
      loggedRequests += 1;
      assert.equal(
        conflictingFraming.status >= 400
          && conflictingFraming.status < 500,
        true,
      );
      assertSafeResponse(conflictingFraming, forbidden);

      assert.equal((await rawRequest(port, "GET", "/healthz")).status, 200);
      assert.equal((await rawRequest(port, "GET", "/readyz")).status, 200);

      const captured = await accessLogs(edge, loggedRequests);
      for (const value of forbidden) {
        assert.equal(
          captured.raw.includes(value),
          false,
          "edge access logs contain a query, header, cookie, or body canary",
        );
      }
      assert.equal(captured.raw.includes("combined"), false);
      assert.equal(captured.raw.includes("backend:8080"), false);
      assert.equal(captured.raw.includes("jdbc:postgresql:"), false);
      for (const record of captured.records) {
        assert.deepEqual(
          Object.keys(record).sort(),
          ["bytes", "duration", "method", "path", "peer", "status", "time"],
        );
        assert.equal(record.path.includes("?"), false);
        assert.equal(typeof record.method, "string");
        assert.equal(Number.isInteger(record.status), true);
      }
      const loggedPaths = new Set(
        captured.records.map((record) => record.path),
      );
      for (const path of actuatorLogPaths) {
        assert.equal(
          loggedPaths.has(path),
          true,
          `actuator probe must retain normalized access-log path: ${path}`,
        );
        assert.notEqual(path, "/index.html");
      }
    } finally {
      for (const container of [edge, backend]) {
        docker(["rm", "-f", container], { allowFailure: true });
      }
      docker(["network", "rm", network], { allowFailure: true });
      await rm(fixture, { recursive: true, force: true });
    }
  },
);
