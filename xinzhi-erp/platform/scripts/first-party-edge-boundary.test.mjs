import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const caddyfile = readFileSync(
  new URL("../infra/review/Caddyfile", import.meta.url),
  "utf8",
);
const frontendRouter = readFileSync(
  new URL("../frontend/src/App.tsx", import.meta.url),
  "utf8",
);

test("Xinzhi One cannot expose the Shopify review or connector surface", () => {
  const oneStart = caddyfile.indexOf("one.xzkj.ai {");
  assert.notEqual(oneStart, -1);

  const oneBlock = caddyfile.slice(oneStart);
  assert.match(
    oneBlock,
    /@shopifyBoundary path \/shopify\/\* \/webhooks\/shopify\/\*/,
  );
  assert.match(oneBlock, /handle @shopifyBoundary \{\s+respond 404\s+\}/);
  assert.doesNotMatch(oneBlock, /reverse_proxy shopify-oauth/);
});

test("ERP cannot expose the One platform administration surface", () => {
  const erpStart = caddyfile.indexOf("erp.xzkj.ai {");
  const oneStart = caddyfile.indexOf("one.xzkj.ai {");
  assert.notEqual(erpStart, -1);
  assert.notEqual(oneStart, -1);
  const erpBlock = caddyfile.slice(erpStart, oneStart);
  assert.match(
    erpBlock,
    /@oneControlPlane path \/platform-admin \/platform-admin\/\* \/auth\/one\/\* \/api\/v1\/one\/\* \/api\/v1\/platform-admin\/\* \/api\/v1\/auth\/one\/\* \/api\/v1\/auth\/application-entry-grants\/identity\/redeem/,
  );
  assert.match(erpBlock, /handle @oneControlPlane \{\s+respond 404\s+\}/);
});

test("ERP does not register One control-plane routes", () => {
  assert.match(
    frontendRouter,
    /const oneControlPlaneRoutes = resolveProductSurface\(\) === "one"[\s\S]*?: \[\];/,
  );
  assert.match(
    frontendRouter,
    /applicationEntryRoute,\s*\.\.\.oneControlPlaneRoutes,/,
  );
  assert.match(
    frontendRouter,
    /oneControlPlaneRoutes[\s\S]*oneOidcCallbackRoute[\s\S]*platformLogoutRoute/,
  );
  assert.doesNotMatch(
    frontendRouter,
    /applicationEntryRoute,\s*(?:oneOidcCallbackRoute|platformLoginRoute),/,
  );
});

test("Xinzhi One cannot expose ERP business APIs", () => {
  const oneStart = caddyfile.indexOf("one.xzkj.ai {");
  assert.notEqual(oneStart, -1);
  const oneBlock = caddyfile.slice(oneStart);
  assert.match(oneBlock, /@erpBusinessApi \{/);
  assert.match(oneBlock, /path \/api\/v1\/\*/);
  assert.match(
    oneBlock,
    /not path \/api\/v1\/auth\/\* \/api\/v1\/one\/\* \/api\/v1\/platform-admin\/\* \/api\/v1\/system\/info/,
  );
  assert.match(oneBlock, /handle @erpBusinessApi \{\s+respond 404\s+\}/);
  assert.doesNotMatch(
    oneBlock,
    /not path[^\n]*\/api\/v1\/erp-operator\/\*/,
    "ERP operator APIs must remain inside the One business-API deny boundary",
  );
});
