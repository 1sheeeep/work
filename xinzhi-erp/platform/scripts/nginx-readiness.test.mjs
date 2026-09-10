import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  join,
  resolve,
} from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend');
const NGINX_CONFIG = resolve(FRONTEND_DIR, 'nginx.conf');
const READINESS_MARKERS = resolve(FRONTEND_DIR, 'readiness');
const NGINX_IMAGE =
  process.env.ERP_NGINX_TEST_IMAGE ?? 'xz-erp-local-web:latest';
const ALPINE_IMAGE =
  process.env.ERP_ALPINE_TEST_IMAGE ?? 'alpine:3';
const UPSTREAM_BODY_CANARY = 'upstream-body-must-not-cross-edge';
const UPSTREAM_HEADER_CANARY = 'upstream-header-must-not-cross-edge';

function docker(args, { allowFailure = false, timeout = 30_000 } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  if (result.error) {
    if (allowFailure) {
      return result;
    }
    throw new Error(`Docker invocation failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`Docker command failed (${result.status}): ${detail}`);
  }
  return result;
}

function requireLocalImage(image) {
  const result = docker(
    ['image', 'inspect', image, '--format', '{{.Id}}'],
    { allowFailure: true },
  );
  assert.equal(
    result.status,
    0,
    `Required local test image is unavailable: ${image}. `
      + 'The readiness gate does not pull images or silently skip.',
  );
}

function backendConfig(mode) {
  let handler;
  if (mode === 'up') {
    handler = `
        if ($http_authorization != "") { return 418 "authorization leaked\\n"; }
        if ($http_cookie != "") { return 418 "cookie leaked\\n"; }
        if ($http_x_forwarded_for != "") { return 418 "forwarded header leaked\\n"; }
        add_header Content-Type application/json always;
        add_header Set-Cookie "session=upstream-cookie" always;
        add_header WWW-Authenticate "Bearer realm=internal" always;
        add_header Location "http://backend:8080/internal" always;
        add_header X-Upstream-Host "backend.internal" always;
        add_header X-Upstream-Secret "${UPSTREAM_HEADER_CANARY}" always;
        return 200 "${UPSTREAM_BODY_CANARY}\\n";
`;
  } else if (mode === 'down') {
    handler = `
        add_header Content-Type application/json always;
        add_header Set-Cookie "session=upstream-cookie" always;
        add_header WWW-Authenticate "Bearer realm=internal" always;
        add_header Location "http://backend:8080/internal" always;
        add_header X-Upstream-Host "backend.internal" always;
        add_header X-Upstream-Secret "${UPSTREAM_HEADER_CANARY}" always;
        return 503 "{\\"status\\":\\"DOWN\\",\\"db\\":\\"jdbc:postgresql://backend.internal/secret\\",\\"username\\":\\"erp_secret\\"}\\n";
`;
  } else if (mode === 'no-content') {
    handler = '        return 204;\n';
  } else if (mode === 'timeout') {
    handler = `
        proxy_connect_timeout 1s;
        proxy_read_timeout 10s;
        proxy_pass http://slow:8080;
`;
  } else {
    throw new Error(`Unknown backend mode: ${mode}`);
  }

  return `client_body_temp_path /tmp/client_temp;
proxy_temp_path /tmp/proxy_temp;
fastcgi_temp_path /tmp/fastcgi_temp;
uwsgi_temp_path /tmp/uwsgi_temp;
scgi_temp_path /tmp/scgi_temp;

server {
    listen 8080;
    server_tokens off;

    location = /actuator/health/readiness {
${handler}    }

    location / {
        return 404;
    }
}
`;
}

async function waitForEdge(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 200 && await response.text() === 'ok\n') {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Disposable edge did not start: ${lastError?.message ?? 'unknown error'}`);
}

async function findLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  assert.notEqual(typeof address, 'string');
  return address.port;
}

async function request(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(6_000),
    ...options,
  });
}

function assertSafeProbeHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('x-upstream-host'), null);
  assert.equal(response.headers.get('x-upstream-secret'), null);
  assert.equal(
    JSON.stringify(Object.fromEntries(response.headers))
      .includes(UPSTREAM_HEADER_CANARY),
    false,
  );
}

async function assertFixedResponse(response, status, body) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /^text\/plain\b/i);
  assertSafeProbeHeaders(response);
  const responseBody = await response.text();
  assert.equal(responseBody, body);
  assert.equal(responseBody.includes(UPSTREAM_BODY_CANARY), false);
  assert.equal(responseBody.includes('jdbc:postgresql:'), false);
  assert.equal(responseBody.includes('erp_secret'), false);
  assert.equal(responseBody.includes('backend.internal'), false);
}

