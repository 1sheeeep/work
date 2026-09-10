import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const customerServiceRoot = path.resolve(toolsDir, "..");
const repositoryRoot = path.resolve(customerServiceRoot, "..", "..");
const erpOrigin = "http://127.0.0.1:18888";
const serviceToken = "synthetic-smoke-workload-token";
const tenantId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const tenantCode = "synthetic";
const password = "synthetic-password-never-persist";
const missingTenantId = "10000000-0000-4000-8000-000000000002";
const disabledUserId = "20000000-0000-4000-8000-000000000002";

test("ERP local files declare the imported service origin without an embed bridge", () => {
  const customerProductionEnv = readFileSync(
    path.join(customerServiceRoot, "frontend", ".env.production"), "utf8",
  );
  const erpDevelopmentEnv = readFileSync(
    path.join(repositoryRoot, "platform", "frontend", ".env.development"), "utf8",
  );
  const localStart = readFileSync(path.join(toolsDir, "start-erp-local.ps1"), "utf8");
  const customerServiceExampleEnv = readFileSync(
    path.join(customerServiceRoot, ".env.example"), "utf8",
  );
  assert.match(customerProductionEnv, /^VITE_XZDESK_BACKEND=\/$/m);
  assert.match(erpDevelopmentEnv, /^VITE_CUSTOMER_SERVICE_WORKBENCH_URL=http:\/\/127\.0\.0\.1:8787\/$/m);
  for (const declaration of [
    '$env:XZDESK_ALLOWED_ORIGINS = "http://127.0.0.1:18888"',
    '$env:XZDESK_ERP_IAM_BASE_URL = "http://127.0.0.1:8080"',
    '$env:XZDESK_PUBLIC_ORIGIN = "http://127.0.0.1:8787"',
    '$env:XZDESK_LOCAL_DEMO = "1"',
    '$env:SUPPORT_PLATFORM_ADDR = "127.0.0.1:8787"',
  ]) {
    assert.ok(localStart.includes(declaration), `missing local declaration: ${declaration}`);
  }
  assert.ok(!localStart.includes("postMessage"));
  assert.ok(!localStart.includes("embed=erp"));
  assert.ok(!localStart.includes("VITE_ERP_PARENT_ORIGIN"));
  assert.ok(!customerServiceExampleEnv.includes("VITE_ERP_PARENT_ORIGIN"));
  assert.ok(!customerServiceExampleEnv.includes("embed=erp"));
  assert.match(customerServiceExampleEnv, /^XZDESK_ERP_IAM_BASE_URL=http:\/\/127\.0\.0\.1:8080$/m);
  assert.match(customerServiceExampleEnv, /^XZDESK_PUBLIC_ORIGIN=http:\/\/127\.0\.0\.1:8787$/m);
});

test("local application origins and independent connector use the reviewed boundaries", () => {
  const erpStart = readFileSync(
    path.join(repositoryRoot, "platform", "scripts", "start-local-dev.ps1"), "utf8",
  );
  const backendStart = readFileSync(
    path.join(repositoryRoot, "platform", "scripts", "run-local-backend-dev.ps1"), "utf8",
  );
  const connectorStart = readFileSync(
    path.join(toolsDir, "start-shopify-connector-dev.ps1"), "utf8",
  );
  for (const source of [erpStart, backendStart]) {
    assert.match(source, /ERP_FIRST_PARTY_ONE_ORIGIN[^\r\n]*http:\/\/one\.localhost:18888/);
    assert.match(source, /ERP_FIRST_PARTY_ERP_ORIGIN[^\r\n]*http:\/\/erp\.localhost:18888/);
    assert.doesNotMatch(source, /(?:one|erp)\.localhost:5173/);
  }
  for (const declaration of [
    '$env:SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE = "connector-only"',
    '$env:SHOPIFY_CONNECTOR_ENCRYPTION_KEY_VERSION = "local-v1"',
    '$env:SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN = "https://local.invalid"',
  ]) {
    assert.ok(connectorStart.includes(declaration), `missing connector declaration: ${declaration}`);
  }
});

