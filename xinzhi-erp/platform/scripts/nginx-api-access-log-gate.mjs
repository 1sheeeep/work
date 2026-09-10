import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const CONFIG_RELATIVE = "platform/frontend/nginx.conf";
const FORMAT_NAME = "api_access";
const EXPECTED_FORMAT =
  '{"time":"$time_iso8601","peer":"$remote_addr","method":"$request_method",'
  + '"path":"$uri","status":$status,"bytes":$body_bytes_sent,'
  + '"duration":$request_time}';
const EXPECTED_VARIABLES = new Set([
  "time_iso8601",
  "remote_addr",
  "request_method",
  "uri",
  "status",
  "body_bytes_sent",
  "request_time",
]);

export class NginxApiAccessLogGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "NginxApiAccessLogGateError";
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
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
    throw new NginxApiAccessLogGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const metadata = fs.lstatSync(resolved);
  const realRoot = fs.realpathSync.native(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realRoot !== resolved) {
    throw new NginxApiAccessLogGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical, non-symbolic absolute path",
      ),
    ]);
  }
  return realRoot;
}

function readLockedConfig(root) {
  const absolute = path.resolve(root, CONFIG_RELATIVE);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    throw new NginxApiAccessLogGateError([
      issue("CONFIG_MISSING", "the repository Nginx configuration is missing"),
    ]);
  }
  const metadata = fs.lstatSync(absolute);
  const real = fs.realpathSync.native(absolute);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || real !== absolute
    || !isWithin(root, real)
  ) {
    throw new NginxApiAccessLogGateError([
      issue(
        "CONFIG_ALIAS_REJECTED",
        "the repository Nginx configuration must be a non-symbolic regular file",
      ),
    ]);
  }
  return fs.readFileSync(absolute, "utf8");
}

function blockStartingAt(content, marker) {
  const start = content.indexOf(marker);
  if (start < 0) return "";
  const open = content.indexOf("{", start + marker.length);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return "";
}

