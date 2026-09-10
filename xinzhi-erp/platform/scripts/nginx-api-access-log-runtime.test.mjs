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
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend");
const FRONTEND_DOCKERFILE = resolve(FRONTEND_DIR, "Dockerfile");
const NGINX_CONFIG = resolve(FRONTEND_DIR, "nginx.conf");
const READINESS_MARKERS = resolve(FRONTEND_DIR, "readiness");
const NGINX_IMAGE = "xz-erp-local-web:latest";

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
    `Required repository frontend image is unavailable: ${NGINX_IMAGE}. `
      + "The real access-log gate never pulls and never skips.",
  );
  assert.match(result.stdout.trim(), /^sha256:[a-f0-9]{64}$/);
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

async function request(baseUrl, path, headers) {
  return fetch(`${baseUrl}${path}`, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(6_000),
  });
}

async function waitForEdge(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request(baseUrl, "/healthz", {});
      if (response.status === 200 && await response.text() === "ok\n") return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `Disposable edge did not start: ${lastError?.message ?? "unknown error"}`,
  );
}

async function accessLogLines(container, expected) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = docker(["logs", container]);
    const lines = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"));
    if (lines.length === expected) {
      return {
        raw: `${result.stdout}\n${result.stderr}`,
        lines,
      };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Expected exactly ${expected} API access-log records`);
}

function backendConfig() {
  return `client_body_temp_path /tmp/client_temp;
proxy_temp_path /tmp/proxy_temp;
fastcgi_temp_path /tmp/fastcgi_temp;
uwsgi_temp_path /tmp/uwsgi_temp;
scgi_temp_path /tmp/scgi_temp;

server {
    listen 8080;
    server_tokens off;
    access_log off;

    location = /actuator/health/readiness {
        return 200 "ready\\n";
    }

    location = /api/v1/access-log/success {
        add_header X-Stub-Backend repository-nginx-gate always;
        return 200 "proxied-success\\n";
    }

    location = /api/v1/access-log/client-error {
        add_header X-Stub-Backend repository-nginx-gate always;
        return 404 "proxied-client-error\\n";
    }

    location = /api/v1/access-log/server-error {
        add_header X-Stub-Backend repository-nginx-gate always;
        return 503 "proxied-server-error\\n";
    }

    location / {
        return 418;
    }
}
`;
}

test(
  "repository Nginx proxies API requests and emits only the approved query-free fields",
  { timeout: 45_000 },
  async () => {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const backendNetwork = `erp-api-log-backend-net-${suffix}`;
    const edgeNetwork = `erp-api-log-edge-net-${suffix}`;
    const backend = `erp-api-log-backend-${suffix}`;
    const edge = `erp-api-log-edge-${suffix}`;
    const fixture = await mkdtemp(join(tmpdir(), "erp-api-log-nginx-"));
    const backendConfigPath = join(fixture, "backend.conf");

    const queryCanary = `query-token-${suffix}`;
    const refererCanary = `referer-canary-${suffix}`;
    const authorizationCanary = `authorization-canary-${suffix}`;
    const cookieCanary = `cookie-canary-${suffix}`;
    const originCanary = `origin-canary-${suffix}.invalid`;
    const forwardedCanary = `forwarded-canary-${suffix}.invalid`;
    const hostCanary = `host-canary-${suffix}.invalid`;
    const userAgentCanary = `user-agent-canary-${suffix}`;
    const xForwardedCanary = `xff-canary-${suffix}`;

    try {
      const daemon = docker(
        ["version", "--format", "{{.Server.Version}}"],
        { allowFailure: true },
      );
      assert.equal(
        daemon.status,
        0,
        "Docker is required for the real Nginx API access-log gate; it never skips.",
      );
      requireLocalImage();

      const dockerfile = await readFile(FRONTEND_DOCKERFILE, "utf8");
      assert.match(
        dockerfile,
        /^FROM nginx:1\.28-alpine@sha256:[a-f0-9]{64}$/m,
        "The repository frontend runtime must retain a digest-pinned Nginx image.",
      );
      const imageService = docker([
        "image", "inspect", NGINX_IMAGE,
        "--format", '{{index .Config.Labels "com.docker.compose.service"}}',
      ]).stdout.trim();
      assert.equal(imageService, "web");
      const imageHistory = docker([
        "image", "history", "--no-trunc", "--format", "{{.CreatedBy}}",
        NGINX_IMAGE,
      ]).stdout;
      assert.match(
        imageHistory,
        /COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/,
        "The local test image must have the repository frontend Dockerfile shape.",
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
      docker(["network", "create", "--internal", backendNetwork]);
      docker(["network", "create", edgeNetwork]);
      docker([
        "run", "-d", "--pull=never",
        "--name", backend,
        "--network", backendNetwork,
        "--network-alias", "backend",
        "--mount",
        `type=bind,source=${backendConfigPath},target=/etc/nginx/conf.d/default.conf,readonly`,
        NGINX_IMAGE,
      ]);

      const port = await findLoopbackPort();
      docker([
        "create", "--pull=never",
        "--name", edge,
        "--network", edgeNetwork,
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
      docker(["network", "connect", backendNetwork, edge]);
      docker(["start", edge]);

      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForEdge(baseUrl);
      docker(["exec", edge, "nginx", "-t"]);
      const headers = {
        Authorization: `Bearer ${authorizationCanary}`,
        Cookie: `session=${cookieCanary}`,
        Forwarded: `for=192.0.2.10;host=${forwardedCanary};proto=https`,
        Host: hostCanary,
        Origin: `https://${originCanary}`,
        Referer: `https://${refererCanary}.invalid/source?token=${queryCanary}`,
        "User-Agent": `${userAgentCanary}/1.0`,
        "X-Forwarded-For": xForwardedCanary,
        "X-Forwarded-Host": forwardedCanary,
        "X-Forwarded-Prefix": `/internal-${suffix}`,
        "X-Forwarded-Proto": "https",
      };
      const query =
        `?access_token=${queryCanary}&password=${queryCanary}&credential=${queryCanary}`;

      const successful = await request(
        baseUrl,
        `/api/v1/access-log/success${query}`,
        headers,
      );
      assert.equal(successful.status, 200);
      assert.equal(successful.headers.get("x-stub-backend"), "repository-nginx-gate");
      assert.equal(await successful.text(), "proxied-success\n");

      const clientError = await request(
        baseUrl,
        `/api/v1/access-log/client-error${query}`,
        headers,
      );
      assert.equal(clientError.status, 404);
      assert.equal(clientError.headers.get("x-stub-backend"), "repository-nginx-gate");
      assert.equal(await clientError.text(), "proxied-client-error\n");

      const serverError = await request(
        baseUrl,
        `/api/v1/access-log/server-error${query}`,
        headers,
      );
      assert.equal(serverError.status, 503);
      assert.equal(serverError.headers.get("x-stub-backend"), "repository-nginx-gate");
      assert.equal(await serverError.text(), "proxied-server-error\n");

      for (const path of [
        "/actuator/env",
        "/api/actuator/prometheus",
      ]) {
        const denied = await request(baseUrl, `${path}${query}`, headers);
        assert.equal(denied.status, 404);
        assert.equal(denied.headers.get("content-type"), "text/plain");
        assert.equal(denied.headers.get("x-stub-backend"), null);
        assert.equal(await denied.text(), "not found\n");
      }

      assert.equal((await request(baseUrl, "/healthz", headers)).status, 200);
      assert.equal((await request(baseUrl, "/readyz", headers)).status, 200);

      const captured = await accessLogLines(edge, 5);
      const backendAddress = docker([
        "inspect",
        "--format",
        `{{(index .NetworkSettings.Networks "${backendNetwork}").IPAddress}}`,
        backend,
      ]).stdout.trim();
      assert.match(backendAddress, /^(?:\d{1,3}\.){3}\d{1,3}$/);
      const forbiddenValues = [
        queryCanary,
        refererCanary,
        authorizationCanary,
        cookieCanary,
        originCanary,
        forwardedCanary,
        hostCanary,
        userAgentCanary,
        xForwardedCanary,
        "access_token",
        "password",
        "credential",
        "Authorization",
        "Cookie",
        "Origin",
        "Referer",
        "Forwarded",
        "User-Agent",
        "backend",
        "backend:8080",
        "/actuator/health/readiness",
        `/internal-${suffix}`,
        backendAddress,
      ];
      for (const forbidden of forbiddenValues) {
        assert.equal(
          captured.raw.includes(forbidden),
          false,
          "access log contains a forbidden canary or internal upstream value",
        );
      }

      const records = captured.lines.map((line) => JSON.parse(line));
      assert.deepEqual(
        records.map((record) => record.path),
        [
          "/api/v1/access-log/success",
          "/api/v1/access-log/client-error",
          "/api/v1/access-log/server-error",
          "/actuator/env",
          "/api/actuator/prometheus",
        ],
      );
      assert.deepEqual(
        records.map((record) => record.status),
        [200, 404, 503, 404, 404],
      );
      assert.equal(
        records.some((record) => record.path === "/index.html"),
        false,
      );
      for (const record of records) {
        assert.deepEqual(
          Object.keys(record).sort(),
          ["bytes", "duration", "method", "path", "peer", "status", "time"],
        );
        assert.equal(record.method, "GET");
        assert.match(record.peer, /^(?:\d{1,3}\.){3}\d{1,3}$/);
        assert.match(record.time, /^\d{4}-\d{2}-\d{2}T/);
        assert.equal(Number.isInteger(record.bytes), true);
        assert.ok(record.bytes > 0);
        assert.equal(typeof record.duration, "number");
        assert.ok(record.duration >= 0);
        assert.equal(JSON.stringify(record).includes("?"), false);
      }
    } finally {
      for (const container of [edge, backend]) {
        docker(["rm", "-f", container], { allowFailure: true });
      }
      docker(["network", "rm", backendNetwork], { allowFailure: true });
      docker(["network", "rm", edgeNetwork], { allowFailure: true });
      await rm(fixture, { recursive: true, force: true });
    }
  },
);
