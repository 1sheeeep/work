import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");

const MAIN_JAVA_ROOT = "platform/backend/src/main/java";
const TEST_JAVA_ROOT = "platform/backend/src/test/java";
const RESOURCES_ROOT = "platform/backend/src/main/resources";
const POM = "platform/backend/pom.xml";
const GATE_TEST =
  "platform/scripts/backend-egress-boundary-gate.test.mjs";
const GATE_DOCUMENT =
  "platform/docs/backend-egress-boundary-gate.md";

const EXPECTED_DEPENDENCIES = new Set([
  "org.springframework.boot:spring-boot-starter-actuator",
  "org.springframework.boot:spring-boot-starter-data-jpa",
  "org.springframework.boot:spring-boot-starter-security",
  "org.bouncycastle:bcprov-jdk18on",
  "org.springframework.boot:spring-boot-starter-validation",
  "org.springframework.boot:spring-boot-starter-web",
  "org.springframework.boot:spring-boot-starter-flyway",
  "org.flywaydb:flyway-database-postgresql",
  "org.postgresql:postgresql",
  "org.springframework.boot:spring-boot-starter-test",
  "org.testcontainers:postgresql",
  "org.springframework.security:spring-security-test",
]);

const EXPECTED_TEST_NETWORK_FILES = new Set([
  "platform/backend/src/test/java/cn/xzkj/erp/config/DatabaseResiliencePostgresql16GateTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/config/ProductionReadinessIntegrationTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/security/HttpRoutingTrustBoundaryIntegrationTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/security/ObservabilityBoundaryPostgresql16GateTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGatewayTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/ChudaLogisticsProviderConnectorTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/HualeiLogisticsProviderConnectorTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/ItdidaLogisticsProviderConnectorTest.java",
]);

