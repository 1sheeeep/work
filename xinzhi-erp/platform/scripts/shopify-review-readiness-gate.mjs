import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const REVIEW_ROOT = "platform/docs/shopify-review";
const ICON = `${REVIEW_ROOT}/assets/app-icon/xinzhi-erp-app-icon-1200.png`;
const FEATURE_MEDIA = `${REVIEW_ROOT}/assets/feature-media/xinzhi-erp-feature-media-1600x900.png`;
const SUBTITLES = `${REVIEW_ROOT}/assets/subtitles/xinzhi-erp-review-en.srt`;
const FINAL_SCREENSHOTS = `${REVIEW_ROOT}/assets/final`;
const PRODUCT_BOUNDARY = `${REVIEW_ROOT}/00-submission-product-boundary.md`;
const REVIEWER_INSTRUCTIONS = `${REVIEW_ROOT}/02-reviewer-test-instructions.md`;
const PARTNER_ENTRY_SHEET = `${REVIEW_ROOT}/07-partner-dashboard-entry-sheet.md`;
const NARRATION_DRAFT = `${REVIEW_ROOT}/06-screencast-script-and-subtitles.md`;
const ERP_LOGIN_PAGE = "platform/frontend/src/pages/LoginPage.tsx";
const CUSTOMER_SERVICE_MAIN = "platform/customer-service/cmd/support-server/main.go";
const PUBLIC_REVIEWER_GUIDE = "platform/customer-service/internal/connectors/shopify/installations/reviewer_guide.go";
const CURRENT_PREPARATION_PLAN = `${REVIEW_ROOT}/16-parallel-review-preparation.md`;
const DOCUMENTS = [
  `${REVIEW_ROOT}/README.md`,
  PRODUCT_BOUNDARY,
  ...Array.from({ length: 12 }, (_, index) =>
    `${REVIEW_ROOT}/${String(index + 1).padStart(2, "0")}-${[
      "app-listing-copy",
      "reviewer-test-instructions",
      "access-and-protected-data",
      "assets-and-screencast",
      "submission-checklist",
      "screencast-script-and-subtitles",
      "partner-dashboard-entry-sheet",
      "material-status",
      "engineering-readiness-evidence",
      "level2-data-protection-evidence",
      "owner-input-and-production-evidence-pack",
      "existing-app-release-boundary",
    ][index]}.md`,
  ),
];
const CHECKLIST = `${REVIEW_ROOT}/05-submission-checklist.md`;
const LISTING = `${REVIEW_ROOT}/01-app-listing-copy.md`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FROZEN_SCOPE_VALUE = [
  "read_all_orders",
  "read_customers",
  "read_locations",
  "read_products",
  "read_shopify_payments_disputes",
  "write_inventory",
  "write_merchant_managed_fulfillment_orders",
  "write_order_edits",
  "write_orders",
  "write_returns",
].join(",");
const FROZEN_SHOPIFY_CLIENT_ID = "6cef3dfc6b0d74e7c2709232f2938696";
const REQUIRED_SUBTITLE_SCOPES = FROZEN_SCOPE_VALUE.split(",");
const REQUIRED_CUSTOMER_SERVICE_PERMISSIONS = [
  "workbench.access",
  "conversations.claim",
  "conversations.reply",
  "conversations.transfer",
  "conversations.close",
  "tickets.view",
  "tickets.manage",
];
const SCOPE_CONFIGS = [
  {
    file: "platform/customer-service/shopify.app.toml",
    field: "scopes",
    pattern: /^\s*scopes\s*=\s*"([^"]*)"\s*$/m,
  },
  {
    file: "platform/customer-service/shopify.app.toml.example",
    field: "scopes",
    pattern: /^\s*scopes\s*=\s*"([^"]*)"\s*$/m,
  },
  {
    file: "platform/customer-service/deploy/production.env.example",
    field: "SHOPIFY_APP_SCOPES",
    pattern: /^SHOPIFY_APP_SCOPES=([^\r\n]*)$/m,
  },
  {
    file: "platform/customer-service/deploy/production.env.example",
    field: "SHOPIFY_SCOPES",
    pattern: /^SHOPIFY_SCOPES=([^\r\n]*)$/m,
  },
  {
    file: "platform/customer-service/.env.example",
    field: "SHOPIFY_SCOPES",
    pattern: /^SHOPIFY_SCOPES=([^\r\n]*)$/m,
  },
];

export class ShopifyReviewReadinessGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "ShopifyReviewReadinessGateError";
    this.issues = issues;
  }
}

function issue(code, message, file) {
  return file ? { code, message, file } : { code, message };
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function validateRoot(repositoryRoot) {
  const resolved = path.resolve(repositoryRoot);
  if (!fs.existsSync(resolved)) {
    throw new ShopifyReviewReadinessGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync.native(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || real !== resolved) {
    throw new ShopifyReviewReadinessGateError([
      issue("REPOSITORY_ROOT_ALIAS", "repository root must be canonical and non-symbolic"),
    ]);
  }
  return real;
}

function regularFile(root, relative, issues, missingCode = "REVIEW_FILE_MISSING") {
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    issues.push(issue(missingCode, `${relative} is missing`, relative));
    return null;
  }
  const metadata = fs.lstatSync(absolute);
  const real = fs.realpathSync.native(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || real !== absolute || !isWithin(root, real)) {
    issues.push(issue("REVIEW_FILE_ALIAS", `${relative} must be a canonical regular file`, relative));
    return null;
  }
  return absolute;
}

function inspectPng(root, relative, expectedWidth, expectedHeight, issues) {
  const absolute = regularFile(root, relative, issues, "PNG_MISSING");
  if (!absolute) return null;
  const data = fs.readFileSync(absolute);
  if (
    data.length < 33
    || !data.subarray(0, 8).equals(PNG_SIGNATURE)
    || data.readUInt32BE(8) !== 13
    || data.toString("ascii", 12, 16) !== "IHDR"
  ) {
    issues.push(issue("PNG_INVALID", `${relative} is not a structurally valid PNG`, relative));
    return null;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    issues.push(issue(
      "PNG_DIMENSIONS",
      `${relative} is ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`,
      relative,
    ));
  }
  return { width, height, bytes: data.length };
}

function timestampMilliseconds(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) return null;
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
}

function inspectSubtitles(root, issues) {
  const absolute = regularFile(root, SUBTITLES, issues, "SUBTITLES_MISSING");
  if (!absolute) return { cues: 0, durationMilliseconds: 0 };
  const raw = fs.readFileSync(absolute, "utf8").replace(/\r\n/g, "\n").trim();
  const blocks = raw ? raw.split(/\n{2,}/) : [];
  let previousEnd = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const lines = blocks[index].split("\n");
    const timing = /^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/.exec(lines[1] ?? "");
    const start = timing ? timestampMilliseconds(timing[1]) : null;
    const end = timing ? timestampMilliseconds(timing[2]) : null;
    if (
      lines[0] !== String(index + 1)
      || !timing
      || start === null
      || end === null
      || start >= end
      || start < previousEnd
      || lines.slice(2).join(" ").trim() === ""
    ) {
      issues.push(issue("SUBTITLE_SEQUENCE", `subtitle cue ${index + 1} is malformed, empty, or overlaps`, SUBTITLES));
    }
    if (end !== null) previousEnd = end;
  }
  if (blocks.length === 0) {
    issues.push(issue("SUBTITLES_EMPTY", "English subtitle file contains no cues", SUBTITLES));
  }
  if (/\{\{[A-Z][A-Z0-9_]*\}\}/.test(raw)) {
    issues.push(issue("SUBTITLE_PLACEHOLDER", "English subtitle file contains a template placeholder", SUBTITLES));
  }
  const missingScopes = REQUIRED_SUBTITLE_SCOPES.filter((scope) => !new RegExp(`\\b${scope}\\b`).test(raw));
  if (missingScopes.length > 0) {
    issues.push(issue(
      "SUBTITLE_SCOPE_COVERAGE",
      `Internal evidence rule: final subtitles do not name every submitted scope; missing: ${missingScopes.join(", ")}. Shopify requires demonstrated features and English or English-subtitled narration, not literal scope recitation.`,
      SUBTITLES,
    ));
  }
  return { cues: blocks.length, durationMilliseconds: previousEnd };
}

