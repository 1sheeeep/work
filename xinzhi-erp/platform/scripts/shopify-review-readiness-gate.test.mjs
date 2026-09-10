import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  ShopifyReviewReadinessGateError,
  inspectShopifyReviewReadiness,
  runShopifyReviewReadinessGate,
} from "./shopify-review-readiness-gate.mjs";

const temporaryRoots = [];
const REVIEW_ROOT = "platform/docs/shopify-review";
const documentNames = [
  "README.md",
  "00-submission-product-boundary.md",
  "01-app-listing-copy.md",
  "02-reviewer-test-instructions.md",
  "03-access-and-protected-data.md",
  "04-assets-and-screencast.md",
  "05-submission-checklist.md",
  "06-screencast-script-and-subtitles.md",
  "07-partner-dashboard-entry-sheet.md",
  "08-material-status.md",
  "09-engineering-readiness-evidence.md",
  "10-level2-data-protection-evidence.md",
  "11-owner-input-and-production-evidence-pack.md",
  "12-existing-app-release-boundary.md",
  "16-parallel-review-preparation.md",
];
const frozenScopes = "read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns";
const frozenShopifyClientId = "6cef3dfc6b0d74e7c2709232f2938696";

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function png(width, height, marker = 0) {
  const data = Buffer.alloc(34);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = 8;
  data[25] = 6;
  data[33] = marker;
  return data;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xz-erp-shopify-review-gate-"));
  temporaryRoots.push(root);
  for (const name of documentNames) {
    write(root, `${REVIEW_ROOT}/${name}`, name === "05-submission-checklist.md" ? "- [x] complete\n" : "complete\n");
  }
  write(
    root,
    `${REVIEW_ROOT}/00-submission-product-boundary.md`,
    [
      "One public app with two complete business workspaces.",
      "Access requires an account provisioned and authorized by Xinzhi staff.",
      "Self-service registration is not available.",
      "Installing or authorizing the Shopify app does not grant system access.",
      "ERP and customer service share the existing ERP account.",
      "ERP and customer service are peer businesses.",
      "Shopify embedded experience is a release gate.",
      "Production: https://kf.xzkj.ai",
      "Review: https://kf-uat.xzkj.ai for xinzhi-app-lab.myshopify.com only.",
      "",
    ].join("\n"),
  );
  write(
    root,
    `${REVIEW_ROOT}/02-reviewer-test-instructions.md`,
    [
      "workbench.access",
      "conversations.claim",
      "conversations.reply",
      "conversations.transfer",
      "conversations.close",
      "tickets.view",
      "tickets.manage",
      "",
    ].join("\n"),
  );
  write(
    root,
    `${REVIEW_ROOT}/01-app-listing-copy.md`,
    [
      "**App name**", "Xinzhi ERP", "",
      "**App card subtitle**", "Organize Shopify orders in one ERP.", "",
      "**App introduction**", "Review products and import orders for fulfillment.", "",
      "**App details**", "Review products and import tenant-scoped orders for fulfillment without changing Shopify data.", "",
      "**Features**", "- Review current products.", "- Import orders for fulfillment.", "",
      "**Search terms**", "- order management", "- ERP", "",
      "**Pricing**", "Free.", "",
    ].join("\n"),
  );
  write(root, `${REVIEW_ROOT}/07-partner-dashboard-entry-sheet.md`, fs.readFileSync(path.join(root, REVIEW_ROOT, "02-reviewer-test-instructions.md"), "utf8"));
  write(root, `${REVIEW_ROOT}/06-screencast-script-and-subtitles.md`, `Untimed preparation only: ${frozenScopes}.\n`);
  write(root, `${REVIEW_ROOT}/assets/app-icon/xinzhi-erp-app-icon-1200.png`, png(1200, 1200));
  write(root, `${REVIEW_ROOT}/assets/feature-media/xinzhi-erp-feature-media-1600x900.png`, png(1600, 900));
  write(
    root,
    `${REVIEW_ROOT}/assets/subtitles/xinzhi-erp-review-en.srt`,
    `1\n00:00:00,000 --> 00:00:01,000\nReview ${frozenScopes.split(",").slice(0, 6).join(", ")}.\n\n2\n00:00:01,000 --> 00:00:02,000\nReview ${frozenScopes.split(",").slice(6).join(", ")}.\n`,
  );
  for (let index = 1; index <= 3; index += 1) {
    write(root, `${REVIEW_ROOT}/assets/final/review-${index}.png`, png(1600, 900, index));
  }
  write(root, "platform/customer-service/shopify.app.toml", [
    `client_id = "${frozenShopifyClientId}"`,
    `scopes = "${frozenScopes}"`,
    "",
  ].join("\n"));
  write(root, "platform/customer-service/shopify.app.toml.example", `scopes = "${frozenScopes}"\n`);
  write(root, "platform/customer-service/deploy/production.env.example", [
    `SHOPIFY_APP_SCOPES=${frozenScopes}`,
    `SHOPIFY_SCOPES=${frozenScopes}`,
    "",
  ].join("\n"));
  write(root, "platform/customer-service/.env.example", `SHOPIFY_SCOPES=${frozenScopes}\n`);
  write(root, "platform/frontend/src/pages/LoginPage.tsx", [
    "export async function LoginPage() {",
    "  const { login } = useAuth();",
    "  await login({ tenantCode, loginIdentifier, password });",
    '  return <form><input name="tenantCode"/><input name="loginIdentifier"/><input name="password"/></form>;',
    "}",
    "",
  ].join("\n"));
  write(root, "platform/customer-service/cmd/support-server/main.go", "verifier := platform.NewHTTPERPIdentityVerifier()\ntenantMux := platform.NewERPSharedIdentityMux()\n");
  write(root, "platform/customer-service/internal/connectors/shopify/installations/reviewer_guide.go", "ERP and customer service share the existing ERP account with separate business sessions and permissions.\n");
  return root;
}