const REVIEWED_PRODUCTION_NETWORK_FILES = new Map([
  [
    "platform/backend/src/main/java/cn/xzkj/erp/customer/service/CustomerServiceEntryGrantService.java",
    { sha256: "e333d801c2f238ece67129211a5b6cddd190c309e63ddb929ddb89db194cc0fe", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/customer/service/CustomerServiceWorkloadAuthenticationFilter.java",
    { sha256: "d8c3ac439e99e449ad4b6bb066a9fb9c40d7dfdb4bba361a41b0ace933942dce", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/api/FulfillmentDtos.java",
    { sha256: "afac44f349557bad3737d6e01fdd75941272332805375b682624c61bb593afaf", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/domain/FulfillmentRecords.java",
    { sha256: "36cb7c72bd2f30fcbd0fc97d499e4187147e5f721e33dff127c9492e971fc33f", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/repository/ShopifyFulfillmentPublicationRepository.java",
    { sha256: "5229e459542aea8238ac31de410338d250d4673120c3fba0a5e12f357a5c55b9", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/service/ShopifyFulfillmentPublicationService.java",
    { sha256: "1abd1a055999b6850c193853d3b8aa18998cb8ec2f10e56e5595190ace8e8edf", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/service/OrderShopifyCatalogPreviewService.java",
    { sha256: "a0dfdc7382b8acd446ea39fa4ec57dba2ec3da38062e5e53c46ad5a5c8a3d612", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platform/connector/ChannelConnectorGateway.java",
    { sha256: "50a7cd04241f36983cc070b6bbd38b387c38e32680eb6094a94778756bada283", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGateway.java",
    { sha256: "f218ec2448b532551b37d734961407a0210c7c74b461e03369a9f7511ca0742a", client: true },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/authorization/ChudaLogisticsProviderConnector.java",
    { sha256: "0fa224383d1dc6ce48976b2b2a6553ac3fae95c655d72b92bb64cb1e6e8e1a87", client: true },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/authorization/HualeiLogisticsProviderConnector.java",
    { sha256: "39ee6a96bb2c98870d29f1278a14d2891baadda6de7f755babfee48046a3a0c9", client: true },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/authorization/ItdidaLogisticsProviderConnector.java",
    { sha256: "2aa6aa85d759592346cb09e5b8d1f395c0af9b8859aac225382e6cff7a3adff5", client: true },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/authorization/LogisticsProviderCatalog.java",
    { sha256: "c796590e30a1cd24f09eee0154d41a0de14fc1f5caa2ace275cde6dab7eddc12", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/authorization/LogisticsProviderOperations.java",
    { sha256: "ad66abae886a91c31c5e2a99b2ddd04aa422169c31b11231e79836f82d9a74d1", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/shipment/LogisticsShipmentRepository.java",
    { sha256: "845caaf0a7c017cba5ee00dbe73aff3bc81c630db78ba814b86dc7f1e00fec12", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/authorization/LogisticsProviderSystemConfigService.java",
    { sha256: "969558de96c3be3b4911aee0d686aa6fd6089ef54fad72866dc129a20e88b1bc", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/inquiry/LogisticsInquiryController.java",
    { sha256: "7a29fdf9e51371874e36128a17bb592f6cda6f990202bd7cf6118f958c0157ad", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/inquiry/LogisticsInquiryRecord.java",
    { sha256: "322b631deacef035a0f660df7837d0e3f7f6794f79e7fb196ed744101acb111e", client: false },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/inquiry/LogisticsInquiryService.java",
    { sha256: "bc574d9c0cd4eda681f9f1d8f528deef2c85cec436307adf922e5de7e873c660", client: false },
  ],
]);

const REVIEWED_TEST_NETWORK_HASHES = new Map([
  [
    "platform/backend/src/test/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGatewayTest.java",
    "c507c9891c8d2be7ace13480101779a5c69089c13278888db860f9bf6352f346",
  ],
  [
    "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/ChudaLogisticsProviderConnectorTest.java",
    "eb36751d88a085d5d4510f1d47183bfe2f8f41381d136b75203ceeee7129839b",
  ],
  [
    "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/HualeiLogisticsProviderConnectorTest.java",
    "80197328770948922191746957470b560ce3acf00611d86afbeee13b6041ecda",
  ],
  [
    "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/ItdidaLogisticsProviderConnectorTest.java",
    "4fd77bff56f6176f005e2a8207788d249ebd6f16c5b34459e2033cf2069adaec",
  ],
]);

const REVIEWED_NETWORK_RESOURCE_HASHES = new Map([
  [
    "platform/backend/src/main/resources/db/migration/V50__shopify_fulfillment_publications.sql",
    "b6019600ea787d7938a66619b293009abf35bdd87549e76f75090cb2ab45ef43",
  ],
  [
    "platform/backend/src/main/resources/db/migration/V89__logistics_inquiries.sql",
    "599b1c9d3078fca9dacb96b64e152ef9bb1f0b22f71dae8ef1b349fc565d4e13",
  ],
]);

const REQUIRED_FILES = [
  POM,
  "platform/backend/src/main/resources/application.yml",
  "platform/backend/src/main/resources/application-production.yml",
  ...EXPECTED_TEST_NETWORK_FILES,
  "platform/scripts/backend-egress-boundary-gate.mjs",
  GATE_TEST,
  GATE_DOCUMENT,
];

const OUTBOUND_CLIENT_PATTERNS = [
  /\bjava\.net\.http\b/,
  /\bHttpClient\b/,
  /\bHttpRequest\b/,
  /\bHttpURLConnection\b/,
  /\bURLConnection\b/,
  /\bRestTemplate\b/,
  /\bRestOperations\b/,
  /\bRestClient\b/,
  /\bWebClient\b/,
  /\bExchangeFunction\b/,
  /\bClientHttpConnector\b/,
  /\bClientHttpRequestFactory\b/,
  /\bSimpleClientHttpRequestFactory\b/,
  /\bOkHttpClient\b/,
  /\bFeignClient\b/,
  /\bRetrofit\b/,
  /\borg\.apache\.(?:http|hc)\b/,
  /\breactor\.netty\.http\.client\b/,
  /\bApacheHttpClient\b/,
  /\bnew\s+URL\s*\(/,
  /\bURL\s*\.\s*of\s*\(/,
];

const DNS_SOCKET_PATTERNS = [
  /\bInetAddress\b/,
  /\bInetSocketAddress\b/,
  /\bNetworkInterface\b/,
  /\bProxySelector\b/,
  /\bDnsResolver\b/,
  /\bDomainNameResolver\b/,
  /\bInitialDirContext\b/,
  /\bDatagramSocket\b/,
  /\bDatagramPacket\b/,
  /\bDatagramChannel\b/,
  /\bServerSocket\b/,
  /\bSocketFactory\b/,
  /\bSSLSocket\b/,
  /\bSocketChannel\b/,
  /\bAsynchronousSocketChannel\b/,
  /\bnew\s+(?:java\.net\.)?Socket\s*\(/,
];

const PROCESS_PATTERNS = [
  /\bProcessBuilder\b/,
  /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/,
  /\bProcessHandle\b/,
  /\bGroovyShell\b/,
  /\bScriptEngineManager\b/,
];

const PROXY_PATTERNS = [
  /\bProxySelector\b/,
  /\bjava\.net\.Proxy\b/,
  /\b(?:setProxy|proxyHost|proxyPort|socksProxyHost)\b/i,
  /\bSystem\s*\.\s*getenv\s*\(\s*"(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)"/i,
  /\bSystem\s*\.\s*getProperty\s*\(\s*"(?:http|https|socks)\.proxy/i,
];

const REDIRECT_PATTERNS = [
  /\bfollowRedirects\s*\(/,
  /\bsetInstanceFollowRedirects\s*\(/,
  /\bsetFollowRedirects\s*\(/,
  /\bRedirectStrategy\b/,
  /\bLocation\b[\s\S]{0,80}\b(?:301|302|303|307|308)\b/,
];

const NETWORK_FIELD_PATTERN =
  /\b(?:String|URI|URL|Object)\s+(?:[A-Za-z_$][\w$]*\s*,\s*)*(?:[A-Za-z_$][\w$]*(?:Url|Uri|Endpoint|Host|Hostname|Port|Proxy|Redirect|Callback|Webhook|Destination|Link)|(?:url|uri|endpoint|host|hostname|port|proxy|redirect|callback|webhook|destination|link))\b/;
const SQL_NETWORK_FIELD_PATTERN =
  /^\s*(?:"?[a-z_][a-z0-9_]*"?)\s+(?:VAR)?CHAR\b/i;
const NETWORK_FIELD_NAME_PATTERN =
  /(?:^|_)(?:url|uri|endpoint|host|hostname|port|proxy|redirect|callback|webhook|destination|link)(?:$|_)/i;

const ALLOWED_REQUEST_HEADERS = new Set([
  "Accept-Language",
  "Authorization",
  "X-Request-Id",
]);

const ALLOWED_CONFIG_PATHS = [
  /^spring\.datasource\.url$/,
  /^server\.port$/,
  /^management\.endpoint(?:\.|$)/,
  /^management\.endpoints(?:\.|$)/,
  /^erp\.channel-connector\.xz-erp-app\.base-url$/,
  /^erp\.logistics-connector\.(?:chuda|dayunjia|biaoju|baidu-yixia|hualei|tongxi|jiayun-shengtu|shandianhou-xiaobao|shandianhou-shangpai)\.base-url$/,
  /^erp\.logistics-connector\.shandianhou-xiaobao\.label-base-url$/,
];

const FORBIDDEN_SCHEME_PATTERN = /^(?:file|jar|gopher|ftp):/i;
const NETWORK_SCHEME_PATTERN = /^(?:https?):/i;
const OBFUSCATION_PATTERN =
  /\\|%(?:00|09|0a|0d|20|23|2e|2f|3a|40|5b|5c|5d)|\u0000/i;

export class BackendEgressGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "BackendEgressGateError";
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
}

function sha256(content) {
  return crypto.createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative))
  );
}

function validateRoot(repositoryRoot) {
  const resolved = path.resolve(repositoryRoot);
  if (!fs.existsSync(resolved)) {
    throw new BackendEgressGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const realRoot = fs.realpathSync.native(resolved);
  if (realRoot !== resolved) {
    throw new BackendEgressGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical absolute path",
      ),
    ]);
  }
  return realRoot;
}

function readRegularFile(root, relative) {
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    throw new BackendEgressGateError([
      issue("REQUIRED_FILE_MISSING", `required file is missing: ${relative}`),
    ]);
  }
  const metadata = fs.lstatSync(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new BackendEgressGateError([
      issue(
        "SOURCE_ALIAS_REJECTED",
        `required source must be a regular file: ${relative}`,
      ),
    ]);
  }
  const real = fs.realpathSync.native(absolute);
  if (real !== absolute || !isWithin(root, real)) {
    throw new BackendEgressGateError([
      issue(
        "SOURCE_ALIAS_REJECTED",
        `required source is aliased or leaves the repository: ${relative}`,
      ),
    ]);
  }
  return fs.readFileSync(absolute, "utf8");
}

function walkRegularFiles(root, startRelative, predicate) {
  const start = path.resolve(root, startRelative);
  if (!isWithin(root, start) || !fs.existsSync(start)) {
    throw new BackendEgressGateError([
      issue(
        "REQUIRED_DIRECTORY_MISSING",
        `required directory is missing: ${startRelative}`,
      ),
    ]);
  }
  if (!fs.lstatSync(start).isDirectory()) {
    throw new BackendEgressGateError([
      issue(
        "REQUIRED_DIRECTORY_INVALID",
        `required path is not a directory: ${startRelative}`,
      ),
    ]);
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(root, absolute));
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        throw new BackendEgressGateError([
          issue(
            "SOURCE_ALIAS_REJECTED",
            `symbolic links are not accepted in inspected source: ${relative}`,
          ),
        ]);
      }
      if (metadata.isDirectory()) {
        visit(absolute);
      } else if (metadata.isFile() && predicate(relative)) {
        const real = fs.realpathSync.native(absolute);
        if (real !== absolute || !isWithin(root, real)) {
          throw new BackendEgressGateError([
            issue(
              "SOURCE_ALIAS_REJECTED",
              `source is aliased or leaves the repository: ${relative}`,
            ),
          ]);
        }
        files.push({
          relative,
          content: fs.readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  visit(start);
  return files;
}

function stripJavaComments(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "string" || state === "character") {
      result += char;
      if (char === "\\") {
        if (next !== undefined) {
          result += next;
          index += 1;
        }
      } else if (
        (state === "string" && char === '"')
        || (state === "character" && char === "'")
      ) {
        state = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += char;
      if (char === '"') state = "string";
      if (char === "'") state = "character";
    }
  }
  return result;
}

function javaStringLiterals(source) {
  const values = [];
  for (const match of source.matchAll(/"((?:\\.|[^"\\])*)"/gs)) {
    values.push(match[1]);
  }
  return values;
}

function hasAny(source, patterns) {
  return patterns.some((pattern) => pattern.test(source));
}

function matchingPatterns(source, patterns) {
  return patterns.filter((pattern) => pattern.test(source));
}

function addIssueForMatches(
  source,
  patterns,
  code,
  message,
  issues,
) {
  if (matchingPatterns(source, patterns).length > 0) {
    issues.push(issue(code, message));
  }
}

function parseDependencies(pom) {
  const dependencies = [];
  for (const match of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const groupId = match[1].match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
    const artifactId =
      match[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
    if (!groupId || !artifactId) {
      dependencies.push("UNRESOLVED");
    } else {
      dependencies.push(`${groupId}:${artifactId}`);
    }
  }
  return dependencies.sort((left, right) => left.localeCompare(right, "en"));
}

function inspectDependencies(pom, issues) {
  const dependencies = parseDependencies(pom);
  const actual = new Set(dependencies);
  for (const expected of EXPECTED_DEPENDENCIES) {
    if (!actual.has(expected)) {
      issues.push(issue(
        "DEPENDENCY_SET_CHANGED",
        `reviewed dependency is missing or renamed: ${expected}`,
      ));
    }
  }
  for (const value of actual) {
    if (!EXPECTED_DEPENDENCIES.has(value)) {
      issues.push(issue(
        "DEPENDENCY_SET_CHANGED",
        `unreviewed backend dependency is present: ${value}`,
      ));
    }
  }
  return dependencies.length;
}

function callArguments(source, callPattern) {
  const calls = [];
  for (const match of source.matchAll(callPattern)) {
    let depth = 1;
    let state = "code";
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      const next = source[end + 1];
      if (state === "string" || state === "character") {
        if (char === "\\") {
          end += 1;
        } else if (
          (state === "string" && char === '"')
          || (state === "character" && char === "'")
        ) {
          state = "code";
        }
        continue;
      }
      if (char === '"') {
        state = "string";
      } else if (char === "'") {
        state = "character";
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === "/" && next === "/") {
        const newline = source.indexOf("\n", end + 2);
        end = newline < 0 ? source.length : newline;
      } else if (char === "/" && next === "*") {
        const close = source.indexOf("*/", end + 2);
        end = close < 0 ? source.length : close + 1;
      }
    }
    calls.push({
      index: match.index,
      expression: source.slice(
        match.index + match[0].length,
        Math.min(end, source.length),
      ).trim(),
      closed: end < source.length,
    });
  }
  return calls;
}

function isApprovedRelativeLocation(source, call) {
  if (!call.closed) return false;
  const expression = call.expression;
  if (!/^"\/api\/v1\//.test(expression)) return false;
  if (/[#?\\]|%(?:00|09|0a|0d|20|23|2f|3a|40|5c)/i.test(expression)) {
    return false;
  }
  const prefix = source.slice(Math.max(0, call.index - 80), call.index);
  return /\.created\s*\(\s*$/.test(prefix);
}

function normalizedHost(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function ipv4Octets(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const values = hostname.split(".").map(Number);
  return values.every((value) => value >= 0 && value <= 255) ? values : null;
}

function isForbiddenIpv4(hostname) {
  const value = ipv4Octets(hostname);
  if (!value) return false;
  const [a, b] = value;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  );
}

function isForbiddenIpv6(hostname) {
  if (net.isIP(hostname) !== 6) return false;
  const value = hostname.toLowerCase();
  return (
    value === "::"
    || value === "::1"
    || /^f[cd]/.test(value)
    || /^fe[89ab]/.test(value)
    || /^ff/.test(value)
    || /^::ffff:(?:0:)?/.test(value)
  );
}

function classifyNetworkLiteral(relative, rawValue, issues) {
  const value = rawValue.trim();
  if (FORBIDDEN_SCHEME_PATTERN.test(value)) {
    issues.push(issue(
      "FORBIDDEN_URI_SCHEME",
      `${relative} contains a forbidden file/jar/gopher/ftp URI`,
    ));
    return;
  }
  if (/^(?:\\\\|\/\/)/.test(value)) {
    issues.push(issue(
      "NETWORK_PATH_REFERENCE",
      `${relative} contains a scheme-relative or UNC network location`,
    ));
    return;
  }
  const looksNetworked =
    NETWORK_SCHEME_PATTERN.test(value)
    || /^(?:https?)%(?:3a|253a)/i.test(value);
  if (!looksNetworked) return;
  if (OBFUSCATION_PATTERN.test(value)) {
    issues.push(issue(
      "NETWORK_LOCATION_OBFUSCATED",
      `${relative} contains backslash, control, or encoded authority confusion`,
    ));
  }
  const rawAuthority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1]
    ?.replace(/^.*@/, "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    rawAuthority
    && (
      /^(?:0x[0-9a-f]+|\d+)$/i.test(rawAuthority)
      || /^(?:0[0-7]+)(?:\.0[0-7]+){1,3}$/.test(rawAuthority)
    )
  ) {
    issues.push(issue(
      "NETWORK_LOCATION_OBFUSCATED",
      `${relative} contains a non-canonical numeric host`,
    ));
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    issues.push(issue(
      "NETWORK_LOCATION_UNPARSEABLE",
      `${relative} contains an unparseable network location`,
    ));
    return;
  }
  if (parsed.username || parsed.password) {
    issues.push(issue(
      "NETWORK_LOCATION_USERINFO",
      `${relative} contains URL userinfo`,
    ));
  }
  if (parsed.hash) {
    issues.push(issue(
      "NETWORK_LOCATION_FRAGMENT",
      `${relative} contains a URL fragment`,
    ));
  }
  const hostname = normalizedHost(parsed.hostname);
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "host.docker.internal"
    || hostname === "gateway.docker.internal"
  ) {
    issues.push(issue(
      "LOCAL_NETWORK_TARGET",
      `${relative} contains a loopback or Docker-host target`,
    ));
  } else if (
    hostname === "169.254.169.254"
    || hostname === "100.100.100.200"
    || hostname === "168.63.129.16"
    || hostname === "metadata.google.internal"
  ) {
    issues.push(issue(
      "CLOUD_METADATA_TARGET",
      `${relative} contains a cloud metadata target`,
    ));
  } else if (isForbiddenIpv4(hostname) || isForbiddenIpv6(hostname)) {
    issues.push(issue(
      "NON_PUBLIC_NETWORK_TARGET",
      `${relative} contains a private, local, link-local, or multicast target`,
    ));
  }
  issues.push(issue(
    "OUTBOUND_ALLOWLIST_EMPTY",
    `${relative} contains a network location while production egress is unimplemented`,
  ));
}

function inspectUriCalls(file, source, issues) {
  let relativeLocations = 0;
  const calls = callArguments(source, /\bURI\s*\.\s*create\s*\(/g);
  for (const call of calls) {
    if (isApprovedRelativeLocation(source, call)) {
      relativeLocations += 1;
    } else {
      issues.push(issue(
        "DYNAMIC_URI_SURFACE",
        `${file.relative} contains a URI.create call outside a relative API Location`,
      ));
    }
  }
  if (/\bnew\s+URI\s*\(/.test(source) || /\bURIBuilder\b/.test(source)) {
    issues.push(issue(
      "DYNAMIC_URI_SURFACE",
      `${file.relative} contains an unreviewed URI construction surface`,
    ));
  }
  return relativeLocations;
}

function inspectRequestHeaders(file, source, issues) {
  for (const call of callArguments(source, /\bgetHeader\s*\(/g)) {
    const literal = call.expression.match(/^"([^"]+)"$/)?.[1];
    if (!literal || !ALLOWED_REQUEST_HEADERS.has(literal)) {
      issues.push(issue(
        "REQUEST_HEADER_TRUST_SURFACE",
        `${file.relative} reads an unreviewed request header`,
      ));
    }
  }
  if (/\b(?:getHeaders|getHeaderNames)\s*\(/.test(source)) {
    issues.push(issue(
      "REQUEST_HEADER_TRUST_SURFACE",
      `${file.relative} enumerates or reads a multi-value request header`,
    ));
  }
  if (
    /\b(?:Forwarded|X-Forwarded-(?:Host|Proto|Port|For))\b/i.test(source)
    || /\bgetServerName\s*\(/.test(source)
    || /\bgetRequestURL\s*\(/.test(source)
  ) {
    issues.push(issue(
      "FORWARDED_AUTHORITY_TRUST",
      `${file.relative} consumes forwarded or request authority data`,
    ));
  }
}

function inspectProductionJava(javaFiles, issues) {
  let relativeLocations = 0;
  let clientFiles = 0;
  for (const file of javaFiles) {
    const source = stripJavaComments(file.content);
    const hasClient = hasAny(source, OUTBOUND_CLIENT_PATTERNS);
    const reviewed = REVIEWED_PRODUCTION_NETWORK_FILES.get(file.relative);
    if (reviewed) {
      if (sha256(file.content) !== reviewed.sha256 || hasClient !== reviewed.client) {
        issues.push(issue(
          "REVIEWED_NETWORK_SOURCE_DRIFT",
          `${file.relative} changed after its outbound/network-field review`,
        ));
      }
      if (hasClient) clientFiles += 1;
      continue;
    }
    const uriCalls = callArguments(source, /\bURI\s*\.\s*create\s*\(/g);
    if (hasClient) {
      clientFiles += 1;
      issues.push(issue(
        "PRODUCTION_HTTP_CLIENT",
        `${file.relative} introduces a production HTTP client surface`,
      ));
    }
    addIssueForMatches(
      source,
      DNS_SOCKET_PATTERNS,
      "PRODUCTION_DNS_OR_SOCKET",
      `${file.relative} introduces production DNS or socket access`,
      issues,
    );
    addIssueForMatches(
      source,
      PROCESS_PATTERNS,
      "PRODUCTION_PROCESS_EXECUTION",
      `${file.relative} introduces a production process execution surface`,
      issues,
    );
    addIssueForMatches(
      source,
      PROXY_PATTERNS,
      "PROXY_TRUST_SURFACE",
      `${file.relative} introduces proxy configuration or proxy environment trust`,
      issues,
    );
    addIssueForMatches(
      source,
      REDIRECT_PATTERNS,
      "HTTP_REDIRECT_SURFACE",
      `${file.relative} introduces redirect-following or redirect processing`,
      issues,
    );
    if (NETWORK_FIELD_PATTERN.test(source)) {
      issues.push(issue(
        "DYNAMIC_NETWORK_FIELD",
        `${file.relative} declares a URL/URI/host/port/redirect-like field`,
      ));
    }
    inspectRequestHeaders(file, source, issues);
    relativeLocations += inspectUriCalls(file, source, issues);
    if (hasClient || uriCalls.some((call) =>
      !isApprovedRelativeLocation(source, call))) {
      for (const literal of javaStringLiterals(source)) {
        classifyNetworkLiteral(file.relative, literal, issues);
      }
    }
  }
  for (const relative of REVIEWED_PRODUCTION_NETWORK_FILES.keys()) {
    if (!javaFiles.some((file) => file.relative === relative)) {
      issues.push(issue(
        "REVIEWED_NETWORK_SOURCE_MISSING",
        `reviewed network source is missing: ${relative}`,
      ));
    }
  }
  return { relativeLocations, clientFiles };
}

function yamlPropertyPaths(content) {
  const values = [];
  const stack = [];
  for (const rawLine of content.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(rawLine)) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
    const segments = match[2].split(".");
    const pathValue = [
      ...stack.flatMap((value) => value.segments),
      ...segments,
    ].join(".");
    values.push({ path: pathValue, value: match[3].trim() });
    if (match[3].trim() === "") {
      stack.push({ indent, segments });
    }
  }
  return values;
}

function suspiciousConfigPath(propertyPath) {
  const segments = propertyPath.split(".");
  return segments.some((segment) => {
    const normalized = segment.toLowerCase().replaceAll("-", "_");
    return NETWORK_FIELD_NAME_PATTERN.test(normalized)
      || /(?:Url|Uri|Endpoint|Host|Hostname|Port|Proxy|Redirect|Callback|Webhook|Destination|Link)$/.test(
        segment,
      );
  });
}

function inspectResources(resourceFiles, issues) {
  let reviewedNetworkConfig = 0;
  for (const file of resourceFiles) {
    if (/\.ya?ml$/i.test(file.relative)) {
      for (const property of yamlPropertyPaths(file.content)) {
        if (!suspiciousConfigPath(property.path)) continue;
        if (ALLOWED_CONFIG_PATHS.some((pattern) => pattern.test(property.path))) {
          reviewedNetworkConfig += 1;
        } else {
          issues.push(issue(
            "DYNAMIC_NETWORK_CONFIGURATION",
            `${file.relative} declares unreviewed network configuration: ${property.path}`,
          ));
        }
      }
    } else if (/\.properties$/i.test(file.relative)) {
      for (const line of file.content.split(/\r?\n/)) {
        const match = line.match(/^\s*([^#!][^=:\s]*)\s*[=:]/);
        if (
          match
          && suspiciousConfigPath(match[1])
          && !ALLOWED_CONFIG_PATHS.some((pattern) => pattern.test(match[1]))
        ) {
          issues.push(issue(
            "DYNAMIC_NETWORK_CONFIGURATION",
            `${file.relative} declares unreviewed network configuration: ${match[1]}`,
          ));
        }
      }
    } else if (/\.sql$/i.test(file.relative)) {
      const reviewedHash = REVIEWED_NETWORK_RESOURCE_HASHES.get(file.relative);
      if (reviewedHash) {
        if (sha256(file.content) !== reviewedHash) {
          issues.push(issue(
            "REVIEWED_NETWORK_RESOURCE_DRIFT",
            `${file.relative} changed after its persisted network-field review`,
          ));
        }
        continue;
      }
      for (const line of file.content.split(/\r?\n/)) {
        if (!SQL_NETWORK_FIELD_PATTERN.test(line)) continue;
        const field = line.trim().split(/\s+/)[0].replaceAll('"', "");
        if (NETWORK_FIELD_NAME_PATTERN.test(field)) {
          issues.push(issue(
            "PERSISTED_NETWORK_LOCATION",
            `${file.relative} declares a persisted network-location field`,
          ));
        }
      }
    }
    if (
      /\$\{\s*(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)\b/i.test(
        file.content,
      )
    ) {
      issues.push(issue(
        "PROXY_TRUST_SURFACE",
        `${file.relative} reads a proxy environment variable`,
      ));
    }
  }
  for (const relative of REVIEWED_NETWORK_RESOURCE_HASHES.keys()) {
    if (!resourceFiles.some((file) => file.relative === relative)) {
      issues.push(issue(
        "REVIEWED_NETWORK_RESOURCE_MISSING",
        `reviewed network resource is missing: ${relative}`,
      ));
    }
  }
  return reviewedNetworkConfig;
}

function inspectTestNetworkBoundary(testFiles, issues) {
  const detected = new Set();
  for (const file of testFiles) {
    const source = stripJavaComments(file.content);
    const hasClient = hasAny(source, OUTBOUND_CLIENT_PATTERNS);
    const hasSocket = hasAny(source, DNS_SOCKET_PATTERNS);
    if (!hasClient && !hasSocket) continue;
    detected.add(file.relative);
    if (!EXPECTED_TEST_NETWORK_FILES.has(file.relative)) {
      issues.push(issue(
        "TEST_NETWORK_SURFACE_UNREVIEWED",
        `${file.relative} introduces an unreviewed test network surface`,
      ));
      continue;
    }
    const reviewedHash = REVIEWED_TEST_NETWORK_HASHES.get(file.relative);
    if (reviewedHash) {
      if (sha256(file.content) !== reviewedHash || !source.includes("127.0.0.1")) {
        issues.push(issue(
          "REVIEWED_TEST_NETWORK_DRIFT",
          `${file.relative} changed after its loopback connector-client review`,
        ));
      }
      continue;
    }
    if (!source.includes("127.0.0.1")) {
      issues.push(issue(
        "TEST_NETWORK_NOT_LOOPBACK",
        `${file.relative} does not pin its network target to IPv4 loopback`,
      ));
    }
    if (
      /https:\/\//i.test(source)
      || javaStringLiterals(source).some((value) =>
        FORBIDDEN_SCHEME_PATTERN.test(value))
      || /\b(?:InetAddress|DnsResolver|DomainNameResolver)\b/.test(source)
    ) {
      issues.push(issue(
        "TEST_NETWORK_NOT_LOOPBACK",
        `${file.relative} contains a non-loopback scheme or DNS surface`,
      ));
    }
    for (const literal of javaStringLiterals(source)) {
      if (!/^http:/i.test(literal)) continue;
      let parsed;
      try {
        parsed = new URL(literal);
      } catch {
        issues.push(issue(
          "TEST_NETWORK_NOT_LOOPBACK",
          `${file.relative} contains an unparseable test HTTP target`,
        ));
        continue;
      }
      if (normalizedHost(parsed.hostname) !== "127.0.0.1") {
        issues.push(issue(
          "TEST_NETWORK_NOT_LOOPBACK",
          `${file.relative} contains a test HTTP target outside IPv4 loopback`,
        ));
      }
    }
    for (const uriCall of callArguments(source, /\.uri\s*\(/g)) {
      if (
        !/^URI\.create\s*\(\s*"http:\/\/127\.0\.0\.1:/.test(
          uriCall.expression,
        )
        && !/^baseUri\.resolve\s*\(/.test(uriCall.expression)
      ) {
        issues.push(issue(
          "TEST_NETWORK_TARGET_DYNAMIC",
          `${file.relative} contains a test request target not rooted in the reviewed loopback base`,
        ));
      }
    }
    if (
      /\bfollowRedirects\s*\(/.test(source)
      && !/followRedirects\s*\(\s*HttpClient\.Redirect\.NEVER\s*\)/.test(
        source,
      )
    ) {
      issues.push(issue(
        "TEST_REDIRECTS_ENABLED",
        `${file.relative} enables or ambiguously configures redirects`,
      ));
    }
  }
  for (const expected of EXPECTED_TEST_NETWORK_FILES) {
    if (!detected.has(expected)) {
      issues.push(issue(
        "TEST_NETWORK_FACT_MISSING",
        `reviewed loopback test network fact is missing: ${expected}`,
      ));
    }
  }
  return detected.size;
}

function inspectGateTests(testSource, issues) {
  const testCount = [...testSource.matchAll(/\btest\s*\(\s*["'`]/g)].length;
  if (testCount === 0) {
    issues.push(issue(
      "ZERO_GATE_TESTS",
      "backend egress gate has zero declared Node tests",
    ));
  }
  if (
    /\b(?:test|it|describe)\s*\.\s*skip\s*\(/.test(testSource)
    || /\b(?:test|it)\s*\.\s*todo\s*\(/.test(testSource)
    || /\b(?:skip|todo)\s*:\s*true\b/.test(testSource)
  ) {
    issues.push(issue(
      "SKIPPED_GATE_TEST",
      "backend egress gate tests contain a skipped test",
    ));
  }
  return testCount;
}

function sortedUnique(issues) {
  const unique = new Map();
  for (const value of issues) {
    unique.set(`${value.code}\0${value.message}`, value);
  }
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "en")
      || left.message.localeCompare(right.message, "en"));
}

export function inspectBackendEgressBoundary(repositoryRoot) {
  const root = validateRoot(repositoryRoot);
  const required = new Map(
    REQUIRED_FILES.map((relative) => [
      relative,
      readRegularFile(root, relative),
    ]),
  );
  const mainJava = walkRegularFiles(
    root,
    MAIN_JAVA_ROOT,
    (relative) => relative.endsWith(".java"),
  );
  const testJava = walkRegularFiles(
    root,
    TEST_JAVA_ROOT,
    (relative) => relative.endsWith(".java"),
  );
  const resources = walkRegularFiles(
    root,
    RESOURCES_ROOT,
    (relative) => /\.(?:ya?ml|properties|sql)$/i.test(relative),
  );
  const issues = [];
  const dependencies = inspectDependencies(required.get(POM), issues);
  const production = inspectProductionJava(mainJava, issues);
  const reviewedNetworkConfig = inspectResources(resources, issues);
  const testNetworkFiles = inspectTestNetworkBoundary(testJava, issues);
  const gateTests = inspectGateTests(required.get(GATE_TEST), issues);
  const outboundAllowlistEntries = [...REVIEWED_PRODUCTION_NETWORK_FILES.values()]
    .filter((value) => value.client).length;
  if (production.clientFiles !== outboundAllowlistEntries) {
    issues.push(issue(
      "OUTBOUND_ALLOWLIST_VIOLATION",
      "production HTTP client inventory differs from the reviewed outbound allowlist",
    ));
  }
  return {
    root,
    issues: sortedUnique(issues),
    summary: {
      requiredFiles: required.size,
      productionJavaFiles: mainJava.length,
      resourceFiles: resources.length,
      dependencies,
      relativeLocationUris: production.relativeLocations,
      productionHttpClientFiles: production.clientFiles,
      outboundAllowlistEntries,
      reviewedNetworkConfig,
      testNetworkFiles,
      gateTests,
      skipped: 0,
    },
  };
}

export function runBackendEgressBoundaryGate(repositoryRoot) {
  const result = inspectBackendEgressBoundary(repositoryRoot);
  if (result.issues.length > 0) {
    throw new BackendEgressGateError(result.issues);
  }
  return result;
}

function printFailure(error) {
  const issues = error instanceof BackendEgressGateError
    ? error.issues
    : [issue(
      "GATE_INTERNAL_ERROR",
      "backend egress boundary gate could not complete",
    )];
  process.stderr.write([
    "FAIL backend egress boundary gate",
    ...issues.map((value) => `[${value.code}] ${value.message}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new BackendEgressGateError([
      issue(
        "EXTERNAL_INPUT_REJECTED",
        "the gate accepts no path, URL, environment, .env, or credential input",
      ),
    ]));
    process.exitCode = 2;
  } else {
    try {
      const result = runBackendEgressBoundaryGate(LOCKED_REPOSITORY_ROOT);
      const summary = result.summary;
      process.stdout.write([
        "PASS backend egress boundary gate",
        `required_files=${summary.requiredFiles}`,
        `production_java_files=${summary.productionJavaFiles}`,
        `resource_files=${summary.resourceFiles}`,
        `dependencies=${summary.dependencies}`,
        `relative_location_uris=${summary.relativeLocationUris}`,
        `production_http_client_files=${summary.productionHttpClientFiles}`,
        `outbound_allowlist_entries=${summary.outboundAllowlistEntries}`,
        `reviewed_network_config=${summary.reviewedNetworkConfig}`,
        `test_network_files=${summary.testNetworkFiles}`,
        `gate_tests=${summary.gateTests}`,
        "skipped=0",
      ].join("\n") + "\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