function inspectDocuments(root, issues) {
  let placeholders = 0;
  let unchecked = 0;
  for (const relative of DOCUMENTS) {
    const absolute = regularFile(root, relative, issues);
    if (!absolute) continue;
    const content = fs.readFileSync(absolute, "utf8");
    const matches = content.match(/\{\{[A-Z][A-Z0-9_]*\}\}/g) ?? [];
    placeholders += matches.length;
    if (matches.length > 0) {
      issues.push(issue("UNRESOLVED_PLACEHOLDER", `${relative} contains ${matches.length} unresolved placeholder(s)`, relative));
    }
    if (relative === CHECKLIST) {
      unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
      if (unchecked > 0) {
        issues.push(issue("UNCHECKED_REQUIREMENT", `${relative} contains ${unchecked} unchecked requirement(s)`, relative));
      }
    }
  }
  return { documents: DOCUMENTS.length, placeholders, unchecked };
}

function inspectProductBoundary(root, issues) {
  const boundaryAbsolute = regularFile(root, PRODUCT_BOUNDARY, issues);
  if (boundaryAbsolute) {
    const boundary = fs.readFileSync(boundaryAbsolute, "utf8");
    const requiredStatements = [
      ["staff-provisioned access", /Access requires an account provisioned and authorized by Xinzhi staff/],
      ["no self-service registration", /Self-service registration is not available/],
      ["installation does not grant access", /Installing or authorizing the Shopify app does not grant system access/],
      ["one public Shopify app", /one public app/i],
      ["two complete business workspaces", /two complete business workspaces/i],
      ["shared ERP account with separate business permissions", /ERP and customer service share the existing ERP account/],
      ["peer business entry", /ERP and customer service are peer businesses/],
      ["embedded experience release gate", /Shopify embedded experience is a release gate/],
      ["stable production customer-service origin", /https:\/\/kf\.xzkj\.ai/],
      ["isolated review customer-service origin", /https:\/\/kf-uat\.xzkj\.ai/],
      ["review-store-only UAT routing", /xinzhi-app-lab\.myshopify\.com/],
    ];
    for (const [label, pattern] of requiredStatements) {
      if (!pattern.test(boundary)) {
        issues.push(issue(
          "PRODUCT_BOUNDARY_INCOMPLETE",
          `${PRODUCT_BOUNDARY} does not lock ${label}`,
          PRODUCT_BOUNDARY,
        ));
      }
    }
  }

  for (const relative of [REVIEWER_INSTRUCTIONS, PARTNER_ENTRY_SHEET]) {
    const reviewerAbsolute = regularFile(root, relative, issues);
    if (!reviewerAbsolute) continue;
    const reviewer = fs.readFileSync(reviewerAbsolute, "utf8");
    const missingPermissions = REQUIRED_CUSTOMER_SERVICE_PERMISSIONS.filter(
      (permission) => !reviewer.includes(permission),
    );
    if (missingPermissions.length > 0) {
      issues.push(issue(
        "CUSTOMER_SERVICE_REVIEW_COVERAGE",
        `${relative} omits submitted customer-service permissions: ${missingPermissions.join(", ")}`,
        relative,
      ));
    }
  }

  // Preparation coverage is separate from the final SRT. A complete untimed
  // draft must never make an obsolete or missing timed recording pass.
  const narrationAbsolute = regularFile(root, NARRATION_DRAFT, issues);
  if (narrationAbsolute) {
    const narration = fs.readFileSync(narrationAbsolute, "utf8");
    const missing = REQUIRED_SUBTITLE_SCOPES.filter((scope) => !new RegExp(`\\b${scope}\\b`).test(narration));
    if (missing.length) issues.push(issue("NARRATION_SCOPE_COVERAGE", `untimed narration omits submitted scopes: ${missing.join(", ")}`, NARRATION_DRAFT));
  }

  const legacyNarrowing = /single storefront-chat reply|only the prepared storefront conversation|for the single storefront conversation|unrelated inboxes, tickets, routing, or agent administration/i;
  const publicSubmissionDocuments = [
    LISTING,
    REVIEWER_INSTRUCTIONS,
    `${REVIEW_ROOT}/06-screencast-script-and-subtitles.md`,
    `${REVIEW_ROOT}/07-partner-dashboard-entry-sheet.md`,
    `${REVIEW_ROOT}/11-owner-input-and-production-evidence-pack.md`,
  ];
  for (const relative of [...publicSubmissionDocuments, `${REVIEW_ROOT}/03-access-and-protected-data.md`, `${REVIEW_ROOT}/08-material-status.md`]) {
    const absolute = regularFile(root, relative, issues);
    if (absolute && legacyNarrowing.test(fs.readFileSync(absolute, "utf8"))) {
      issues.push(issue(
        "CUSTOMER_SERVICE_REVIEW_NARROWED",
        `${relative} narrows the submitted customer-service business to the obsolete single-reply boundary`,
        relative,
      ));
    }
  }
  const identityContractDocuments = [
    ...publicSubmissionDocuments,
    `${REVIEW_ROOT}/README.md`,
    PRODUCT_BOUNDARY,
    `${REVIEW_ROOT}/03-access-and-protected-data.md`,
    `${REVIEW_ROOT}/04-assets-and-screencast.md`,
    CHECKLIST,
    `${REVIEW_ROOT}/11-owner-input-and-production-evidence-pack.md`,
    `${REVIEW_ROOT}/12-existing-app-release-boundary.md`,
    CURRENT_PREPARATION_PLAN,
    PUBLIC_REVIEWER_GUIDE,
  ];
  const retiredSecondCredentialReference = /customer service uses its own native account|two (?:prepared native )?reviewer accounts|both reviewer credential sets|审核员需要两套|customer-service native login|use each workspace's independently verified native account|passwords are provided separately|ERP 与本仓库复制客服均采用原生身份|客服原生账号独立管理|独立客服原生账号|客服坐席仍独立登录|ERP and customer service use independent native authentication/i;
  for (const relative of identityContractDocuments) {
    const absolute = regularFile(root, relative, issues);
    const unrelatedIdentityReference = /must first open (?:the )?One workspace|One is the internal identity foundation|through One identity|shared-identity sign-in|through the shared identity service|same Xinzhi identity|Sign in with Xinzhi account|One 为内部身份底座|通过新知身份进入/i;
    if (absolute && retiredSecondCredentialReference.test(fs.readFileSync(absolute, "utf8"))) {
      issues.push(issue("SEPARATE_CUSTOMER_SERVICE_CREDENTIALS", `${relative} requires the retired second customer-service account`, relative));
    }
    if (absolute && unrelatedIdentityReference.test(fs.readFileSync(absolute, "utf8"))) {
      issues.push(issue(
        "UNRELATED_IDENTITY_PRODUCT_REFERENCE",
        `${relative} restores the retired One identity or central portal`,
        relative,
      ));
    }
    if (absolute && /Shopify App Home provides setup, status, and read-only previews|Shopify App Home is limited to installation, connection status|actual business management is performed in the independent Xinzhi ERP web admin|App Home confirms the API connection, while actual management continues/i.test(fs.readFileSync(absolute, "utf8"))) {
      issues.push(issue("EMBEDDED_REVIEW_COPY_CONFLICT", `${relative} presents the superseded status-only/external-link journey as the final review path`, relative));
    }
  }

  // Static regression tripwires only: these checks do not certify deployed
  // credentials, authorization, native sessions or a real Shopify install.
  const loginAbsolute = regularFile(root, ERP_LOGIN_PAGE, issues, "ERP_LOGIN_PAGE_MISSING");
  if (loginAbsolute) {
    const loginPage = fs.readFileSync(loginAbsolute, "utf8");
    const directLoginRequirements = [
      /useAuth\(/,
      /await login\(/,
      /name=['"]tenantCode['"]/,
      /name=['"]loginIdentifier['"]/,
      /name=['"]password['"]/,
    ];
    if (
      directLoginRequirements.some((pattern) => !pattern.test(loginPage))
      || /OneBusinessSignIn|useBusinessIdentity|(?:redirectToOneSignIn|startOneOidcLogin)\(/.test(loginPage)
    ) {
      issues.push(issue(
        "ERP_REVIEW_LOGIN_NOT_INDEPENDENT",
        `${ERP_LOGIN_PAGE} must use the native ERP tenant/account/password login, without the retired identity provider or portal handoff`,
        ERP_LOGIN_PAGE,
      ));
    }
  }

  const customerServiceMain = regularFile(root, CUSTOMER_SERVICE_MAIN, issues, "CUSTOMER_SERVICE_MAIN_MISSING");
  if (customerServiceMain) {
    const source = fs.readFileSync(customerServiceMain, "utf8");
    if (!/platform\.NewERPSharedIdentityMux\(/.test(source) || !/platform\.NewHTTPERPIdentityVerifier\(/.test(source) || /platform\.New(?:One|Native)\w*Mux\(|XZDESK_ONE_ISSUER/.test(source)) {
      issues.push(issue("CUSTOMER_SERVICE_REVIEW_LOGIN_NOT_SHARED", `${CUSTOMER_SERVICE_MAIN} must use the existing ERP identity and existing tenant partitions without One or native-password fallback`, CUSTOMER_SERVICE_MAIN));
    }
  }
}

function inspectScopeConfigs(root, issues) {
  let checked = 0;
  for (const config of SCOPE_CONFIGS) {
    const absolute = regularFile(root, config.file, issues, "SCOPE_CONFIG_MISSING");
    if (!absolute) continue;
    const content = fs.readFileSync(absolute, "utf8");
    const value = config.pattern.exec(content)?.[1]?.trim();
    if (value === undefined) {
      issues.push(issue(
        "SCOPE_CONFIG_FIELD_MISSING",
        `${config.file} does not define ${config.field}`,
        config.file,
      ));
      continue;
    }
    if (value !== FROZEN_SCOPE_VALUE) {
      issues.push(issue(
        "SCOPE_CONFIG_MISMATCH",
        `${config.file} ${config.field} does not match the frozen ten-scope review boundary`,
        config.file,
      ));
      continue;
    }
    checked += 1;
  }
  return checked;
}

function inspectAppIdentityConfig(root, issues) {
  const relative = "platform/customer-service/shopify.app.toml";
  const absolute = regularFile(root, relative, issues, "APP_CONFIG_MISSING");
  if (!absolute) return;
  const content = fs.readFileSync(absolute, "utf8");
  const clientId = /^\s*client_id\s*=\s*"([^"]*)"\s*$/m.exec(content)?.[1]?.trim();
  if (clientId !== FROZEN_SHOPIFY_CLIENT_ID) {
    issues.push(issue(
      "APP_CLIENT_ID_MISMATCH",
      `${relative} client_id does not identify the approved Xinzhi ERP app`,
      relative,
    ));
  }
}

function listingField(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\*\\*${escaped}\\*\\*\\s+([^\\r\\n]+)`).exec(content);
  return match?.[1]?.trim() ?? null;
}

function listingSection(content, startHeading, endHeading) {
  const start = startHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = endHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\*\\*${start}\\*\\*\\s+([\\s\\S]*?)\\n\\s*\\*\\*${end}\\*\\*`).exec(content);
  return match?.[1]?.trim() ?? null;
}

function inspectListing(root, issues) {
  const absolute = regularFile(root, LISTING, issues);
  if (!absolute) return { features: 0, searchTerms: 0 };
  const content = fs.readFileSync(absolute, "utf8");
  const limits = [
    ["App name", 30, "LISTING_NAME_LENGTH"],
    ["App introduction", 100, "LISTING_INTRODUCTION_LENGTH"],
    ["App details", 500, "LISTING_DETAILS_LENGTH"],
  ];
  for (const [heading, maximum, code] of limits) {
    const value = listingField(content, heading);
    if (value === null) {
      issues.push(issue("LISTING_FIELD_MISSING", `${heading} is missing from the primary listing`, LISTING));
    } else if ([...value].length > maximum) {
      issues.push(issue(code, `${heading} is ${[...value].length} characters; maximum is ${maximum}`, LISTING));
    }
  }
  const featureSection = listingSection(content, "Features", "Search terms");
  const features = featureSection?.split(/\r?\n/).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim()) ?? [];
  if (features.length === 0) {
    issues.push(issue("LISTING_FEATURES_MISSING", "primary listing has no feature bullets", LISTING));
  }
  features.forEach((feature, index) => {
    if ([...feature].length > 80) {
      issues.push(issue("LISTING_FEATURE_LENGTH", `feature ${index + 1} is ${[...feature].length} characters; maximum is 80`, LISTING));
    }
  });
  const searchSection = listingSection(content, "Search terms", "Pricing");
  const searchTerms = searchSection?.split(/\r?\n/).filter((line) => line.startsWith("- ")).length ?? 0;
  if (searchTerms === 0 || searchTerms > 5) {
    issues.push(issue("LISTING_SEARCH_TERM_COUNT", `primary listing must contain 1-5 search terms; found ${searchTerms}`, LISTING));
  }
  return { features: features.length, searchTerms };
}

function inspectFinalScreenshots(root, issues) {
  const directory = path.resolve(root, FINAL_SCREENSHOTS);
  if (!fs.existsSync(directory)) {
    issues.push(issue("FINAL_SCREENSHOTS_MISSING", "3-6 final exact-build screenshots have not been captured", FINAL_SCREENSHOTS));
    return 0;
  }
  const metadata = fs.lstatSync(directory);
  const real = fs.realpathSync.native(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || real !== directory || !isWithin(root, real)) {
    issues.push(issue("FINAL_SCREENSHOTS_ALIAS", "final screenshot directory must be canonical and non-symbolic", FINAL_SCREENSHOTS));
    return 0;
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const screenshots = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".png");
  if (entries.length !== screenshots.length || screenshots.length < 3 || screenshots.length > 6) {
    issues.push(issue("FINAL_SCREENSHOT_COUNT", "final screenshot directory must contain only 3-6 PNG files", FINAL_SCREENSHOTS));
  }
  const screenshotHashes = new Map();
  for (const entry of screenshots) {
    const relative = `${FINAL_SCREENSHOTS}/${entry.name}`;
    const inspected = inspectPng(root, relative, 1600, 900, issues);
    if (!inspected) continue;
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.resolve(root, relative)))
      .digest("hex");
    const duplicate = screenshotHashes.get(hash);
    if (duplicate) {
      issues.push(issue(
        "FINAL_SCREENSHOT_DUPLICATE",
        `${relative} is identical to ${duplicate}; every listing image must show a distinct feature, view, or state`,
        relative,
      ));
    } else {
      screenshotHashes.set(hash, relative);
    }
  }
  return screenshots.length;
}

function deduplicateIssues(issues) {
  const unique = new Map();
  for (const value of issues) unique.set(`${value.code}\0${value.message}`, value);
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "en") || left.message.localeCompare(right.message, "en"));
}

export function inspectShopifyReviewReadiness(repositoryRoot) {
  const root = validateRoot(repositoryRoot);
  const issues = [];
  inspectPng(root, ICON, 1200, 1200, issues);
  inspectPng(root, FEATURE_MEDIA, 1600, 900, issues);
  const subtitles = inspectSubtitles(root, issues);
  const documents = inspectDocuments(root, issues);
  inspectProductBoundary(root, issues);
  inspectAppIdentityConfig(root, issues);
  const scopeConfigs = inspectScopeConfigs(root, issues);
  const listing = inspectListing(root, issues);
  const screenshots = inspectFinalScreenshots(root, issues);
  return {
    root,
    issues: deduplicateIssues(issues),
    summary: {
      documents: documents.documents,
      placeholders: documents.placeholders,
      unchecked: documents.unchecked,
      screenshots,
      subtitleCues: subtitles.cues,
      subtitleDurationMilliseconds: subtitles.durationMilliseconds,
      listingFeatures: listing.features,
      listingSearchTerms: listing.searchTerms,
      scopeConfigs,
      skipped: 0,
    },
  };
}

export function runShopifyReviewReadinessGate(repositoryRoot) {
  const result = inspectShopifyReviewReadiness(repositoryRoot);
  if (result.issues.length > 0) throw new ShopifyReviewReadinessGateError(result.issues);
  return result;
}

function printSuccess(result) {
  const { summary } = result;
  process.stdout.write([
    "PASS Shopify review readiness gate",
    `documents=${summary.documents}`,
    `screenshots=${summary.screenshots}`,
    `subtitle_cues=${summary.subtitleCues}`,
    `subtitle_duration_ms=${summary.subtitleDurationMilliseconds}`,
    `listing_features=${summary.listingFeatures}`,
    `listing_search_terms=${summary.listingSearchTerms}`,
    `scope_config_fields=${summary.scopeConfigs}`,
    "placeholders=0",
    "unchecked=0",
    "skipped=0",
  ].join("\n") + "\n");
}

function printFailure(error) {
  const issues = error instanceof ShopifyReviewReadinessGateError
    ? error.issues
    : [issue("GATE_INTERNAL_ERROR", "Shopify review readiness gate could not complete")];
  process.stderr.write([
    "FAIL Shopify review readiness gate",
    ...issues.map((value) => `[${value.code}] ${value.message}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new ShopifyReviewReadinessGateError([
      issue("EXTERNAL_INPUT_REJECTED", "the gate accepts no repository path, URL, environment, or other input"),
    ]));
    process.exitCode = 2;
  } else {
    try {
      printSuccess(runShopifyReviewReadinessGate(LOCKED_REPOSITORY_ROOT));
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