function expectIssue(root, code) {
  assert.throws(
    () => runShopifyReviewReadinessGate(root),
    (error) => error instanceof ShopifyReviewReadinessGateError
      && error.issues.some((value) => value.code === code),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("complete fixed review package passes deterministically", () => {
  const root = fixture();
  const first = runShopifyReviewReadinessGate(root);
  const second = runShopifyReviewReadinessGate(root);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.summary, {
    documents: 14,
    placeholders: 0,
    unchecked: 0,
    screenshots: 3,
    subtitleCues: 2,
    subtitleDurationMilliseconds: 2000,
    listingFeatures: 2,
    listingSearchTerms: 2,
    scopeConfigs: 5,
    skipped: 0,
  });
});

test("all runtime and manifest scope fields match the frozen ten-scope boundary", () => {
  const root = fixture();
  write(
    root,
    "platform/customer-service/.env.example",
    `SHOPIFY_SCOPES=${frozenScopes.replace("read_all_orders,", "")}\n`,
  );
  expectIssue(root, "SCOPE_CONFIG_MISMATCH");
});

test("tracked release config identifies the approved Xinzhi ERP app", () => {
  const root = fixture();
  write(
    root,
    "platform/customer-service/shopify.app.toml",
    `client_id = "replace-with-shopify-client-id"\nscopes = "${frozenScopes}"\n`,
  );
  expectIssue(root, "APP_CLIENT_ID_MISMATCH");
});

test("required image dimensions are locked", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/assets/app-icon/xinzhi-erp-app-icon-1200.png`, png(1024, 1024));
  expectIssue(root, "PNG_DIMENSIONS");
});

test("unresolved owner input and unchecked requirements fail closed", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/README.md`, "contact={{CONTACT_EMAIL}}\n");
  write(root, `${REVIEW_ROOT}/05-submission-checklist.md`, "- [ ] production evidence\n");
  const result = inspectShopifyReviewReadiness(root);
  assert.equal(result.summary.placeholders, 1);
  assert.equal(result.summary.unchecked, 1);
  assert.ok(result.issues.some((value) => value.code === "UNRESOLVED_PLACEHOLDER"));
  assert.ok(result.issues.some((value) => value.code === "UNCHECKED_REQUIREMENT"));
});

