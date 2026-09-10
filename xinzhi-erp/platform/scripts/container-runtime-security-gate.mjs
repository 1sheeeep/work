import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..");
const DOCKER_CONTEXT = "desktop-linux";

export const FIXED_IMAGES = Object.freeze([
  Object.freeze({
    role: "backend",
    reference: "xz-erp-local-backend:latest",
    user: "erp",
    ports: ["8080/tcp"],
    entrypoint: ["java", "-jar", "/app/app.jar"],
    cmd: null,
    appRoot: "/app",
    tmpfs: "/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
  }),
  Object.freeze({
    role: "web",
    reference: "xz-erp-local-web:latest",
    user: "nginx",
    ports: ["80/tcp", "8080/tcp"],
    entrypoint: ["/docker-entrypoint.sh"],
    cmd: ["nginx", "-g", "daemon off;"],
    appRoot: "/usr/share/nginx/html",
    tmpfs: "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
  }),
]);

const COMPOSE_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "local",
    file: "platform/compose.yaml",
    webPort: "127.0.0.1:${ERP_HTTP_PORT:-18888}:8080",
    productImagesVolume: "erp_product_images",
  }),
  Object.freeze({
    name: "delivery",
    file: "platform/infra/staging/compose.staging.yaml",
    webPort: "127.0.0.1:${ERP_HTTP_PORT}:8080",
    productImagesVolume: "erp_staging_product_images",
  }),
]);

const PRODUCT_IMAGES_TARGET = "/var/lib/xz-erp/product-images";

function issue(code, message, role) {
  return role ? { code, message, role } : { code, message };
}