test(
  'real Nginx readiness gate is exact, fail-closed, and redacted',
  { timeout: 45_000 },
  async () => {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const backendNetwork = `erp-readyz-backend-net-${suffix}`;
    const edgeNetwork = `erp-readyz-edge-net-${suffix}`;
    const slow = `erp-readyz-slow-${suffix}`;
    const backend = `erp-readyz-backend-${suffix}`;
    const edge = `erp-readyz-edge-${suffix}`;
    const fixture = await mkdtemp(join(tmpdir(), 'erp-readyz-nginx-'));
    const backendConfigPath = join(fixture, 'backend.conf');

    try {
      assert.deepEqual(
        await readFile(resolve(READINESS_MARKERS, '200')),
        Buffer.from('ready\n', 'utf8'),
        'The readiness success marker must remain byte-exact LF on every checkout.',
      );

      const daemon = docker(
        ['version', '--format', '{{.Server.Version}}'],
        { allowFailure: true },
      );
      assert.equal(
        daemon.status,
        0,
        'Docker is required for the real Nginx readiness gate; the test does not skip.',
      );
      requireLocalImage(NGINX_IMAGE);
      requireLocalImage(ALPINE_IMAGE);

      const nginxBuild = docker([
        'run', '--rm', '--network', 'none',
        NGINX_IMAGE, 'nginx', '-V',
      ]);
      assert.match(
        `${nginxBuild.stdout}\n${nginxBuild.stderr}`,
        /--with-http_auth_request_module/,
      );

      await writeFile(backendConfigPath, backendConfig('up'), 'utf8');
      docker(['network', 'create', '--internal', backendNetwork]);
      docker(['network', 'create', edgeNetwork]);
      docker([
        'run', '-d',
        '--name', slow,
        '--network', backendNetwork,
        '--network-alias', 'slow',
        ALPINE_IMAGE,
        'sh', '-c', 'while true; do nc -l -p 8080 >/dev/null; done',
      ]);
      docker([
        'run', '-d',
        '--name', backend,
        '--network', backendNetwork,
        '--network-alias', 'backend',
        '--mount',
        `type=bind,source=${backendConfigPath},target=/etc/nginx/conf.d/default.conf,readonly`,
        NGINX_IMAGE,
      ]);
      const port = await findLoopbackPort();
      docker([
        'create',
        '--name', edge,
        '--network', edgeNetwork,
        '--publish', `127.0.0.1:${port}:8080`,
        '--read-only',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
        '--mount',
        `type=bind,source=${NGINX_CONFIG},target=/etc/nginx/conf.d/default.conf,readonly`,
        '--mount',
        `type=bind,source=${READINESS_MARKERS},target=/usr/share/nginx/readiness,readonly`,
        NGINX_IMAGE,
      ]);
      docker(['network', 'connect', backendNetwork, edge]);
      docker(['start', edge]);

      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForEdge(baseUrl);
      docker(['exec', edge, 'nginx', '-t']);

      const liveness = await request(baseUrl, '/healthz');
      assert.equal(liveness.status, 200);
      assert.equal(await liveness.text(), 'ok\n');

      const ready = await request(baseUrl, '/readyz', {
        headers: {
          Authorization: 'Bearer request-secret',
          Cookie: 'session=request-secret',
          'X-Forwarded-For': '192.0.2.10',
        },
      });
      await assertFixedResponse(ready, 200, 'ready\n');

      const head = await request(baseUrl, '/readyz', { method: 'HEAD' });
      await assertFixedResponse(head, 200, '');

      for (const method of ['POST', 'OPTIONS']) {
        const rejected = await request(baseUrl, '/readyz', { method });
        await assertFixedResponse(rejected, 405, 'method not allowed\n');
      }

      for (const path of [
        '/readyz/anything',
        '/READYZ',
        '/READYZ/anything',
        '/readyz?probe=1',
      ]) {
        const rejected = await request(baseUrl, path);
        await assertFixedResponse(rejected, 404, 'not found\n');
        assert.equal((await request(baseUrl, path)).status === 200, false);
      }

      await writeFile(backendConfigPath, backendConfig('down'), 'utf8');
      docker(['exec', backend, 'nginx', '-s', 'reload']);
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      await assertFixedResponse(
        await request(baseUrl, '/readyz'),
        503,
        'unavailable\n',
      );

      await writeFile(backendConfigPath, backendConfig('no-content'), 'utf8');
      docker(['exec', backend, 'nginx', '-s', 'reload']);
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      await assertFixedResponse(
        await request(baseUrl, '/readyz'),
        503,
        'unavailable\n',
      );

      await writeFile(backendConfigPath, backendConfig('timeout'), 'utf8');
      docker(['exec', backend, 'nginx', '-s', 'reload']);
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      const timeoutStarted = Date.now();
      await assertFixedResponse(
        await request(baseUrl, '/readyz'),
        503,
        'unavailable\n',
      );
      assert.ok(
        Date.now() - timeoutStarted < 4_000,
        'Readiness timeout exceeded the configured short fail-closed window.',
      );

      docker(['stop', '--time', '1', backend]);
      await assertFixedResponse(
        await request(baseUrl, '/readyz'),
        503,
        'unavailable\n',
      );
    } finally {
      for (const container of [edge, backend, slow]) {
        docker(['rm', '-f', container], { allowFailure: true });
      }
      docker(['network', 'rm', backendNetwork], { allowFailure: true });
      docker(['network', 'rm', edgeNetwork], { allowFailure: true });
      await rm(fixture, { recursive: true, force: true });
    }
  },
);