test("generic placeholder notation in explanatory prose is not owner input", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/README.md`, "No literal `{{...}}` placeholder may remain.\n");
  assert.deepEqual(runShopifyReviewReadinessGate(root).issues, []);
});

test("overlapping subtitle cues fail closed", () => {
  const root = fixture();
  write(
    root,
    `${REVIEW_ROOT}/assets/subtitles/xinzhi-erp-review-en.srt`,
    "1\n00:00:00,000 --> 00:00:02,000\nFirst.\n\n2\n00:00:01,000 --> 00:00:03,000\nSecond.\n",
  );
  expectIssue(root, "SUBTITLE_SEQUENCE");
});

test("obsolete subtitles that omit submitted scopes fail closed", () => {
  const root = fixture();
  write(
    root,
    `${REVIEW_ROOT}/assets/subtitles/xinzhi-erp-review-en.srt`,
    "1\n00:00:00,000 --> 00:00:02,000\nReview read_products and read_orders.\n",
  );
  expectIssue(root, "SUBTITLE_SCOPE_COVERAGE");
});

test("a complete untimed narration cannot substitute for missing final subtitles", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/assets/subtitles/xinzhi-erp-review-en.srt`, "");
  expectIssue(root, "SUBTITLES_EMPTY");
  assert.ok(!inspectShopifyReviewReadiness(root).issues.some((issue) => issue.code === "NARRATION_SCOPE_COVERAGE"));
});

test("untimed narration covers the exact submitted scope identifiers", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/06-screencast-script-and-subtitles.md`, frozenScopes.replace("write_returns", "write_returns_future"));
  expectIssue(root, "NARRATION_SCOPE_COVERAGE");
});

test("scope name prefixes in final subtitles do not prove exact scope coverage", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/assets/subtitles/xinzhi-erp-review-en.srt`, `1\n00:00:00,000 --> 00:00:05,000\n${frozenScopes.replace("read_products", "read_products_extra")}\n`);
  expectIssue(root, "SUBTITLE_SCOPE_COVERAGE");
});

test("submission boundary must retain staff approval instead of self-service admission", () => {
  const root = fixture();
  const filename = path.join(root, REVIEW_ROOT, "00-submission-product-boundary.md");
  fs.writeFileSync(filename, fs.readFileSync(filename, "utf8").replace(
    "Access requires an account provisioned and authorized by Xinzhi staff.",
    "Create an account automatically after installation.",
  ));
  expectIssue(root, "PRODUCT_BOUNDARY_INCOMPLETE");
});

test("Partner copy must retain native customer-service permissions", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/07-partner-dashboard-entry-sheet.md`, "customer_service.read\ncustomer_service.ticket.manage\n");
  expectIssue(root, "CUSTOMER_SERVICE_REVIEW_COVERAGE");
});

test("native ERP credential copy can name its enterprise code without requiring One", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "07-partner-dashboard-entry-sheet.md"), "\nCompany ID: xinzhi\n");
  assert.deepEqual(runShopifyReviewReadinessGate(root).issues, []);
});

test("submission copy cannot promote a status-only home into the final journey", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "06-screencast-script-and-subtitles.md"), "\nShopify App Home is limited to installation, connection status and read-only review previews.\n");
  expectIssue(root, "EMBEDDED_REVIEW_COPY_CONFLICT");
});

test("owner handoff permits the approved ERP shared-account entry without One", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/11-owner-input-and-production-evidence-pack.md`, "审核员通过 ERP 一次性入口进入客服工作台；不涉及 One。\n");
  assert.doesNotThrow(() => runShopifyReviewReadinessGate(root));
});

