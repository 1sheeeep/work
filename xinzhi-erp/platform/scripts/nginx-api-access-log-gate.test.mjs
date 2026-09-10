import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  NginxApiAccessLogGateError,
  runNginxApiAccessLogGate,
} from "./nginx-api-access-log-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const CONFIG_RELATIVE = "platform/frontend/nginx.conf";
const temporaryRoots = [];

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function fixture() {
  const root = temporaryDirectory("xz-erp-nginx-log-gate-");
  const destination = path.join(root, CONFIG_RELATIVE);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(REPOSITORY_ROOT, CONFIG_RELATIVE), destination);
  return root;
}

function edit(root, transform) {
  const target = path.join(root, CONFIG_RELATIVE);
  const original = fs.readFileSync(target, "utf8");
  const changed = transform(original);
  assert.notEqual(changed, original, "fixture edit must change nginx.conf");
  fs.writeFileSync(target, changed, "utf8");
}

function expectIssue(root, code) {
  assert.throws(
    () => runNginxApiAccessLogGate(root),
    (error) =>
      error instanceof NginxApiAccessLogGateError
      && error.issues.some((value) => value.code === code),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repository API access-log facts pass deterministically with zero skips", () => {
  const first = runNginxApiAccessLogGate(REPOSITORY_ROOT);
  const second = runNginxApiAccessLogGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.summary, {
    files: 1,
    logFormats: 1,
    allowedFields: 7,
    skipped: 0,
  });
});

test("every prohibited request, header, body, and upstream variable fails closed", async (t) => {
  const forbiddenVariables = [
    "$request",
    "$args",
    "$query_string",
    "$http_referer",
    "$http_user_agent",
    "$http_cookie",
    "$http_authorization",
    "$http_origin",
    "$http_forwarded",
    "$http_x_forwarded_for",
    "$http_x_forwarded_host",
    "$arg_token",
    "$cookie_session",
    "$request_body",
    "$request_body_file",
    "$upstream_addr",
    "$upstream_http_set_cookie",
    "$sent_http_authorization",
    "$remote_user",
    "$request_filename",
  ];

  for (const forbidden of forbiddenVariables) {
    await t.test(forbidden, () => {
      const root = fixture();
      edit(
        root,
        (content) => content.replace(
          "server {",
          `log_format forbidden escape=json '${forbidden}';\n\nserver {`,
        ),
      );
      expectIssue(root, "DANGEROUS_LOG_VARIABLE");
    });
  }
});

test("an unapproved API log field fails even when it is not a known secret", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace(
      `$request_time}'`,
      `$request_time,"connection":"$connection"}'`,
    ),
  );
  expectIssue(root, "API_LOG_VARIABLE_SET_CHANGED");
});

test("the server default cannot fall back to combined logging or disable logging", async (t) => {
  for (const replacement of [
    "access_log /var/log/nginx/access.log combined;",
    "access_log off;",
  ]) {
    await t.test(replacement, () => {
      const root = fixture();
      edit(
        root,
        (content) => content.replace(
          "access_log /var/log/nginx/access.log api_access;",
          replacement,
        ),
      );
      expectIssue(root, "SERVER_LOG_BINDING_CHANGED");
    });
  }
});

test("an enabled location cannot override the server default with unsafe logging", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace(
      "location / {",
      "location / {\n        access_log /var/log/nginx/access.log combined;",
    ),
  );
  expectIssue(root, "UNSAFE_LOG_BINDING");
});

test("the API location cannot override the server-wide safe default", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace(
      "location ^~ /api/ {",
      "location ^~ /api/ {\n        access_log off;",
    ),
  );
  expectIssue(root, "API_LOG_OVERRIDE");
});

test("actuator probes cannot disable or bypass the redacted access log", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace(
      "location ~* ^/actuator(?:/|$) {",
      "location ~* ^/actuator(?:/|$) {\n        access_log off;",
    ),
  );
  expectIssue(root, "ACTUATOR_LOG_BOUNDARY_CHANGED");
});

test("a second API location cannot bypass the dedicated logging policy", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace(
      "server {",
      "server {\n    location = /api/v1/bypass { return 200; }",
    ),
  );
  expectIssue(root, "API_LOCATION_COUNT");
});

test("the exact API prefix location cannot be narrowed", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace("location ^~ /api/ {", "location ^~ /api/v1/ {"),
  );
  expectIssue(root, "API_LOCATION_CHANGED");
});

test("the API prefix cannot lose regex precedence", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace("location ^~ /api/ {", "location /api/ {"),
  );
  expectIssue(root, "API_LOCATION_CHANGED");
});

test("health and readiness logging cannot be silently enabled", () => {
  const root = fixture();
  edit(
    root,
    (content) => content.replace(
      /location = \/healthz \{\r?\n\s*access_log off;/,
      "location = /healthz {",
    ),
  );
  expectIssue(root, "PROBE_LOGGING_CHANGED");
});

test("a configuration reached through a symbolic directory is rejected", () => {
  const root = fixture();
  const outside = temporaryDirectory("xz-erp-nginx-log-outside-");
  fs.copyFileSync(
    path.join(root, CONFIG_RELATIVE),
    path.join(outside, "nginx.conf"),
  );
  const frontend = path.join(root, "platform/frontend");
  fs.rmSync(frontend, { recursive: true, force: true });
  fs.symlinkSync(outside, frontend, "junction");
  expectIssue(root, "CONFIG_ALIAS_REJECTED");
});

test("a symbolic repository-root alias is rejected", () => {
  const root = fixture();
  const aliasParent = temporaryDirectory("xz-erp-nginx-log-root-alias-");
  const alias = path.join(aliasParent, "repository");
  fs.symlinkSync(root, alias, "junction");
  expectIssue(alias, "REPOSITORY_ROOT_ALIAS");
});

test("the executable is repository-locked and rejects external arguments without echo", () => {
  const canary = "https://external.invalid/path?token=credential-canary";
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPOSITORY_ROOT, "platform/scripts/nginx-api-access-log-gate.mjs"),
      "--config",
      canary,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(result.stderr, /external\.invalid|credential-canary/);
});

test("the offline checker does not read process environment input", () => {
  const source = fs.readFileSync(
    path.join(REPOSITORY_ROOT, "platform/scripts/nginx-api-access-log-gate.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /process\.env|Bun\.env|Deno\.env/);

  const result = spawnSync(
    process.execPath,
    [path.join(REPOSITORY_ROOT, "platform/scripts/nginx-api-access-log-gate.mjs")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ERP_NGINX_ACCESS_LOG_PATH:
          "https://external.invalid/path?password=credential-canary",
      },
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^PASS Nginx API access-log gate/m);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /external\.invalid|credential-canary/,
  );
});
