import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIXED_IMAGES,
  evaluateComposeModels,
  evaluateExecutionSummary,
  evaluateImageEvidence,
  evaluatePrerequisites,
  evaluateRuntimeEvidence,
  evaluateSourceContracts,
} from "./container-runtime-security-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(SCRIPT_DIRECTORY, "container-runtime-security-gate.mjs");

function service(role, definitionName) {
  const definition = FIXED_IMAGES.find((value) => value.role === role);
  const value = {
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    tmpfs: [definition.tmpfs],
    healthcheck: {
      test: role === "backend"
        ? ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8080/actuator/health/readiness"]
        : ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8080/readyz"],
    },
  };
  if (role === "backend") {
    value.environment = {
      ERP_PRODUCT_IMAGES_ROOT: "/var/lib/xz-erp/product-images",
    };
    value.volumes = [{
      type: "volume",
      source: definitionName === "local"
        ? "erp_product_images"
        : "erp_staging_product_images",
      target: "/var/lib/xz-erp/product-images",
    }];
  }
  return value;
}

function composeModels() {
  return {
    local: {
      services: {
        backend: service("backend", "local"),
        web: {
          ...service("web", "local"),
          ports: ["127.0.0.1:${ERP_HTTP_PORT:-18888}:8080"],
        },
      },
    },
    delivery: {
      services: {
        backend: service("backend", "delivery"),
        web: {
          ...service("web", "delivery"),
          ports: ["127.0.0.1:${ERP_HTTP_PORT}:8080"],
        },
      },
    },
  };
}

function imageEvidence(role) {
  const definition = FIXED_IMAGES.find((value) => value.role === role);
  return {
    definition,
    id: `sha256:${"a".repeat(64)}`,
    config: {
      User: definition.user,
      Entrypoint: definition.entrypoint,
      Cmd: definition.cmd,
      ExposedPorts: Object.fromEntries(
        definition.ports.map((port) => [port, {}]),
      ),
    },
  };
}

function runtimeEvidence(role) {
  const definition = FIXED_IMAGES.find((value) => value.role === role);
  return {
    definition,
    hostConfig: {
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ["ALL"],
      CapAdd: null,
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: {
        "/tmp": definition.tmpfs.slice("/tmp:".length),
      },
    },
    exitCode: 0,
    values: {
      uid: "101",
      gid: "101",
      root_write: "no",
      app_write: "no",
      tmp_write: "yes",
      shadow_readable: "no",
      no_new_privs: "1",
      cap_eff: "0000000000000000",
      cap_bnd: "0000000000000000",
    },
  };
}

function codes(result) {
  return result.issues.map((value) => value.code);
}

function sourceContracts() {
  return {
    backendDockerfile: [
      "FROM runtime",
      "USER erp",
      "EXPOSE 8080",
      'ENTRYPOINT ["java", "-jar", "/app/app.jar"]',
    ].join("\n"),
    webDockerfile: [
      "FROM nginx",
      "RUN rewrite 'pid /tmp/nginx.pid;'",
      "USER nginx",
      "EXPOSE 8080",
    ].join("\n"),
    nginxConfig: [
      "client_body_temp_path /tmp/client_temp;",
      "proxy_temp_path /tmp/proxy_temp;",
      "fastcgi_temp_path /tmp/fastcgi_temp;",
      "uwsgi_temp_path /tmp/uwsgi_temp;",
      "scgi_temp_path /tmp/scgi_temp;",
      "server {",
      "    listen 8080;",
      "}",
    ].join("\n"),
  };
}

test("reviewed Dockerfile and Nginx source contracts pass", () => {
  const result = evaluateSourceContracts(sourceContracts());
  assert.deepEqual(result.issues, []);
  assert.equal(result.checks, 12);
});

