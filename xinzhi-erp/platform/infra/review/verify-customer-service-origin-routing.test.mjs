import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const reviewDir = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(reviewDir, "verify-customer-service-origin-routing.sh");
const temporaryRoots = [];

test.after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function bashPath(filePath) {
  if (process.platform !== "win32") {
    return filePath;
  }
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(filePath);
  if (!match) {
    return filePath.replaceAll("\\", "/");
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

function runGate(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xz-erp-origin-gate-"));
  temporaryRoots.push(root);
  const envFile = path.join(root, "shopify.env");
  fs.writeFileSync(envFile, contents, "utf8");
  return spawnSync("bash", [bashPath(gate), bashPath(envFile)], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("accepts the production default and the single prepared-review-shop override", () => {
  const result = runGate([
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN=https://kf.xzkj.ai",
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai",
    "",
  ].join("\n"));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^PASS:/);
});

test("accepts the Compose production default when the default key is absent", () => {
  const result = runGate(
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai\n",
  );

  assert.equal(result.status, 0, result.stderr);
});

test("rejects a shared default that points every installation to UAT", () => {
  const result = runGate([
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN=https://kf-uat.xzkj.ai",
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai",
    "SHOPIFY_APP_API_SECRET=must-not-leak",
    "",
  ].join("\n"));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^FAIL:/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /must-not-leak/);
});

test("rejects a missing, different, additional, or duplicated review override", () => {
  const unsafeFixtures = [
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN=https://kf.xzkj.ai\n",
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=other-shop.myshopify.com=https://kf-uat.xzkj.ai\n",
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai,other-shop.myshopify.com=https://kf.xzkj.ai\n",
    "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai\nSHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai\n",
  ];

  for (const fixture of unsafeFixtures) {
    const result = runGate(fixture);
    assert.notEqual(result.status, 0, fixture);
    assert.match(result.stderr, /^FAIL:/);
  }
});
