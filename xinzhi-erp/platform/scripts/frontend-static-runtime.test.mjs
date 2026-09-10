import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend");
const FRONTEND_DOCKERFILE = resolve(FRONTEND_DIR, "Dockerfile");
const NGINX_CONFIG = resolve(FRONTEND_DIR, "nginx.conf");
const READINESS_MARKERS = resolve(FRONTEND_DIR, "readiness");
const NGINX_IMAGE = "xz-erp-local-web:latest";
const INDEX_CANARY = "repository-owned-index-canary";
const ASSET_CANARY = "repository-owned-asset-canary";

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
  const daemon = docker(
    ["version", "--format", "{{.Server.Version}}"],
    { allowFailure: true },
  );
  assert.equal(
    daemon.status,
    0,
    "Docker is required for the real frontend static gate; it never skips.",
  );
  const inspected = docker(
    ["image", "inspect", NGINX_IMAGE, "--format", "{{.Id}}"],
    { allowFailure: true },
  );
  assert.equal(
    inspected.status,
    0,
    `Required local runtime image is unavailable: ${NGINX_IMAGE}. `
      + "The gate does not pull images or silently skip.",
  );
  assert.match(inspected.stdout.trim(), /^sha256:[a-f0-9]{64}$/);
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

async function request(baseUrl, requestPath, options = {}) {
  return fetch(`${baseUrl}${requestPath}`, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(6_000),
  });
}

async function rawRequest(baseUrl, requestPath) {
  const target = new URL(baseUrl);
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method: "GET",
        path: requestPath,
        timeout: 6_000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolveRequest({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
        }));
      },
    );
    outgoing.once("error", rejectRequest);
    outgoing.once("timeout", () => outgoing.destroy(new Error("request timed out")));
    outgoing.end();
  });
}

