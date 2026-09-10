import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, "..");
const erpRoot = path.resolve(root, "..");

function source(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("customer-service UAT is isolated from the live kf runtime and data", () => {
  const compose = source("deploy/erp-uat/compose.uat.yaml");
  const ingress = source("deploy/erp-uat/ingress.caddy");
  const deploy = source("deploy/erp-uat/deploy-uat.sh");
  const builder = source("tools/build-erp-uat-release.ps1");

  assert.match(compose, /^name: xz-erp-customer-service-uat$/m);
  assert.match(compose, /customer_service_uat_postgres_data/);
  assert.match(compose, /customer_service_uat_uploads/);
  assert.match(compose, /XZDESK_DATABASE_SCHEMA: customer_service/);
  assert.match(compose, /customer_service_runtime:\$\{XZDESK_UAT_RUNTIME_DB_PASSWORD\}/);
  assert.match(compose, /customer_service_migrator:\$\{XZDESK_UAT_MIGRATOR_DB_PASSWORD\}/);
  assert.match(compose, /XZDESK_UAT_PUBLIC_ORIGIN/);
  assert.match(compose, /XZDESK_ALLOWED_ORIGINS: \$\{XZDESK_UAT_ERP_ORIGIN:\?[^\n]+,\$\{XZDESK_UAT_PUBLIC_ORIGIN:\?/);
  assert.match(compose, /XZDESK_DEPLOY_COLOR: uat-disabled/);
  assert.match(compose, /XZDESK_ACTIVE_COLOR_FILE: \/var\/run\/xzdesk-background-never-active/);
  assert.doesNotMatch(compose, /\/opt\/xzdesk(?:\/|$)/);
  assert.doesNotMatch(compose, /postgres-data:/);

  assert.equal(ingress.trim(), [
    "kf-uat.xzkj.ai {",
    "\tencode zstd gzip",
    "\treverse_proxy erp-customer-service-uat-web:8080",
    "}",
  ].join("\n"));
  assert.doesNotMatch(ingress, /(^|\s)kf\.xzkj\.ai(\s|\{|$)/m);

  assert.match(deploy, /XZDESK_UAT_ROOT:-\/opt\/xz-erp-customer-service-uat/);
  assert.match(deploy, /ERP_STAGING_ENV_FILE:-\/opt\/xz-erp-test\/staging\.env/);
  assert.match(deploy, /SHOPIFY_REVIEW_ENV_FILE:-\/opt\/xinzhi-erp\/shopify\/shopify\.env/);
  assert.match(deploy, /read_env "\$erp_env_file" ERP_XZ_ERP_APP_CONNECTOR_TOKEN/);
  assert.match(deploy, /read_env "\$shopify_env_file" SHOPIFY_APP_API_SECRET/);
  assert.match(deploy, /read_env "\$shopify_env_file" SHOPIFY_PUBLIC_LEGAL_NAME/);
  assert.match(deploy, /read_env "\$shopify_env_file" SHOPIFY_PUBLIC_SUPPORT_EMAIL/);
  assert.match(deploy, /read_env "\$shopify_env_file" SHOPIFY_PUBLIC_EFFECTIVE_DATE/);
  assert.match(compose, /SHOPIFY_APP_API_SECRET: \$\{XZDESK_UAT_SHOPIFY_APP_API_SECRET:\?/);
  assert.match(compose, /XZ_ERP_LEGAL_NAME: \$\{XZDESK_UAT_XZ_ERP_LEGAL_NAME:\?/);
  assert.match(compose, /XZ_ERP_SUPPORT_EMAIL: \$\{XZDESK_UAT_XZ_ERP_SUPPORT_EMAIL:\?/);
  assert.match(compose, /XZ_ERP_PRIVACY_EFFECTIVE_DATE: \$\{XZDESK_UAT_XZ_ERP_PRIVACY_EFFECTIVE_DATE:\?/);
  assert.match(deploy, /XZDESK_UAT_PUBLIC_ORIGIN=https:\/\/kf-uat\.xzkj\.ai/);
  assert.doesNotMatch(deploy, /\/opt\/xzdesk(?:\/|$)/);
  assert.match(builder, /WriteAllText\([\s\S]+\$checksumLines -join "`n"/);
});

test("ERP staging release binds both browser and backend to the same UAT origin", () => {
  const dockerfile = readFileSync(path.join(erpRoot, "frontend", "Dockerfile"), "utf8");
  const builder = readFileSync(path.join(erpRoot, "tools", "build-staging-release.ps1"), "utf8");
  const compose = readFileSync(path.join(erpRoot, "infra", "staging", "compose.staging.yaml"), "utf8");
  const deploy = readFileSync(path.join(erpRoot, "infra", "staging", "deploy-staging.sh"), "utf8");

  assert.match(dockerfile, /^ARG VITE_CUSTOMER_SERVICE_WORKBENCH_URL$/m);
  assert.match(builder, /CustomerServiceWorkbenchUrl = "https:\/\/kf-uat\.xzkj\.ai"/);
  assert.match(builder, /VITE_CUSTOMER_SERVICE_WORKBENCH_URL=\$customerServiceOrigin/);
  assert.match(builder, /ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN=\$customerServiceOrigin/);
  assert.match(compose, /ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN: \$\{ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN:\?/);
  assert.match(deploy, /ERP_XZ_ERP_APP_CONNECTOR_TOKEN/);
  assert.match(deploy, /ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN/);
  assert.match(builder, /WriteAllText\([\s\S]+\$checksumLines -join "`n"/);
});

test("the shared production edge preserves ERP connector and customer-service UAT routes", () => {
  const template = source("deploy/caddy/Caddyfile.template");
  const productionCompose = source("deploy/compose.production.yml");
  const reviewConnectorCompose = readFileSync(path.join(erpRoot, "infra", "review", "compose.shopify.yaml"), "utf8");
  const originRoutingGate = readFileSync(
    path.join(erpRoot, "infra", "review", "verify-customer-service-origin-routing.sh"),
    "utf8",
  );

  assert.match(template, /^erp\.xzkj\.ai \{$/m);
  assert.match(
    template,
    /@shopifyReviewIdentityBoundary path \/platform-admin \/platform-admin\/\* \/auth\/one\/\* \/api\/v1\/one\/\* \/api\/v1\/platform-admin\/\* \/api\/v1\/auth\/one\/\* \/api\/v1\/auth\/application-entry-grants\/identity\/redeem/,
  );
  assert.match(template, /handle @shopifyReviewIdentityBoundary \{\s+respond 404\s+\}/);
  assert.match(template, /@shopifyOAuth path \/shopify\/oauth\/authorize \/shopify\/oauth\/callback/);
  assert.match(template, /@shopifyUninstall path \/webhooks\/shopify\/app\/uninstalled/);
  assert.match(template, /@shopifyXzErpPublic path \/shopify\/xz-erp \/shopify\/xz-erp\/\*/);
  assert.match(template, /reverse_proxy shopify-oauth:8790/);
  assert.match(template, /@shopifyXzErpPublic[\s\S]*reverse_proxy erp-customer-service-uat-web:8080/);
  assert.match(template, /^kf-uat\.xzkj\.ai \{$/m);
  assert.match(template, /reverse_proxy erp-customer-service-uat-web:8080/);
  assert.match(template, /reverse_proxy erp-test-web:8080/);

  assert.match(productionCompose, /web:[\s\S]*networks:\s*\n\s*- default\s*\n\s*- erp-public-ingress/);
  assert.match(productionCompose, /erp-public-ingress:\s*\n\s*external: true\s*\n\s*name: xz-erp-public-ingress/);

  assert.match(
    reviewConnectorCompose,
    /SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN: \$\{SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN:-https:\/\/kf\.xzkj\.ai\}/,
  );
  assert.match(
    reviewConnectorCompose,
    /SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES: \$\{SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES:-\}/,
  );
  assert.doesNotMatch(
    reviewConnectorCompose,
    /SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN: \$\{SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN:-https:\/\/kf-uat\.xzkj\.ai\}/,
  );
  assert.match(originRoutingGate, /production_origin = "https:\/\/kf\.xzkj\.ai"/);
  assert.match(originRoutingGate, /review_shop = "xinzhi-app-lab\.myshopify\.com"/);
  assert.match(originRoutingGate, /review_origin = "https:\/\/kf-uat\.xzkj\.ai"/);
  assert.match(originRoutingGate, /entry_count != 1/);
  assert.doesNotMatch(originRoutingGate, /cat "?\$env_file|set -x/);
});