function sortedUnique(values) {
  const seen = new Set();
  return values
    .sort((left, right) =>
      `${left.code}:${left.role ?? ""}`.localeCompare(
        `${right.code}:${right.role ?? ""}`,
      ))
    .filter((value) => {
      const key = `${value.code}:${value.role ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export class ContainerRuntimeSecurityGateError extends Error {
  constructor(issues) {
    super("container runtime security gate failed");
    this.name = "ContainerRuntimeSecurityGateError";
    this.issues = sortedUnique(issues);
  }
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    if (options.allowFailure) return { status: null, stdout: "", stderr: "" };
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${executable} exited with status ${result.status}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function docker(args, options) {
  return command("docker", ["--context", DOCKER_CONTEXT, ...args], options);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ContainerRuntimeSecurityGateError([
      issue("INVALID_INSPECTION_OUTPUT", "Docker returned invalid inspection output"),
    ]);
  }
}

function equalArray(actual, expected) {
  return JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);
}

function lockedFile(relativePath) {
  const absolute = path.resolve(REPOSITORY_ROOT, relativePath);
  const relative = path.relative(REPOSITORY_ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ContainerRuntimeSecurityGateError([
      issue("REPOSITORY_BOUNDARY_INVALID", "a locked source escaped the repository"),
    ]);
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ContainerRuntimeSecurityGateError([
      issue("SYMBOLIC_SOURCE_REJECTED", "a locked source is not a regular file"),
    ]);
  }
  return absolute;
}

function composeModel(definition) {
  const result = docker([
    "compose",
    "--file",
    lockedFile(definition.file),
    "config",
    "--no-env-resolution",
    "--no-interpolate",
    "--format",
    "json",
  ], { allowFailure: true });
  if (result.status !== 0) {
    throw new ContainerRuntimeSecurityGateError([
      issue("COMPOSE_CONFIG_INVALID", "a locked Compose file could not be normalized", definition.name),
    ]);
  }
  return parseJson(result.stdout);
}

function normalizedUpper(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value).toUpperCase()).sort()
    : [];
}

function serviceIssues(service, role, definition) {
  const issues = [];
  const definitionName = definition.name;
  const scopedRole = `${definitionName}:${role}`;
  const expectedTmpfs = FIXED_IMAGES.find((value) => value.role === role).tmpfs;
  if (!service || typeof service !== "object") {
    return [issue("APPLICATION_SERVICE_MISSING", "an application service is missing", scopedRole)];
  }
  if (service.read_only !== true) {
    issues.push(issue("ROOTFS_NOT_READ_ONLY", "application rootfs is not read-only", scopedRole));
  }
  if (service.privileged === true) {
    issues.push(issue("PRIVILEGED_CONTAINER", "application service is privileged", scopedRole));
  }
  if (normalizedUpper(service.cap_drop).join(",") !== "ALL") {
    issues.push(issue("CAPABILITIES_NOT_DROPPED", "application service does not drop all capabilities", scopedRole));
  }
  if (Array.isArray(service.cap_add) && service.cap_add.length > 0) {
    issues.push(issue("CAPABILITIES_ADDED", "application service adds Linux capabilities", scopedRole));
  }
  const securityOptions = Array.isArray(service.security_opt)
    ? service.security_opt.map((value) => String(value).toLowerCase())
    : [];
  if (!securityOptions.some((value) => value === "no-new-privileges:true")) {
    issues.push(issue("NO_NEW_PRIVILEGES_MISSING", "no-new-privileges is not enabled", scopedRole));
  }
  if (!equalArray(service.tmpfs, [expectedTmpfs])) {
    issues.push(issue("TEMPORARY_BOUNDARY_DRIFT", "the only writable tmpfs boundary is not the reviewed /tmp mount", scopedRole));
  }
  const expectedVolumes = role === "backend"
    ? [{ type: "volume", source: definition.productImagesVolume, target: PRODUCT_IMAGES_TARGET }]
    : [];
  const actualVolumes = Array.isArray(service.volumes)
    ? service.volumes.map(({ type, source, target }) => ({ type, source, target }))
    : [];
  if (!equalArray(actualVolumes, expectedVolumes)) {
    issues.push(issue("APPLICATION_VOLUME_DRIFT", "application writable volume boundary drifted", scopedRole));
  }
  if (role === "backend"
      && service.environment?.ERP_PRODUCT_IMAGES_ROOT !== PRODUCT_IMAGES_TARGET) {
    issues.push(issue("PRODUCT_IMAGE_STORAGE_ROOT_DRIFT", "product image storage root is not bound to the reviewed volume", scopedRole));
  }
  if (service.user === "0" || service.user === "root" || service.user === 0) {
    issues.push(issue("COMPOSE_ROOT_OVERRIDE", "Compose overrides the image identity to root", scopedRole));
  }
  return issues;
}

export function evaluateComposeModels(models) {
  const issues = [];
  let checks = 0;
  for (const definition of COMPOSE_DEFINITIONS) {
    const model = models[definition.name];
    const services = model?.services ?? {};
    for (const role of ["backend", "web"]) {
      issues.push(...serviceIssues(services[role], role, definition));
      checks += role === "backend" ? 9 : 8;
    }
    const web = services.web ?? {};
    if (!equalArray(web.ports, [definition.webPort])) {
      issues.push(issue("WEB_PORT_BOUNDARY_DRIFT", "Web is not loopback-published to the reviewed internal port", definition.name));
    }
    checks += 1;
    const webHealth = web.healthcheck?.test;
    if (!equalArray(webHealth, [
      "CMD-SHELL",
      "wget -q --spider http://127.0.0.1:8080/readyz",
    ])) {
      issues.push(issue("WEB_HEALTHCHECK_DRIFT", "Web readiness healthcheck drifted", definition.name));
    }
    const backendHealth = services.backend?.healthcheck?.test;
    if (!equalArray(backendHealth, [
      "CMD-SHELL",
      "wget -q --spider http://127.0.0.1:8080/actuator/health/readiness",
    ])) {
      issues.push(issue("BACKEND_HEALTHCHECK_DRIFT", "backend readiness healthcheck drifted", definition.name));
    }
    checks += 2;
  }
  return { issues: sortedUnique(issues), checks };
}

export function evaluateSourceContracts(sources) {
  const issues = [];
  let checks = 0;
  const check = (condition, code, message, role) => {
    checks += 1;
    if (!condition) issues.push(issue(code, message, role));
  };
  const backend = sources.backendDockerfile ?? "";
  const web = sources.webDockerfile ?? "";
  const nginx = sources.nginxConfig ?? "";
  check(/^USER erp$/m.test(backend), "BACKEND_IMAGE_USER_SOURCE_DRIFT", "backend Dockerfile no longer selects the reviewed non-root user", "backend");
  check(/^EXPOSE 8080$/m.test(backend), "BACKEND_IMAGE_PORT_SOURCE_DRIFT", "backend Dockerfile port drifted", "backend");
  check(/^ENTRYPOINT \["java", "-jar", "\/app\/app\.jar"\]$/m.test(backend), "BACKEND_IMAGE_COMMAND_SOURCE_DRIFT", "backend Dockerfile entrypoint drifted", "backend");
  check(/^USER nginx$/m.test(web), "WEB_IMAGE_USER_SOURCE_DRIFT", "Web Dockerfile no longer selects the reviewed non-root user", "web");
  check(/^EXPOSE 8080$/m.test(web), "WEB_IMAGE_PORT_SOURCE_DRIFT", "Web Dockerfile port drifted", "web");
  check(/pid \/tmp\/nginx\.pid;/.test(web), "WEB_PID_BOUNDARY_SOURCE_DRIFT", "Web Dockerfile no longer redirects the Nginx pid to /tmp", "web");
  check(/^\s*listen 8080;$/m.test(nginx), "WEB_LISTENER_SOURCE_DRIFT", "Nginx no longer listens on the reviewed unprivileged port", "web");
  for (const directive of [
    "client_body_temp_path /tmp/client_temp;",
    "proxy_temp_path /tmp/proxy_temp;",
    "fastcgi_temp_path /tmp/fastcgi_temp;",
    "uwsgi_temp_path /tmp/uwsgi_temp;",
    "scgi_temp_path /tmp/scgi_temp;",
  ]) {
    check(
      nginx.split(directive).length === 2,
      "WEB_TEMP_PATH_SOURCE_DRIFT",
      "Nginx temporary paths are not exclusively rooted in /tmp",
      "web",
    );
  }
  return { issues: sortedUnique(issues), checks };
}

export function evaluateImageEvidence(evidence) {
  const { definition, config } = evidence;
  const issues = [];
  let checks = 0;
  const check = (condition, code, message) => {
    checks += 1;
    if (!condition) issues.push(issue(code, message, definition.role));
  };
  check(
    typeof evidence.id === "string" && /^sha256:[a-f0-9]{64}$/.test(evidence.id),
    "IMAGE_ID_INVALID",
    "the fixed image did not resolve to an immutable ID",
  );
  check(config.User === definition.user, "IMAGE_USER_DRIFT", "the final image user is not the reviewed non-root identity");
  check(config.User !== "" && config.User !== "0" && config.User !== "root", "IMAGE_ROOT_USER", "the final image is configured as root");
  check(equalArray(config.Entrypoint, definition.entrypoint), "IMAGE_ENTRYPOINT_DRIFT", "the final image entrypoint drifted");
  check(equalArray(config.Cmd, definition.cmd), "IMAGE_CMD_DRIFT", "the final image command drifted");
  check(
    equalArray(Object.keys(config.ExposedPorts ?? {}).sort(), definition.ports),
    "IMAGE_PORT_DRIFT",
    "the final image exposed port drifted",
  );
  return { issues: sortedUnique(issues), checks };
}

export function evaluateRuntimeEvidence(evidence) {
  const issues = [];
  let checks = 0;
  const role = evidence.definition.role;
  const check = (condition, code, message) => {
    checks += 1;
    if (!condition) issues.push(issue(code, message, role));
  };
  const host = evidence.hostConfig ?? {};
  const values = evidence.values ?? {};
  check(host.ReadonlyRootfs === true, "ROOTFS_NOT_READ_ONLY", "runtime rootfs is not read-only");
  check(host.Privileged === false, "PRIVILEGED_CONTAINER", "runtime container is privileged");
  check(normalizedUpper(host.CapDrop).join(",") === "ALL", "CAPABILITIES_NOT_DROPPED", "runtime does not drop all capabilities");
  check(!Array.isArray(host.CapAdd) || host.CapAdd.length === 0, "CAPABILITIES_ADDED", "runtime adds capabilities");
  check(
    Array.isArray(host.SecurityOpt)
      && host.SecurityOpt.some((value) => String(value).toLowerCase().startsWith("no-new-privileges")),
    "NO_NEW_PRIVILEGES_MISSING",
    "runtime does not enable no-new-privileges",
  );
  check(host.Tmpfs?.["/tmp"] === evidence.definition.tmpfs.slice("/tmp:".length), "TEMPORARY_BOUNDARY_DRIFT", "runtime tmpfs options drifted");
  check(evidence.exitCode === 0, "RUNTIME_PROBE_FAILED", "runtime identity probe failed");
  check(values.uid !== "0" && /^\d+$/.test(values.uid ?? ""), "RUNTIME_ROOT_UID", "runtime process executes as UID 0");
  check(values.gid !== "0" && /^\d+$/.test(values.gid ?? ""), "RUNTIME_ROOT_GID", "runtime process executes as GID 0");
  check(values.root_write === "no", "ROOTFS_WRITE_SUCCEEDED", "runtime process wrote outside the temporary boundary");
  check(values.app_write === "no", "APPLICATION_WRITE_SUCCEEDED", "runtime process wrote to application content");
  check(values.tmp_write === "yes", "TEMPORARY_BOUNDARY_UNUSABLE", "runtime process could not write the reviewed /tmp boundary");
  check(values.shadow_readable === "no", "SENSITIVE_SYSTEM_FILE_READABLE", "runtime process can read /etc/shadow");
  check(values.no_new_privs === "1", "NO_NEW_PRIVILEGES_INEFFECTIVE", "no-new-privileges is not effective");
  check(/^0+$/.test(values.cap_eff ?? ""), "CAPABILITIES_EFFECTIVE", "runtime retains effective capabilities");
  check(/^0+$/.test(values.cap_bnd ?? ""), "CAPABILITY_BOUNDING_SET_NOT_EMPTY", "runtime retains a capability bounding set");
  return { issues: sortedUnique(issues), checks };
}

function parseProbe(output) {
  return Object.fromEntries(
    output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf("=");
      return separator > 0
        ? [line.slice(0, separator), line.slice(separator + 1)]
        : ["invalid", "yes"];
    }),
  );
}

function runtimeEvidence(definition) {
  const name = `xz-erp-runtime-gate-${definition.role}-${randomUUID()}`;
  let created = false;
  try {
    const script = [
      "set -eu",
      "root_write=no",
      "app_write=no",
      "tmp_write=no",
      "shadow_readable=no",
      "touch /.xz-erp-runtime-gate 2>/dev/null && root_write=yes && rm -f /.xz-erp-runtime-gate",
      `touch ${definition.appRoot}/.xz-erp-runtime-gate 2>/dev/null && app_write=yes && rm -f ${definition.appRoot}/.xz-erp-runtime-gate`,
      "touch /tmp/.xz-erp-runtime-gate 2>/dev/null && tmp_write=yes && rm -f /tmp/.xz-erp-runtime-gate",
      "[ -r /etc/shadow ] && shadow_readable=yes || true",
      "printf 'uid=%s\\n' \"$(id -u)\"",
      "printf 'gid=%s\\n' \"$(id -g)\"",
      "printf 'root_write=%s\\n' \"$root_write\"",
      "printf 'app_write=%s\\n' \"$app_write\"",
      "printf 'tmp_write=%s\\n' \"$tmp_write\"",
      "printf 'shadow_readable=%s\\n' \"$shadow_readable\"",
      "awk '/^NoNewPrivs:/{print \"no_new_privs=\" $2}' /proc/self/status",
      "awk '/^CapEff:/{print \"cap_eff=\" $2}' /proc/self/status",
      "awk '/^CapBnd:/{print \"cap_bnd=\" $2}' /proc/self/status",
    ].join("; ");
    const create = docker([
      "create",
      "--pull=never",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--tmpfs",
      definition.tmpfs,
      "--entrypoint",
      "/bin/sh",
      definition.reference,
      "-c",
      script,
    ], { allowFailure: true });
    if (create.status !== 0) {
      return { definition, hostConfig: {}, values: {}, exitCode: null };
    }
    created = true;
    const container = parseJson(docker(["inspect", name]).stdout)[0];
    const start = docker(["start", "--attach", name], { allowFailure: true });
    const completed = parseJson(docker(["inspect", name]).stdout)[0];
    return {
      definition,
      hostConfig: container.HostConfig,
      values: parseProbe(start.stdout),
      exitCode: completed.State?.ExitCode,
    };
  } finally {
    if (created) docker(["rm", "--force", name], { allowFailure: true });
  }
}

export function evaluatePrerequisites({ dockerAvailable, dockerOs, images }) {
  if (!dockerAvailable) {
    return [issue("DOCKER_UNAVAILABLE", "Docker Desktop Linux is unavailable")];
  }
  const issues = [];
  if (dockerOs !== "linux") {
    issues.push(issue("DOCKER_OS_UNSUPPORTED", "the fixed Docker context is not a Linux engine"));
  }
  for (const definition of FIXED_IMAGES) {
    if (images[definition.role] !== true) {
      issues.push(issue("IMAGE_MISSING", "a fixed local image is missing", definition.role));
    }
  }
  return sortedUnique(issues);
}

export function evaluateExecutionSummary(summary) {
  const issues = [];
  if (summary.checks <= 0 || summary.images !== FIXED_IMAGES.length || summary.composeFiles !== COMPOSE_DEFINITIONS.length) {
    issues.push(issue("ZERO_CHECKS", "the gate did not execute its complete fixed scope"));
  }
  if (summary.skipped !== 0) {
    issues.push(issue("SKIPPED_CHECKS", "the gate skipped one or more checks"));
  }
  return issues;
}

export function inspectContainerRuntimeSecurity() {
  const daemon = docker(["version", "--format", "{{json .Server}}"], { allowFailure: true });
  const server = daemon.status === 0 ? parseJson(daemon.stdout.trim()) : null;
  const images = {};
  const imageInspections = {};
  for (const definition of FIXED_IMAGES) {
    const result = docker(["image", "inspect", definition.reference], { allowFailure: true });
    images[definition.role] = result.status === 0;
    if (result.status === 0) imageInspections[definition.role] = parseJson(result.stdout)[0];
  }
  const prerequisiteIssues = evaluatePrerequisites({
    dockerAvailable: daemon.status === 0,
    dockerOs: server?.Os,
    images,
  });
  if (prerequisiteIssues.length > 0) {
    throw new ContainerRuntimeSecurityGateError(prerequisiteIssues);
  }

  const models = Object.fromEntries(
    COMPOSE_DEFINITIONS.map((definition) => [definition.name, composeModel(definition)]),
  );
  const sourceResult = evaluateSourceContracts({
    backendDockerfile: fs.readFileSync(lockedFile("platform/backend/Dockerfile"), "utf8"),
    webDockerfile: fs.readFileSync(lockedFile("platform/frontend/Dockerfile"), "utf8"),
    nginxConfig: fs.readFileSync(lockedFile("platform/frontend/nginx.conf"), "utf8"),
  });
  const composeResult = evaluateComposeModels(models);
  const imageResults = FIXED_IMAGES.map((definition) => {
    const inspected = imageInspections[definition.role];
    return evaluateImageEvidence({
      definition,
      id: inspected.Id,
      config: inspected.Config ?? {},
    });
  });
  const runtimeResults = FIXED_IMAGES.map((definition) =>
    evaluateRuntimeEvidence(runtimeEvidence(definition)));
  return {
    issues: sortedUnique([
      ...sourceResult.issues,
      ...composeResult.issues,
      ...imageResults.flatMap((result) => result.issues),
      ...runtimeResults.flatMap((result) => result.issues),
    ]),
    summary: {
      images: FIXED_IMAGES.length,
      composeFiles: COMPOSE_DEFINITIONS.length,
      checks:
        sourceResult.checks
        + composeResult.checks
        + imageResults.reduce((total, result) => total + result.checks, 0)
        + runtimeResults.reduce((total, result) => total + result.checks, 0),
      skipped: 0,
    },
  };
}

export function runContainerRuntimeSecurityGate() {
  const result = inspectContainerRuntimeSecurity();
  const executionIssues = evaluateExecutionSummary(result.summary);
  if (executionIssues.length > 0 || result.issues.length > 0) {
    throw new ContainerRuntimeSecurityGateError([
      ...executionIssues,
      ...result.issues,
    ]);
  }
  return result;
}

function printFailure(error) {
  const issues = error instanceof ContainerRuntimeSecurityGateError
    ? error.issues
    : [issue("GATE_INTERNAL_ERROR", "container runtime security gate could not complete")];
  process.stderr.write([
    "FAIL container runtime security gate",
    ...issues.map((value) =>
      `[${value.code}] ${value.message}${value.role ? ` (${value.role})` : ""}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new ContainerRuntimeSecurityGateError([
      issue("EXTERNAL_INPUT_REJECTED", "the gate accepts no image, path, environment, credential, or other input"),
    ]));
    process.exitCode = 2;
  } else {
    try {
      const result = runContainerRuntimeSecurityGate();
      process.stdout.write([
        "PASS container runtime security gate",
        `images=${result.summary.images}`,
        `compose_files=${result.summary.composeFiles}`,
        `checks=${result.summary.checks}`,
        "skipped=0",
      ].join("\n") + "\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = error instanceof ContainerRuntimeSecurityGateError ? 1 : 2;
    }
  }
}