test("root image, privileged listener, pid, and temporary path source drift fail closed", () => {
  const sources = sourceContracts();
  sources.backendDockerfile = sources.backendDockerfile.replace("USER erp", "USER root");
  sources.webDockerfile = sources.webDockerfile
    .replace("USER nginx", "USER root")
    .replace("EXPOSE 8080", "EXPOSE 80")
    .replace("pid /tmp/nginx.pid;", "pid /run/nginx.pid;");
  sources.nginxConfig = sources.nginxConfig
    .replace("listen 8080;", "listen 80;")
    .replace("proxy_temp_path /tmp/proxy_temp;", "proxy_temp_path /var/cache/nginx/proxy_temp;");
  assert.deepEqual(codes(evaluateSourceContracts(sources)), [
    "BACKEND_IMAGE_USER_SOURCE_DRIFT",
    "WEB_IMAGE_PORT_SOURCE_DRIFT",
    "WEB_IMAGE_USER_SOURCE_DRIFT",
    "WEB_LISTENER_SOURCE_DRIFT",
    "WEB_PID_BOUNDARY_SOURCE_DRIFT",
    "WEB_TEMP_PATH_SOURCE_DRIFT",
  ]);
});

test("reviewed local and delivery Compose application boundaries pass", () => {
  const first = evaluateComposeModels(composeModels());
  const second = evaluateComposeModels(composeModels());
  assert.deepEqual(first, second);
  assert.deepEqual(first.issues, []);
  assert.equal(first.checks, 40);
});

test("writable or privileged application containers fail closed", () => {
  const models = composeModels();
  models.local.services.backend.read_only = false;
  models.delivery.services.web.privileged = true;
  assert.deepEqual(codes(evaluateComposeModels(models)), [
    "PRIVILEGED_CONTAINER",
    "ROOTFS_NOT_READ_ONLY",
  ]);
});

test("capability additions and incomplete drops fail closed", () => {
  const models = composeModels();
  models.local.services.backend.cap_drop = [];
  models.local.services.backend.cap_add = ["SYS_ADMIN"];
  models.delivery.services.web.cap_drop = ["NET_BIND_SERVICE"];
  assert.deepEqual(codes(evaluateComposeModels(models)), [
    "CAPABILITIES_ADDED",
    "CAPABILITIES_NOT_DROPPED",
    "CAPABILITIES_NOT_DROPPED",
  ]);
});

test("missing NNP, tmpfs drift, volume drift, and root overrides fail closed", () => {
  const models = composeModels();
  models.local.services.backend.security_opt = [];
  models.local.services.web.tmpfs = ["/tmp:size=1g"];
  models.delivery.services.backend.volumes = [{ target: "/app" }];
  models.delivery.services.web.user = "root";
  assert.deepEqual(codes(evaluateComposeModels(models)), [
    "APPLICATION_VOLUME_DRIFT",
    "COMPOSE_ROOT_OVERRIDE",
    "NO_NEW_PRIVILEGES_MISSING",
    "TEMPORARY_BOUNDARY_DRIFT",
  ]);
});

test("missing product image storage root fails closed", () => {
  const models = composeModels();
  delete models.delivery.services.backend.environment.ERP_PRODUCT_IMAGES_ROOT;
  assert.deepEqual(codes(evaluateComposeModels(models)), [
    "PRODUCT_IMAGE_STORAGE_ROOT_DRIFT",
  ]);
});

test("port and readiness drift fail closed", () => {
  const models = composeModels();
  models.local.services.web.ports = ["0.0.0.0:18888:8080"];
  models.local.services.web.healthcheck.test = ["CMD", "true"];
  models.delivery.services.backend.healthcheck.test = ["CMD", "true"];
  assert.deepEqual(codes(evaluateComposeModels(models)), [
    "BACKEND_HEALTHCHECK_DRIFT",
    "WEB_HEALTHCHECK_DRIFT",
    "WEB_PORT_BOUNDARY_DRIFT",
  ]);
});

test("reviewed non-root fixed image metadata passes", () => {
  for (const role of ["backend", "web"]) {
    const result = evaluateImageEvidence(imageEvidence(role));
    assert.deepEqual(result.issues, []);
    assert.equal(result.checks, 6);
  }
});