test("final screenshots are mandatory and must be 1600x900 PNGs", () => {
  const root = fixture();
  fs.rmSync(path.join(root, REVIEW_ROOT, "assets/final"), { recursive: true, force: true });
  expectIssue(root, "FINAL_SCREENSHOTS_MISSING");

  fs.mkdirSync(path.join(root, REVIEW_ROOT, "assets/final"), { recursive: true });
  write(root, `${REVIEW_ROOT}/assets/final/review-1.png`, png(1200, 900));
  expectIssue(root, "FINAL_SCREENSHOT_COUNT");
  expectIssue(root, "PNG_DIMENSIONS");
});

test("final screenshots must be distinct files", () => {
  const root = fixture();
  const first = path.join(root, REVIEW_ROOT, "assets/final/review-1.png");
  const second = path.join(root, REVIEW_ROOT, "assets/final/review-2.png");
  fs.copyFileSync(first, second);
  expectIssue(root, "FINAL_SCREENSHOT_DUPLICATE");
});

test("missing fixed review documents fail closed", () => {
  const root = fixture();
  fs.rmSync(path.join(root, REVIEW_ROOT, "12-existing-app-release-boundary.md"));
  expectIssue(root, "REVIEW_FILE_MISSING");
});

test("submission boundary keeps one app, two complete workspaces, and review-only UAT routing", () => {
  const root = fixture();
  write(
    root,
    `${REVIEW_ROOT}/00-submission-product-boundary.md`,
    "One public app with only an ERP workspace. Production: https://kf.xzkj.ai\n",
  );
  expectIssue(root, "PRODUCT_BOUNDARY_INCOMPLETE");
});