async function waitForEdge(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request(baseUrl, "/healthz");
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
        default_type text/plain;
        return 200 "ready\\n";
    }

    location /api/ {
        default_type text/plain;
        add_header X-Stub-Method $request_method always;
        add_header X-Stub-Uri $request_uri always;
        return 200 "proxied\\n";
    }

    location / {
        return 404;
    }
}
`;
}

async function assertGenericNotFound(baseUrl, requestPath) {
  const response = await request(baseUrl, requestPath);
  const body = await response.text();
  assert.equal(response.status, 404, `expected fail-closed 404 for ${requestPath}`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain\b/);
  assert.equal(body, "not found\n");
  assert.doesNotMatch(
    `${body}\n${response.headers.get("server") ?? ""}`,
    /repository-owned|\/usr\/share|workspace|exception|stack|nginx\/\d/i,
  );
}

test(
  "real Nginx serves only the reviewed SPA and static surface",
  { timeout: 45_000 },
  async () => {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const backendNetwork = `erp-frontend-static-backend-net-${suffix}`;
    const edgeNetwork = `erp-frontend-static-edge-net-${suffix}`;
    const backend = `erp-frontend-static-backend-${suffix}`;
    const edge = `erp-frontend-static-edge-${suffix}`;
    const fixture = await mkdtemp(join(tmpdir(), "erp-frontend-static-"));
    const htmlRoot = join(fixture, "html");
    const assets = join(htmlRoot, "assets");
    const backendConfigPath = join(fixture, "backend.conf");

    try {
      requireLocalImage();
      const dockerfile = await readFile(FRONTEND_DOCKERFILE, "utf8");
      assert.match(
        dockerfile,
        /^FROM nginx:1\.28-alpine@sha256:[a-f0-9]{64}$/m,
        "the runtime stage must retain its digest-pinned Nginx image",
      );
      const nginxVersion = docker([
        "run", "--rm", "--pull=never", "--network", "none",
        NGINX_IMAGE, "nginx", "-v",
      ]);
      assert.match(
        `${nginxVersion.stdout}\n${nginxVersion.stderr}`,
        /^nginx version: nginx\/1\.28\./m,
      );

      await mkdir(assets, { recursive: true });
      await writeFile(
        join(htmlRoot, "index.html"),
        [
          "<!doctype html><title>XZ ERP</title>",
          '<link rel="icon" href="/favicon.ico">',
          '<link rel="manifest" href="/manifest.webmanifest">',
          `<div>${INDEX_CANARY}</div>`,
        ].join(""),
        "utf8",
      );
      await writeFile(
        join(assets, "app-A1b2C3.js"),
        `globalThis.__fixture="${ASSET_CANARY}";`,
        "utf8",
      );
      await writeFile(
        join(assets, "app-A1b2C3.css"),
        "body{color:#123}",
        "utf8",
      );
      await writeFile(
        join(htmlRoot, "manifest.webmanifest"),
        '{"name":"XZ ERP"}',
        "utf8",
      );
      await writeFile(
        join(htmlRoot, "favicon.ico"),
        Buffer.from([0x00, 0x00, 0x01, 0x00]),
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
        "--mount",
        `type=bind,source=${htmlRoot},target=/usr/share/nginx/html,readonly`,
        NGINX_IMAGE,
      ]);
      docker(["network", "connect", backendNetwork, edge]);
      docker(["start", edge]);

      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForEdge(baseUrl);
      docker(["exec", edge, "nginx", "-t"]);

      for (const requestPath of ["/", "/index.html", "/orders", "/settings"]) {
        const response = await request(baseUrl, requestPath);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), await readFile(join(htmlRoot, "index.html"), "utf8"));
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }

      const script = await request(baseUrl, "/assets/app-A1b2C3.js");
      assert.equal(script.status, 200);
      assert.equal(await script.text(), `globalThis.__fixture="${ASSET_CANARY}";`);
      assert.equal(script.headers.get("x-content-type-options"), "nosniff");
      const stylesheet = await request(baseUrl, "/assets/app-A1b2C3.css");
      assert.equal(stylesheet.status, 200);
      assert.equal(await stylesheet.text(), "body{color:#123}");
      const manifest = await request(baseUrl, "/manifest.webmanifest");
      assert.equal(manifest.status, 200);
      assert.equal(await manifest.text(), '{"name":"XZ ERP"}');
      assert.equal(manifest.headers.get("x-content-type-options"), "nosniff");
      const favicon = await request(baseUrl, "/favicon.ico");
      assert.equal(favicon.status, 200);
      assert.deepEqual(
        Buffer.from(await favicon.arrayBuffer()),
        Buffer.from([0x00, 0x00, 0x01, 0x00]),
      );
      assert.equal(favicon.headers.get("x-content-type-options"), "nosniff");
      const head = await request(baseUrl, "/assets/app-A1b2C3.js", { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");

      for (const requestPath of [
        "/api/v1/report.json",
        "/api/v1/path.with.dot",
      ]) {
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
          const proxied = await request(baseUrl, requestPath, { method });
          assert.equal(proxied.status, 200);
          assert.equal(await proxied.text(), "proxied\n");
          assert.equal(proxied.headers.get("x-stub-method"), method);
          assert.equal(proxied.headers.get("x-stub-uri"), requestPath);
        }
      }

      const apiDotSegment = await rawRequest(
        baseUrl,
        "/api/route-gate/../v1/report.json",
      );
      assert.equal(apiDotSegment.status, 200);
      assert.equal(apiDotSegment.headers["x-stub-method"], "GET");
      assert.equal(
        apiDotSegment.headers["x-stub-uri"],
        "/api/route-gate/../v1/report.json",
      );
      assert.doesNotMatch(apiDotSegment.body, new RegExp(INDEX_CANARY));

      const malformedApi = await rawRequest(baseUrl, "/api/%GG/report.json");
      assert.equal(malformedApi.status, 400);
      assert.doesNotMatch(malformedApi.body, new RegExp(INDEX_CANARY));
      const ready = await request(baseUrl, "/readyz");
      assert.equal(ready.status, 200);
      assert.equal(await ready.text(), "ready\n");

      for (const requestPath of [
        "/.env",
        "/.env.production",
        "/.git/config",
        "/Dockerfile",
        "/LICENSE",
        "/nginx.conf",
        "/package.json",
        "/package-lock.json",
        "/settings.json",
        "/vite.config.ts",
        "/src/main.tsx",
        "/app.js",
        "/app.css",
        "/app.js.map",
        "/manifest.json",
        "/favicon.svg",
        "/robots.txt",
        "/file.xml",
        "/module.wasm",
        "/document.pdf",
        "/nested/archive.unknown-extension",
        "/backup.sql",
        "/server.pem",
        "/50x.html",
        "/assets",
        "/assets/",
        "/assets/missing.js",
        "/assets/.env",
        "/assets/source.tsx",
        "/assets/app.js.map",
      ]) {
        await assertGenericNotFound(baseUrl, requestPath);
      }

      const traversal = await rawRequest(
        baseUrl,
        "/%2e%2e/%2e%2e/etc/passwd",
      );
      assert.notEqual(traversal.status, 200);
      assert.doesNotMatch(
        traversal.body,
        /repository-owned|root:|\/usr\/share|workspace|exception|stack|nginx\/\d/i,
      );
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