test("root image identity and metadata drift fail closed", () => {
  const value = imageEvidence("web");
  value.config.User = "";
  value.config.Entrypoint = ["/unexpected"];
  value.config.Cmd = ["debug"];
  value.config.ExposedPorts = { "80/tcp": {} };
  assert.deepEqual(codes(evaluateImageEvidence(value)), [
    "IMAGE_CMD_DRIFT",
    "IMAGE_ENTRYPOINT_DRIFT",
    "IMAGE_PORT_DRIFT",
    "IMAGE_ROOT_USER",
    "IMAGE_USER_DRIFT",
  ]);
});

test("reviewed constrained runtime identity passes", () => {
  for (const role of ["backend", "web"]) {
    const result = evaluateRuntimeEvidence(runtimeEvidence(role));
    assert.deepEqual(result.issues, []);
    assert.equal(result.checks, 16);
  }
});

test("runtime UID, GID, rootfs, application, tmpfs, shadow, NNP, and caps fail closed", () => {
  const value = runtimeEvidence("web");
  value.values = {
    uid: "0",
    gid: "0",
    root_write: "yes",
    app_write: "yes",
    tmp_write: "no",
    shadow_readable: "yes",
    no_new_privs: "0",
    cap_eff: "0000000000000400",
    cap_bnd: "00000000a80425fb",
  };
  assert.deepEqual(codes(evaluateRuntimeEvidence(value)), [
    "APPLICATION_WRITE_SUCCEEDED",
    "CAPABILITIES_EFFECTIVE",
    "CAPABILITY_BOUNDING_SET_NOT_EMPTY",
    "NO_NEW_PRIVILEGES_INEFFECTIVE",
    "ROOTFS_WRITE_SUCCEEDED",
    "RUNTIME_ROOT_GID",
    "RUNTIME_ROOT_UID",
    "SENSITIVE_SYSTEM_FILE_READABLE",
    "TEMPORARY_BOUNDARY_UNUSABLE",
  ]);
});

test("runtime host security drift and probe failure fail closed", () => {
  const value = runtimeEvidence("backend");
  value.hostConfig.ReadonlyRootfs = false;
  value.hostConfig.Privileged = true;
  value.hostConfig.CapDrop = [];
  value.hostConfig.CapAdd = ["SYS_ADMIN"];
  value.hostConfig.SecurityOpt = [];
  value.hostConfig.Tmpfs = {};
  value.exitCode = 1;
  assert.deepEqual(codes(evaluateRuntimeEvidence(value)), [
    "CAPABILITIES_ADDED",
    "CAPABILITIES_NOT_DROPPED",
    "NO_NEW_PRIVILEGES_MISSING",
    "PRIVILEGED_CONTAINER",
    "ROOTFS_NOT_READ_ONLY",
    "RUNTIME_PROBE_FAILED",
    "TEMPORARY_BOUNDARY_DRIFT",
  ]);
});

test("missing Docker, wrong OS, and either fixed image are hard failures", () => {
  assert.deepEqual(
    codes({ issues: evaluatePrerequisites({
      dockerAvailable: false,
      dockerOs: undefined,
      images: {},
    }) }),
    ["DOCKER_UNAVAILABLE"],
  );
  assert.deepEqual(
    evaluatePrerequisites({
      dockerAvailable: true,
      dockerOs: "windows",
      images: { backend: false, web: false },
    }).map((value) => `${value.code}:${value.role ?? ""}`),
    [
      "DOCKER_OS_UNSUPPORTED:",
      "IMAGE_MISSING:backend",
      "IMAGE_MISSING:web",
    ],
  );
});

test("zero scope and skipped checks are explicit hard failures", () => {
  assert.deepEqual(
    codes({ issues: evaluateExecutionSummary({
      images: 0,
      composeFiles: 0,
      checks: 0,
      skipped: 1,
    }) }),
    ["ZERO_CHECKS", "SKIPPED_CHECKS"],
  );
});

test("the executable rejects external image and path input without echoing it", () => {
  const canary = "credential-canary-value-7Qz9";
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--image", canary],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(result.stderr, /7Qz9|credential-canary/);
});