function quotedFormat(body) {
  const fragments = [];
  for (const match of body.matchAll(/(["'])([\s\S]*?)\1/g)) {
    fragments.push(match[2]);
  }
  return fragments.join("");
}

function variables(body) {
  return [...body.matchAll(/\$([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

function isDangerousVariable(name) {
  return (
    [
      "request",
      "args",
      "is_args",
      "query_string",
      "request_body",
      "request_body_file",
      "request_filename",
      "document_uri",
      "document_root",
      "realpath_root",
      "remote_user",
      "proxy_host",
      "proxy_port",
      "server_addr",
    ].includes(name)
    || name.startsWith("http_")
    || name.startsWith("sent_http_")
    || name.startsWith("upstream_")
    || name.startsWith("arg_")
    || name.startsWith("cookie_")
    || /(?:credential|password|secret|token|authorization)/i.test(name)
  );
}

function inspectFormats(nginx, issues) {
  const directives = [...nginx.matchAll(
    /\blog_format\s+([A-Za-z0-9_]+)\s+([\s\S]*?);/g,
  )].map((match) => ({ name: match[1], body: match[2] }));
  const apiFormats = directives.filter((value) => value.name === FORMAT_NAME);

  if (apiFormats.length !== 1) {
    issues.push(issue(
      "API_LOG_FORMAT_COUNT",
      `exactly one ${FORMAT_NAME} log format is required`,
    ));
  } else {
    const format = apiFormats[0];
    if (!/^\s*escape=json\b/.test(format.body)) {
      issues.push(issue(
        "API_LOG_ESCAPE_CHANGED",
        "the API access log must retain Nginx JSON escaping",
      ));
    }
    if (quotedFormat(format.body) !== EXPECTED_FORMAT) {
      issues.push(issue(
        "API_LOG_SCHEMA_CHANGED",
        "the API access-log schema differs from the approved minimal schema",
      ));
    }
    const actualVariables = variables(format.body);
    if (
      actualVariables.length !== EXPECTED_VARIABLES.size
      || actualVariables.some((name) => !EXPECTED_VARIABLES.has(name))
      || new Set(actualVariables).size !== EXPECTED_VARIABLES.size
    ) {
      issues.push(issue(
        "API_LOG_VARIABLE_SET_CHANGED",
        "the API access log must contain only the approved variable set",
      ));
    }
  }

  for (const directive of directives) {
    const forbidden = [...new Set(
      variables(directive.body).filter(isDangerousVariable),
    )].sort((left, right) => left.localeCompare(right, "en"));
    if (forbidden.length > 0) {
      issues.push(issue(
        "DANGEROUS_LOG_VARIABLE",
        `log format ${directive.name} contains prohibited request data`,
      ));
    }
  }
  return directives.length;
}

function inspectServerLogging(nginx, issues) {
  const server = blockStartingAt(nginx, "server {");
  const firstLocation = server.search(/^\s*location\b/m);
  const serverPrelude = firstLocation < 0
    ? server
    : server.slice(0, firstLocation);
  const serverLogs = [...serverPrelude.matchAll(/\baccess_log\s+([^;]+);/g)]
    .map((match) => match[1].trim().replace(/\s+/g, " "));
  if (
    serverLogs.length !== 1
    || serverLogs[0] !== `/var/log/nginx/access.log ${FORMAT_NAME}`
  ) {
    issues.push(issue(
      "SERVER_LOG_BINDING_CHANGED",
      "the server default must use only the redacted format at the image access-log destination",
    ));
  }

  for (const match of nginx.matchAll(/\baccess_log\s+([^;]+);/g)) {
    const binding = match[1].trim().replace(/\s+/g, " ");
    if (
      binding !== "off"
      && binding !== `/var/log/nginx/access.log ${FORMAT_NAME}`
    ) {
      issues.push(issue(
        "UNSAFE_LOG_BINDING",
        "every enabled access log must use the approved redacted format",
      ));
    }
  }

  const apiLocations = [...nginx.matchAll(
    /^\s*location\s+[^\r\n{]*\/api(?:\/|\b)[^\r\n{]*\{/gm,
  )];
  if (apiLocations.length !== 2) {
    issues.push(issue(
      "API_LOCATION_COUNT",
      "the /api namespace must contain one proxy and one nested actuator deny",
    ));
  }
  if (!/^\s*location\s+\^~\s+\/api\/\s*\{/m.test(nginx)) {
    issues.push(issue(
      "API_LOCATION_CHANGED",
      "the repository edge must retain the ^~ /api/ prefix location",
    ));
  }
  const api = blockStartingAt(nginx, "location ^~ /api/");
  if (api === "") {
    issues.push(issue("API_LOCATION_MISSING", "the /api/ proxy location is missing"));
    return;
  }
  if (/\baccess_log\s+/.test(api)) {
    issues.push(issue(
      "API_LOG_OVERRIDE",
      "the /api/ location must inherit the server-wide redacted access log",
    ));
  }
  for (const [label, block] of [
    [
      "root actuator",
      blockStartingAt(nginx, "location ~* ^/actuator(?:/|$)"),
    ],
    [
      "API actuator",
      blockStartingAt(api, "location ~* ^/api/actuator(?:/|$)"),
    ],
  ]) {
    if (
      block === ""
      || /\baccess_log\s+off\s*;/.test(block)
      || !/return\s+404\s+"not found\\n"\s*;/.test(block)
    ) {
      issues.push(issue(
        "ACTUATOR_LOG_BOUNDARY_CHANGED",
        `${label} probes must fail closed and inherit the redacted access log`,
      ));
    }
  }
}

function inspectProbeLogging(nginx, issues) {
  for (const [label, marker] of [
    ["healthz", "location = /healthz"],
    ["readyz", "location = /readyz"],
    ["readyz variants", "location ~* ^/readyz"],
    ["readiness fallback", "location @readiness_unavailable"],
  ]) {
    const block = blockStartingAt(nginx, marker);
    if (block === "" || !/\baccess_log\s+off\s*;/.test(block)) {
      issues.push(issue(
        "PROBE_LOGGING_CHANGED",
        `${label} must retain access_log off`,
      ));
    }
  }
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

export function inspectNginxApiAccessLog(repositoryRoot) {
  const root = validateRoot(repositoryRoot);
  const nginx = readLockedConfig(root);
  const issues = [];
  const logFormats = inspectFormats(nginx, issues);
  inspectServerLogging(nginx, issues);
  inspectProbeLogging(nginx, issues);
  return {
    root,
    issues: sortedUnique(issues),
    summary: {
      files: 1,
      logFormats,
      allowedFields: EXPECTED_VARIABLES.size,
      skipped: 0,
    },
  };
}

export function runNginxApiAccessLogGate(repositoryRoot) {
  const result = inspectNginxApiAccessLog(repositoryRoot);
  if (result.issues.length > 0) {
    throw new NginxApiAccessLogGateError(result.issues);
  }
  return result;
}

function printFailure(error) {
  const issues = error instanceof NginxApiAccessLogGateError
    ? error.issues
    : [issue("GATE_INTERNAL_ERROR", "the Nginx API access-log gate could not complete")];
  process.stderr.write([
    "FAIL Nginx API access-log gate",
    ...issues.map((value) => `[${value.code}] ${value.message}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new NginxApiAccessLogGateError([
      issue(
        "EXTERNAL_INPUT_REJECTED",
        "the gate accepts no path, URL, environment, credential, or other input",
      ),
    ]));
    process.exitCode = 2;
  } else {
    try {
      const result = runNginxApiAccessLogGate(LOCKED_REPOSITORY_ROOT);
      process.stdout.write([
        "PASS Nginx API access-log gate",
        `files=${result.summary.files}`,
        `log_formats=${result.summary.logFormats}`,
        `allowed_fields=${result.summary.allowedFields}`,
        "skipped=0",
      ].join("\n") + "\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