test("reviewer instructions cover the complete customer-service permission lifecycle", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/02-reviewer-test-instructions.md`, "customer_service.read\ncustomer_service.conversation.reply\n");
  expectIssue(root, "CUSTOMER_SERVICE_REVIEW_COVERAGE");
});

test("public submission materials do not require a portal or obsolete identity bridge", () => {
  const root = fixture();
  write(
    root,
    `${REVIEW_ROOT}/06-screencast-script-and-subtitles.md`,
    "The reviewer must first open One workspace before opening customer service.\n",
  );
  expectIssue(root, "UNRELATED_IDENTITY_PRODUCT_REFERENCE");
});

test("the Shopify review path keeps direct ERP login independent", () => {
  const root = fixture();
  write(
    root,
    "platform/frontend/src/pages/LoginPage.tsx",
    "function LoginPage() { startOneOidcLogin('/'); return null }\n",
  );
  expectIssue(root, "ERP_REVIEW_LOGIN_NOT_INDEPENDENT");
});

test("retired One identity cannot return in current reviewer instructions", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "02-reviewer-test-instructions.md"), "The Xinzhi account is verified through One identity from each business URL.\n");
  expectIssue(root, "UNRELATED_IDENTITY_PRODUCT_REFERENCE");
});

test("native login copy can explicitly exclude One and retain one public app", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "02-reviewer-test-instructions.md"), "One public app; One is not part of the submitted product path. 不涉及 One。Use the same ERP account with separate business sessions.\n");
  assert.deepEqual(runShopifyReviewReadinessGate(root).issues, []);
});

test("review checklist rejects the stale prepared-native-accounts wording", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "05-submission-checklist.md"), "Every feature works with the two prepared native reviewer accounts.\n");
  expectIssue(root, "SEPARATE_CUSTOMER_SERVICE_CREDENTIALS");
});

test("owner evidence pack cannot restore the retired identity portal", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "11-owner-input-and-production-evidence-pack.md"), "ERP 与客服也各有独立网址，通过新知身份进入。\n");
  expectIssue(root, "UNRELATED_IDENTITY_PRODUCT_REFERENCE");
});

test("review checklist rejects separate reviewer credential sets", () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, REVIEW_ROOT, "05-submission-checklist.md"), "Both reviewer credential sets are supplied only in the restricted review field.\n");
  expectIssue(root, "SEPARATE_CUSTOMER_SERVICE_CREDENTIALS");
});

test("retired second customer-service credentials fail across current review narratives", () => {
  for (const [relative, staleCopy] of [
    [`${REVIEW_ROOT}/04-assets-and-screencast.md`, "Use each workspace's independently verified native account."],
    [`${REVIEW_ROOT}/07-partner-dashboard-entry-sheet.md`, "Passwords are provided separately in the restricted field."],
    [`${REVIEW_ROOT}/16-parallel-review-preparation.md`, "客服原生账号独立管理。"],
    ["platform/customer-service/internal/connectors/shopify/installations/reviewer_guide.go", "客服坐席仍独立登录。"],
  ]) {
    const root = fixture();
    fs.appendFileSync(path.join(root, relative), `\n${staleCopy}\n`);
    expectIssue(root, "SEPARATE_CUSTOMER_SERVICE_CREDENTIALS");
  }
});

test("public guide and current checklist reject stale shared identity steps", () => {
  for (const relative of [
    "platform/customer-service/internal/connectors/shopify/installations/reviewer_guide.go",
    `${REVIEW_ROOT}/05-submission-checklist.md`,
  ]) {
    const root = fixture();
    write(root, relative, "Choose Sign in with Xinzhi account and complete shared-identity sign-in.\n");
    expectIssue(root, "UNRELATED_IDENTITY_PRODUCT_REFERENCE");
  }
});

test("native ERP login cannot be replaced with a credential-less shell", () => {
  const root = fixture();
  write(root, "platform/frontend/src/pages/LoginPage.tsx", "export function LoginPage() { return <div>ERP</div> }\n");
  expectIssue(root, "ERP_REVIEW_LOGIN_NOT_INDEPENDENT");
});

test("customer-service shared ERP mux cannot be missing or fall back to One or native passwords", () => {
  const root = fixture();
  const relative = "platform/customer-service/cmd/support-server/main.go";
  write(root, relative, "tenantMux := platform.NewOneTenantMux()\n");
  expectIssue(root, "CUSTOMER_SERVICE_REVIEW_LOGIN_NOT_SHARED");
  write(root, relative, "platform.NewNativeTenantMux()\nif os.Getenv(\"XZDESK_ONE_ISSUER\") != \"\" { platform.NewOneTenantMux() }\n");
  expectIssue(root, "CUSTOMER_SERVICE_REVIEW_LOGIN_NOT_SHARED");
  fs.rmSync(path.join(root, relative));
  expectIssue(root, "CUSTOMER_SERVICE_MAIN_MISSING");
});

test("protected-data copy cannot restore the obsolete single-conversation exclusion", () => {
  const root = fixture();
  write(root, `${REVIEW_ROOT}/03-access-and-protected-data.md`, "Access is limited for the single storefront conversation.\n");
  expectIssue(root, "CUSTOMER_SERVICE_REVIEW_NARROWED");
});

test("listing character and search-term limits fail closed", () => {
  const root = fixture();
  const listing = path.join(root, REVIEW_ROOT, "01-app-listing-copy.md");
  let content = fs.readFileSync(listing, "utf8");
  content = content.replace("Review products and import orders for fulfillment.", "I".repeat(101));
  content = content.replace("- Review current products.", `- ${"F".repeat(81)}`);
  content = content.replace("- ERP\n\n**Pricing**", "- ERP\n- products\n- fulfillment\n- shipping\n- sync\n\n**Pricing**");
  fs.writeFileSync(listing, content, "utf8");
  const result = inspectShopifyReviewReadiness(root);
  assert.ok(result.issues.some((value) => value.code === "LISTING_INTRODUCTION_LENGTH"));
  assert.ok(result.issues.some((value) => value.code === "LISTING_FEATURE_LENGTH"));
  assert.ok(result.issues.some((value) => value.code === "LISTING_SEARCH_TERM_COUNT"));
});