test("real customer-service process supports shared login with a synthetic ERP IAM (not Java or store acceptance)", {
  timeout: 120_000,
}, async (t) => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "xz-erp-cs-entry-"));
  let support;
  let iam;
  t.after(async () => {
    if (support && support.exitCode === null && support.signalCode === null) {
      const exited = new Promise((resolve) => support.once("exit", resolve));
      support.kill();
      await exited;
    }
    if (iam?.listening) {
      iam.closeAllConnections();
      await new Promise((resolve) => iam.close(resolve));
    }
    const parent = path.resolve(tmpdir());
    assert.equal(path.dirname(path.resolve(fixtureDir)), parent);
    assert.ok(path.basename(fixtureDir).startsWith("xz-erp-cs-entry-"));
    rmSync(fixtureDir, { recursive: true, force: true });
  });
  const executable = path.join(
    fixtureDir,
    process.platform === "win32" ? "support-server-smoke.exe" : "support-server-smoke",
  );
  const dataFile = path.join(fixtureDir, "customer-service.json");
  const tenantFile = (id) => path.join(`${dataFile}.tenants`, `${createHash("sha256").update(id).digest("hex")}.json`);
  const seat = (subject, status) => ({
    id: `erp:${tenantId}:${subject}`, email: `${subject}@example.test`,
    displayName: "Existing synthetic seat", role: "agent", status,
    passwordHash: "!erp-sso-password-disabled!", receptionLimit: 17,
    permissions: ["workbench.access"], permissionsCustomized: true,
    shopScope: "assigned", workbenchShopScope: "assigned", conversationScope: "assigned",
  });
  const activeSeat = seat(userId, "active");
  const disabledSeat = seat(disabledUserId, "disabled");
  mkdirSync(`${dataFile}.tenants`);
  writeFileSync(tenantFile(tenantId), JSON.stringify({
    erpTenantId: tenantId,
    users: { [activeSeat.id]: activeSeat, [disabledSeat.id]: disabledSeat },
  }));
  const build = spawnSync("go", ["build", "-o", executable, "./cmd/support-server"], {
    cwd: customerServiceRoot, encoding: "utf8", timeout: 60_000,
  });
  assert.equal(build.status, 0, `support-server build failed:\n${build.stdout}\n${build.stderr}`);

  let supportOrigin = "";
  let mode = "success";
  let requestCount = 0;
  let redemptionCount = 0;
  let validationCount = 0;
  let cleanupCount = 0;
  const nativeSessions = new Map();
  const grants = new Map();
  const iamErrors = [];
  const transientValues = [password, serviceToken];
  const customerSessionTokens = [];
  const createParent = () => {
    const token = `synthetic-erp-${randomBytes(12).toString("hex")}`;
    const identity = {
      tenantId: mode === "unprovisioned" ? missingTenantId : tenantId,
      tenantCode: mode === "wrong tenant" ? "other" : tenantCode,
      subjectId: mode === "disabled seat" ? disabledUserId : userId,
      displayName: "ERP profile must not overwrite the seat",
      email: "synthetic.agent@example.test",
      permissions: ["customer_service.read", "customer_service.conversation.reply"],
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const parent = { token, identity, revoked: false };
    nativeSessions.set(token, parent);
    transientValues.push(token);
    return parent;
  };
  const issueGrant = (parent) => {
    const proof = randomBytes(32).toString("base64url");
    grants.set(proof, { parent, consumed: false });
    transientValues.push(proof);
    return proof;
  };
  const json = (response, status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  // This IAM deliberately implements only the reviewed HTTP contract. The Go
  // executable, routing, tenant files, seat checks and sessions are all real.
  iam = createServer(async (request, response) => {
    requestCount += 1;
    try {
      const payload = JSON.parse(await readBody(request));
      if (request.url === "/api/v1/auth/login") {
        assert.equal(request.method, "POST");
        assert.equal(request.headers.authorization, undefined);
        assert.equal(request.headers["x-xz-erp-connector-token"], undefined);
        assert.equal(payload.tenantCode, tenantCode);
        const identifierKey = payload.email ? "email" : "username";
        assert.deepEqual(Object.keys(payload).sort(), [identifierKey, "password", "tenantCode"].sort());
        assert.equal(payload[identifierKey], identifierKey === "email" ? "synthetic.agent@example.test" : "synthetic-agent");
        const status = payload.password !== password ? 401 : { throttled: 429, unavailable: 503 }[mode];
        if (status) return json(response, status, { error: "synthetic-private-provider-details" });
        const parent = createParent();
        return json(response, 200, {
          tokenType: "Bearer", accessToken: parent.token, expiresAt: parent.identity.expiresAt,
          tenant: { id: parent.identity.tenantId, code: parent.identity.tenantCode },
          user: { id: parent.identity.subjectId },
        });
      }
      if (request.url === "/api/v1/customer-service/entry-grants" || request.url === "/api/v1/auth/session") {
        assert.equal(request.headers["x-xz-erp-connector-token"], undefined);
        const parent = nativeSessions.get(request.headers.authorization?.replace(/^Bearer /, ""));
        assert.ok(parent && !parent.revoked, "grant/cleanup requires its own ERP parent session");
        if (request.url === "/api/v1/auth/session") {
          assert.equal(request.method, "DELETE");
          parent.revoked = true;
          cleanupCount += 1;
          response.writeHead(204).end();
          return;
        }
        assert.equal(request.method, "POST");
        assert.deepEqual(payload, { targetOrigin: supportOrigin });
        if (mode === "missing CHAT") return json(response, 403, { error: "synthetic-private-provider-details" });
        return json(response, 200, {
          grant: issueGrant(parent), tenantId: parent.identity.tenantId, userId: parent.identity.subjectId,
          entryUrl: `${supportOrigin}/api/v1/auth/erp/entry`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      assert.equal(request.method, "POST");
      assert.equal(request.headers["x-xz-erp-connector-token"], serviceToken);
      assert.equal(request.headers.authorization, undefined);
      assert.ok([
        "/api/v1/internal/customer-service/entry-grants/redeem",
        "/api/v1/internal/customer-service/session/validate",
      ].includes(request.url), "unexpected IAM route");
      const record = grants.get(payload.grant);
      if (!record || record.parent.revoked) return json(response, 403, {});
      assert.deepEqual(payload, {
        grant: payload.grant, tenantId: record.parent.identity.tenantId,
        userId: record.parent.identity.subjectId, targetOrigin: supportOrigin,
      });
      if (request.url.endsWith("/redeem")) {
        if (record.consumed) return json(response, 403, {});
        record.consumed = true;
        redemptionCount += 1;
      } else {
        assert.ok(record.consumed, "session validation cannot consume an unused grant");
        validationCount += 1;
      }
      return json(response, 200, record.parent.identity);
    } catch (error) {
      iamErrors.push(error);
      json(response, 500, { error: "synthetic IAM assertion failed" });
    }
  });
  await listenOfflineIAM(iam);
  const iamAddress = iam.address();
  assert.ok(iamAddress && typeof iamAddress === "object");

  const supportPort = await reservePort();
  supportOrigin = `http://127.0.0.1:${supportPort}`;
  support = spawn(executable, ["-addr", `127.0.0.1:${supportPort}`], {
    cwd: customerServiceRoot,
    env: {
      ...runtimeEnvironment(),
      DATA_FILE: dataFile,
      XZDESK_STRICT_OFFLINE_LOCAL: "1",
      XZDESK_ALLOWED_ORIGINS: `${erpOrigin},${supportOrigin}`,
      XZDESK_ERP_IAM_BASE_URL: `http://127.0.0.1:${iamAddress.port}`,
      XZDESK_PUBLIC_ORIGIN: supportOrigin,
      ERP_XZ_ERP_APP_CONNECTOR_TOKEN: serviceToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let supportOutput = "";
  support.stdout.on("data", (chunk) => { supportOutput += chunk; });
  support.stderr.on("data", (chunk) => { supportOutput += chunk; });

  await waitForHTTP(`${supportOrigin}/healthz`, support, () => supportOutput);
  const formEntry = (grant, origin = erpOrigin) => fetch(`${supportOrigin}/api/v1/auth/erp/entry`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant, tenantId, userId }),
    redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  const passwordLogin = (overrides = {}, origin = supportOrigin) => fetch(`${supportOrigin}/api/v1/auth/erp/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ tenantCode, loginIdentifier: "synthetic.agent@example.test", password, ...overrides }),
    redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  const me = (token, requestedTenant = tenantId) => fetch(`${supportOrigin}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`, "X-XZ-Tenant-ID": requestedTenant,
    },
    signal: AbortSignal.timeout(5_000),
  });
  const noTransientValues = (text) => {
    for (const value of [...transientValues, "synthetic-private-provider-details"]) {
      assert.ok(!text.includes(value), "ERP credential, proof or provider detail leaked");
    }
  };
  const loginSuccessfully = async (overrides) => {
    const response = await passwordLogin(overrides);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("location"), null);
    noTransientValues(body);
    const auth = JSON.parse(body);
    assert.ok(auth.token);
    assert.equal(auth.tenantId, tenantId);
    assert.equal(auth.integrationMode, "ERP_PASSWORDLESS");
    customerSessionTokens.push(auth.token);
    return auth;
  };

  await t.test("bootstrap offers ERP login without local-account registration", async () => {
    const response = await fetch(`${supportOrigin}/api/v1/bootstrap/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.authMode, "erp_sso");
    assert.equal(status.needsBootstrap, false);
  });
  await t.test("untrusted origins cannot reach IAM through either login entry", async () => {
    const before = requestCount;
    const denied = await formEntry("a".repeat(43), "https://wrong.example.test");
    assert.equal(denied.status, 403);
    await denied.text();
    const login = await passwordLogin({}, "https://wrong.example.test");
    assert.equal(login.status, 403);
    await login.text();
    assert.equal(requestCount, before);
  });
  await t.test("ERP form entry uses an existing seat and a single-use proof", async () => {
    const grant = issueGrant(createParent());
    const entry = await formEntry(grant);
    const html = await entry.text();
    assert.equal(entry.status, 200, html);
    assert.equal(entry.headers.get("cache-control"), "no-store");
    noTransientValues(html);
    const auth = extractBootstrapAuth(html);
    assert.ok(auth.token);
    customerSessionTokens.push(auth.token);
    assert.equal(auth.tenantId, tenantId);
    assert.equal(redemptionCount, 1);
    const profile = await me(auth.token);
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).id, activeSeat.id);
    assert.equal(validationCount, 1);
    const replay = await formEntry(grant);
    assert.equal(replay.status, 403);
    await replay.text();
  });
  await t.test("direct password login keeps the seat, rejects ERP tokens and tenant substitution, then logs out", async () => {
    const auth = await loginSuccessfully();
    const parent = [...nativeSessions.values()].at(-1);
    const profile = await me(auth.token);
    assert.equal(profile.status, 200);
    const user = await profile.json();
    assert.equal(user.id, activeSeat.id);
    assert.equal(user.displayName, activeSeat.displayName);
    assert.equal(user.receptionLimit, 17);
    assert.equal(user.role, "agent");
    assert.deepEqual(user.permissions, activeSeat.permissions);
    for (const response of [await me(parent.token), await me(auth.token, missingTenantId)]) {
      assert.equal(response.status, 401);
      noTransientValues(await response.text());
    }
    const logout = await fetch(`${supportOrigin}/api/v1/auth/logout`, {
      method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "X-XZ-Tenant-ID": tenantId, Origin: supportOrigin },
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { ok: true });
    const after = await me(auth.token);
    assert.equal(after.status, 401);
    await after.text();
    assert.equal(parent.revoked, false, "CS logout is not ERP global logout");
  });
  await t.test("the same native username contract also signs in", async () => {
    await loginSuccessfully({ loginIdentifier: "synthetic-agent" });
  });
  for (const [scenario, expectedStatus, expectedCode, expectedCleanup] of [
    ["wrong password", 401, "INVALID_CREDENTIALS", 0],
    ["throttled", 429, "LOGIN_RATE_LIMITED", 0],
    ["unavailable", 503, "ERP_LOGIN_UNAVAILABLE", 0],
    ["missing CHAT", 403, "CUSTOMER_SERVICE_ACCESS_DENIED", 1],
    ["wrong tenant", 503, "ERP_LOGIN_UNAVAILABLE", 1],
    ["disabled seat", 403, "CUSTOMER_SERVICE_ACCESS_DENIED", 1],
    ["unprovisioned", 403, "CUSTOMER_SERVICE_ACCESS_DENIED", 1],
  ]) {
    await t.test(`${scenario}: safe error, no session and correct failed-login cleanup`, async () => {
      mode = scenario;
      const before = cleanupCount;
      const sessionCount = () => Object.keys(JSON.parse(readFileSync(tenantFile(tenantId), "utf8")).sessions ?? {}).length;
      const sessionsBefore = sessionCount();
      const response = await passwordLogin(scenario === "wrong password" ? { password: "synthetic-wrong-password" } : {});
      const body = await response.text();
      assert.equal(response.status, expectedStatus, body);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("location"), null);
      noTransientValues(body);
      const result = JSON.parse(body);
      assert.equal(result.code, expectedCode);
      assert.equal(result.token, undefined);
      assert.equal(cleanupCount - before, expectedCleanup);
      assert.equal(sessionCount(), sessionsBefore, "failed login persisted a CS session");
      assert.equal(existsSync(tenantFile(missingTenantId)), false, "login created an unprovisioned enterprise");
      mode = "success";
    });
  }
  await t.test("revoking the corresponding ERP parent rejects an existing CS session after the validation cache", async () => {
    const auth = await loginSuccessfully();
    const parent = [...nativeSessions.values()].at(-1);
    const profile = await me(auth.token);
    assert.equal(profile.status, 200);
    await profile.text();
    const checked = validationCount;
    parent.revoked = true;
    const deadline = Date.now() + 7_000;
    while (true) {
      const response = await me(auth.token);
      await response.text();
      if (response.status === 401) break;
      assert.equal(response.status, 200);
      assert.ok(Date.now() < deadline, "revoked ERP parent remained usable beyond the cache window");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(validationCount, checked, "a revoked parent cannot return another valid identity");
  });
  await t.test("synthetic seat settings and disabled status survive login; passwords/proofs never reach disk or logs", () => {
    const snapshotText = readFileSync(tenantFile(tenantId), "utf8");
    noTransientValues(snapshotText);
    noTransientValues(supportOutput);
    for (const token of customerSessionTokens) {
      assert.ok(!snapshotText.includes(token), "CS session token was stored unhashed");
      assert.ok(!supportOutput.includes(token), "CS session token reached logs");
    }
    assert.match(supportOutput, /strict offline local runtime: external provider background work is disabled/);
    const snapshot = JSON.parse(snapshotText);
    for (const original of [activeSeat, disabledSeat]) {
      const stored = snapshot.users[original.id];
      for (const key of ["displayName", "role", "status", "passwordHash", "receptionLimit", "shopScope"]) {
        assert.equal(stored[key], original[key], `seat setting changed: ${key}`);
      }
    }
    assert.deepEqual(Object.keys(snapshot.users).sort(), [activeSeat.id, disabledSeat.id].sort());
    assert.deepEqual(iamErrors, []);
  });
});

function extractBootstrapAuth(html) {
  const prefix = "JSON.stringify(";
  const suffix = "));location.replace('/')";
  const start = html.indexOf(prefix);
  const end = html.indexOf(suffix, start + prefix.length);
  assert.ok(start >= 0 && end > start, "entry response omitted the customer-service session bootstrap");
  return JSON.parse(html.slice(start + prefix.length, end));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function listenRandom(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function runtimeEnvironment() {
  // No database URL, provider credential or proxy configuration is inherited.
  const allowed = new Set(["path", "systemroot", "windir", "temp", "tmp", "tmpdir"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}

async function listenOfflineIAM(server) {
  // The existing strict-offline transport allows only these loopback ports.
  // Bind an unused one; never contact or stop a service that already owns it.
  for (const port of [8790, 8080, 8787, 18888, 5173]) {
    try {
      await new Promise((resolve, reject) => {
        const failed = (error) => { server.off("listening", ready); reject(error); };
        const ready = () => { server.off("error", failed); resolve(); };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(port, "127.0.0.1");
      });
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free strict-offline IAM fixture port; existing local services were left untouched.");
}

async function reservePort() {
  const server = createServer();
  await listenRandom(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForHTTP(target, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`support-server exited before readiness (${child.exitCode}):\n${output()}`);
    }
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // The loopback listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`support-server did not become ready:\n${output()}`);
}
