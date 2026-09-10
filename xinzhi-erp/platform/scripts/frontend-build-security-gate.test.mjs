import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FrontendBuildSecurityGateError,
  inspectFrontendBuildSecurity,
  runFrontendBuildSecurityGate,
} from "./frontend-build-security-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const SCRIPT_PATH = path.join(
  REPOSITORY_ROOT,
  "platform/scripts/frontend-build-security-gate.mjs",
);
const NGINX_RELATIVE = "platform/frontend/nginx.conf";
const DIST_RELATIVE = "platform/frontend/dist";
const temporaryRoots = [];

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function fixture() {
  const root = temporaryDirectory("xz-erp-frontend-build-gate-");
  const nginx = path.join(root, NGINX_RELATIVE);
  fs.mkdirSync(path.dirname(nginx), { recursive: true });
  fs.copyFileSync(path.join(REPOSITORY_ROOT, NGINX_RELATIVE), nginx);
  write(
    root,
    "platform/frontend/package-lock.json",
    JSON.stringify({
      packages: {
        "node_modules/@tanstack/react-router": { version: "1.170.18" },
        "node_modules/@tanstack/router-core": { version: "1.171.15" },
      },
    }),
  );
  write(
    root,
    "platform/frontend/vite.config.ts",
    "export default {server:{proxy:{'/api':'http://localhost:8080'}}};",
  );
  write(
    root,
    "platform/frontend/src/main.tsx",
    "fetch('/api/v1/system/info');",
  );
  write(
    root,
    `${DIST_RELATIVE}/index.html`,
    [
      "<!doctype html>",
      '<html lang="zh-CN"><head>',
      '<link rel="stylesheet" href="/assets/app-A1b2C3.css">',
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="manifest" href="/manifest.webmanifest">',
      "</head><body><div id=\"root\"></div>",
      '<script type="module" src="/assets/app-A1b2C3.js"></script>',
      "</body></html>",
    ].join(""),
  );
  write(
    root,
    `${DIST_RELATIVE}/assets/app-A1b2C3.js`,
    [
      'import "./chunk-D4e5F6.js";',
      "const router={origin:null,update(){",
      "this.origin||(window?.origin&&window.origin!==`null`",
      "?this.origin=window.origin:this.origin=`http://localhost`)",
      "}};document.querySelector(\"#root\");",
    ].join(""),
  );
  write(
    root,
    `${DIST_RELATIVE}/assets/chunk-D4e5F6.js`,
    "export const ready=true;",
  );
  write(
    root,
    `${DIST_RELATIVE}/assets/app-A1b2C3.css`,
    "body{color:#123;background-image:url('/assets/pixel-A1b2C3.png')}",
  );
  write(
    root,
    `${DIST_RELATIVE}/manifest.webmanifest`,
    JSON.stringify({
      name: "XZ ERP",
      icons: [{ src: "/assets/icon-A1b2C3.svg", type: "image/svg+xml" }],
    }),
  );
  write(
    root,
    `${DIST_RELATIVE}/assets/icon-A1b2C3.svg`,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
  );
  const pixel = path.join(root, DIST_RELATIVE, "assets/pixel-A1b2C3.png");
  fs.writeFileSync(pixel, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(
    path.join(root, DIST_RELATIVE, "favicon.ico"),
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
  );
  return root;
}

function appendToMain(root, content) {
  const target = path.join(root, DIST_RELATIVE, "assets/app-A1b2C3.js");
  fs.appendFileSync(target, content, "utf8");
}

function editFile(root, relative, transform) {
  const target = path.join(root, relative);
  const original = fs.readFileSync(target, "utf8");
  const changed = transform(original);
  assert.notEqual(changed, original, `fixture edit must change ${relative}`);
  fs.writeFileSync(target, changed, "utf8");
}

function editNginx(root, transform) {
  editFile(root, NGINX_RELATIVE, transform);
}

function expectIssue(root, code) {
  assert.throws(
    () => runFrontendBuildSecurityGate(root),
    (error) =>
      error instanceof FrontendBuildSecurityGateError
      && error.issues.some((value) => value.code === code),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a bounded same-origin production build and reviewed Nginx policy pass", () => {
  const root = fixture();
  const first = runFrontendBuildSecurityGate(root);
  const second = runFrontendBuildSecurityGate(root);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.summary, {
    files: 8,
    bytes: 739,
    textFiles: 6,
    references: 7,
    nginxFiles: 1,
    sourceFiles: 1,
    acceptedDependencyConstants: 1,
    skipped: 0,
  });
});

test("the accepted TanStack fallback is version, context, count, and source locked", async (t) => {
  await t.test("react-router version drift", () => {
    const root = fixture();
    editFile(
      root,
      "platform/frontend/package-lock.json",
      (content) => content.replace("1.170.18", "1.170.19"),
    );
    expectIssue(root, "DEPENDENCY_CONSTANT_PROVENANCE");
  });
  await t.test("router-core version drift", () => {
    const root = fixture();
    editFile(
      root,
      "platform/frontend/package-lock.json",
      (content) => content.replace("1.171.15", "1.171.16"),
    );
    expectIssue(root, "DEPENDENCY_CONSTANT_PROVENANCE");
  });
  await t.test("fallback context drift", () => {
    const root = fixture();
    editFile(
      root,
      `${DIST_RELATIVE}/assets/app-A1b2C3.js`,
      (content) => content.replace("window?.origin", "window?.location"),
    );
    expectIssue(root, "DEPENDENCY_CONSTANT_CONTEXT");
  });
  await t.test("second localhost", () => {
    const root = fixture();
    appendToMain(root, "\nconst unexpected='localhost';");
    expectIssue(root, "DEPENDENCY_CONSTANT_COUNT");
  });
  await t.test("product source endpoint", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/api/unsafe.ts",
      "fetch('http://localhost:8080/api/v1/orders');",
    );
    expectIssue(root, "PRODUCT_LOCAL_ENDPOINT");
  });
  await t.test("product external request configuration", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/api/unsafe.ts",
      "export const endpoint='https://api.dev.invalid/api';",
    );
    expectIssue(root, "PRODUCT_EXTERNAL_REQUEST_CONFIG");
  });
  await t.test("redirect parser sentinel is not an outbound request base", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/auth/redirects.ts",
      [
        "const target=new URL(value, 'https://erp.local');",
        "if(target.origin !== 'https://erp.local') throw new Error();",
      ].join(""),
    );
    assert.deepEqual(runFrontendBuildSecurityGate(root).issues, []);
  });
  await t.test("shop return parser sentinel is not an outbound request base", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/pages/ShopDetailPage.tsx",
      [
        "const base=new URL('https://erp.local');",
        "const target=new URL(candidate,base);",
        "if(target.origin!==base.origin) throw new Error();",
      ].join(""),
    );
    assert.deepEqual(runFrontendBuildSecurityGate(root).issues, []);
  });
  await t.test("reviewed customer-service new-window configuration passes", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/modules/customerServiceEntry.ts",
      [
        "if (!import.meta.env.DEV) return null;",
        "const configured=import.meta.env.VITE_CUSTOMER_SERVICE_WORKBENCH_URL;",
        "const loopback = target.hostname === \"127.0.0.1\" || target.hostname === \"localhost\";",
      ].join(""),
    );
    assert.deepEqual(runFrontendBuildSecurityGate(root).issues, []);
  });
  await t.test("an extra customer-service endpoint fails outside the reviewed new-window configuration", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/modules/customerServiceEntry.ts",
      [
        "if (!import.meta.env.DEV) return null;",
        "const configured=import.meta.env.VITE_CUSTOMER_SERVICE_WORKBENCH_URL;",
        "const loopback = target.hostname === \"127.0.0.1\" || target.hostname === \"localhost\";",
        "fetch('http://127.0.0.1:8787/api/v1/shops');",
      ].join(""),
    );
    expectIssue(root, "PRODUCT_LOCAL_ENDPOINT");
  });
  await t.test("the order URL input placeholder is not treated as request configuration", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/pages/OrderCenterPage.tsx",
      '<input placeholder="https://…" type="url" />',
    );
    assert.deepEqual(runFrontendBuildSecurityGate(root).issues, []);
  });
  await t.test("an extra URL beside the redirect parser sentinel fails", () => {
    const root = fixture();
    write(
      root,
      "platform/frontend/src/auth/redirects.ts",
      [
        "const target=new URL(value, 'https://erp.local');",
        "if(target.origin !== 'https://erp.local') throw new Error();",
        "const endpoint='https://api.dev.invalid/api';",
      ].join(""),
    );
    expectIssue(root, "PRODUCT_EXTERNAL_REQUEST_CONFIG");
  });
  await t.test("Vite build injection", () => {
    const root = fixture();
    editFile(
      root,
      "platform/frontend/vite.config.ts",
      (content) => content.replace(
        "server:",
        "define:{__API__:'http://localhost:8080'},server:",
      ),
    );
    expectIssue(root, "VITE_DEVELOPMENT_BOUNDARY");
  });
});

test("secret and internal-runtime signatures fail closed without storing values", async (t) => {
  const cases = [
    ["SOURCE_MAP_REFERENCE", "\n//# sourceMappingURL=app.js.map"],
    ["SOURCE_PATH_DISCLOSURE", "\nconst p='C:/Users/builder/src/App.tsx';"],
    ["INLINE_ENVIRONMENT_OBJECT", "\nconst e=import.meta.env;"],
    ["PRIVATE_KEY_SIGNATURE", "\nconst k='-----BEGIN PRIVATE KEY-----';"],
    ["AWS_KEY_SIGNATURE", "\nconst k='AKIAABCDEFGHIJKLMNOP';"],
    ["GITHUB_TOKEN_SIGNATURE", "\nconst k='ghp_1234567890abcdefghijklmn';"],
    ["OPENAI_KEY_SIGNATURE", "\nconst k='sk-proj-1234567890abcdefghijklmn';"],
    ["JWT_SIGNATURE", "\nconst k='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123';"],
    ["HARDCODED_SECRET_VALUE", "\nconst c={clientSecret:'fixture-secret-value'};"],
    ["HARDCODED_BEARER_VALUE", "\nconst h={Authorization:'Bearer fixturecredential123'};"],
    ["DATABASE_ENDPOINT", "\nconst d='jdbc:postgresql://db.internal:5432/erp';"],
    ["LOCAL_OR_DEVELOPMENT_HOST", "\nconst u='http://host.docker.internal:8080/api';"],
    ["DEBUG_BUILD_MARKER", "\nconst debug=true;"],
    ["FIXED_TEST_ACCOUNT", "\nconst username='uat';"],
    ["NONPUBLIC_API_PATH", "\nfetch('/actuator/health');"],
    ["LICENSE_COMMENT_RESIDUE", "\n/*! retained package notice */"],
    ["UNAPPROVED_ABSOLUTE_URL", "\nfetch('https://api.dev.invalid/api/v1/orders');"],
  ];

  for (const [code, canary] of cases) {
    await t.test(code, () => {
      const root = fixture();
      appendToMain(root, canary);
      expectIssue(root, code);
      const inspected = inspectFrontendBuildSecurity(root);
      const serialized = JSON.stringify(inspected.issues);
      assert.doesNotMatch(serialized, /fixture-secret-value|fixturecredential123/);
    });
  }
});

test("source maps, hidden files, settings, backups, and source files fail by name", async (t) => {
  const cases = [
    ["assets/app.js.map", "SENSITIVE_ARTIFACT_NAME"],
    ["assets/.env.production", "SENSITIVE_ARTIFACT_NAME"],
    ["assets/settings.json", "SENSITIVE_ARTIFACT_NAME"],
    ["assets/credentials.txt", "SENSITIVE_ARTIFACT_NAME"],
    ["assets/source.tsx", "SENSITIVE_ARTIFACT_NAME"],
    ["assets/server.pem", "SENSITIVE_ARTIFACT_NAME"],
    ["assets/database.sql", "SENSITIVE_ARTIFACT_NAME"],
    ["50x.html", "UNEXPECTED_ARTIFACT_PATH"],
  ];
  for (const [relative, code] of cases) {
    await t.test(relative, () => {
      const root = fixture();
      write(root, `${DIST_RELATIVE}/${relative}`, "name-only-canary");
      expectIssue(root, code);
    });
  }
});

test("missing, external, unsafe, and unreferenced assets fail closed", async (t) => {
  await t.test("missing", () => {
    const root = fixture();
    fs.rmSync(path.join(root, DIST_RELATIVE, "assets/chunk-D4e5F6.js"));
    expectIssue(root, "MISSING_REFERENCED_ASSET");
  });
  await t.test("external", () => {
    const root = fixture();
    const index = path.join(root, DIST_RELATIVE, "index.html");
    fs.appendFileSync(index, '<script src="https://cdn.invalid/app.js"></script>');
    expectIssue(root, "EXTERNAL_ASSET_REFERENCE");
  });
  await t.test("traversal", () => {
    const root = fixture();
    appendToMain(root, '\nimport "../outside.js";');
    expectIssue(root, "UNSAFE_ASSET_REFERENCE");
  });
  await t.test("unreferenced", () => {
    const root = fixture();
    write(root, `${DIST_RELATIVE}/assets/orphan.js`, "export{};");
    expectIssue(root, "UNREFERENCED_ARTIFACT");
  });
});

test("an inline executable script and malformed manifest fail closed", async (t) => {
  await t.test("inline script", () => {
    const root = fixture();
    const index = path.join(root, DIST_RELATIVE, "index.html");
    fs.appendFileSync(index, "<script>window.runtimeConfig={}</script>");
    expectIssue(root, "INLINE_EXECUTABLE_SCRIPT");
  });
  await t.test("manifest", () => {
    const root = fixture();
    write(
      root,
      `${DIST_RELATIVE}/manifest.webmanifest`,
      "{not-json}",
    );
    expectIssue(root, "INVALID_MANIFEST");
  });
});

test("build and repository aliases are rejected", async (t) => {
  await t.test("build symlink", () => {
    const root = fixture();
    const outside = temporaryDirectory("xz-erp-build-gate-outside-");
    write(outside, "escaped.js", "export{};");
    fs.symlinkSync(
      outside,
      path.join(root, DIST_RELATIVE, "assets/escaped"),
      "junction",
    );
    expectIssue(root, "BUILD_ALIAS_REJECTED");
  });
  await t.test("repository alias", () => {
    const root = fixture();
    const aliasParent = temporaryDirectory("xz-erp-build-gate-alias-");
    const alias = path.join(aliasParent, "repository");
    fs.symlinkSync(root, alias, "junction");
    expectIssue(alias, "REPOSITORY_ROOT_ALIAS");
  });
});

test("a missing formal production build is a hard failure, never a skip", () => {
  const root = fixture();
  fs.rmSync(path.join(root, DIST_RELATIVE), { recursive: true, force: true });
  expectIssue(root, "BUILD_MISSING");
});

test("Nginx directory listing, root exposure, static fallback, and sensitive policy drift fail", async (t) => {
  const cases = [
    [
      "NGINX_DIRECTORY_LISTING",
      (content) => content.replace("server_tokens off;", "server_tokens off;\n    autoindex on;"),
    ],
    [
      "NGINX_DOTFILE_POLICY",
      (content) => content.replace("location ~ (^|/)\\. {", "location ~ (^|/)[.] {"),
    ],
    [
      "NGINX_ASSET_ALLOWLIST",
      (content) => content.replace(
        "try_files $uri @static_not_found;",
        "try_files $uri /index.html;",
      ),
    ],
    [
      "NGINX_INDEX_POLICY",
      (content) => content.replace(
        "location = /index.html {",
        "location = /all.html {",
      ),
    ],
    [
      "NGINX_ROOT_ASSET_POLICY",
      (content) => content.replace(
        "location = /favicon.ico {",
        "location = /favicon.png {",
      ),
    ],
    [
      "NGINX_STATIC_ERROR_POLICY",
      (content) => {
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        return content.replace(
          [
            "location @static_not_found {",
            "        types { }",
            "        default_type text/plain;",
            '        return 404 "not found\\n";',
            "    }",
          ].join(newline),
          [
            "location @static_not_found {",
            "        types { }",
            "        default_type text/plain;",
            '        return 404 "$request_filename\\n";',
            "    }",
          ].join(newline),
        );
      },
    ],
    [
      "NGINX_SPA_FALLBACK_POLICY",
      (content) => {
        const needle = "try_files /index.html @static_not_found;";
        const position = content.lastIndexOf(needle);
        assert.notEqual(position, -1);
        return content.slice(0, position)
          + "try_files $uri $uri/ /index.html;"
          + content.slice(position + needle.length);
      },
    ],
    [
      "NGINX_DOTTED_STATIC_POLICY",
      (content) => content.replace(
        "location ~ ^/.+\\.[^/]+$ {",
        "location ~ ^/.+\\.(?:txt|xml)$ {",
      ),
    ],
    [
      "NGINX_DOTTED_STATIC_POLICY",
      (content) => {
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const block = [
          "    location ~ ^/.+\\.[^/]+$ {",
          "        types { }",
          "        default_type text/plain;",
          '        return 404 "not found\\n";',
          "    }",
          "",
        ].join(newline);
        assert.equal(content.includes(block), true);
        return content
          .replace(block, "")
          .replace("    location ~* ^/assets/", `${block}    location ~* ^/assets/`);
      },
    ],
    [
      "NGINX_API_TRUST_DOMAIN_POLICY",
      (content) => content.replace("location ^~ /api/ {", "location /api/ {"),
    ],
    [
      "NGINX_API_TRUST_DOMAIN_POLICY",
      (content) => content.replace(
        "location = /api/v1/erp-operator/shopify-app-release/publish {",
        "location = /api/v1/erp-operator/unreviewed { return 404; }\n\n    location = /api/v1/erp-operator/shopify-app-release/publish {",
      ),
    ],
    [
      "NGINX_ACTUATOR_POLICY",
      (content) => content.replace(
        "location ~* ^/api/actuator(?:/|$) {",
        "location ~* ^/api/management(?:/|$) {",
      ),
    ],
    [
      "NGINX_SENSITIVE_NAME_POLICY",
      (content) => content.replace("|license|", "|"),
    ],
  ];
  for (const [code, transform] of cases) {
    await t.test(code, () => {
      const root = fixture();
      editNginx(root, transform);
      expectIssue(root, code);
    });
  }
});

test("the executable rejects external input without echoing it", () => {
  const canary = "https://external.invalid/path?token=credential-canary";
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--dist", canary],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(result.stderr, /external\.invalid|credential-canary/);
});

test("the checker never reads process environment input", () => {
  const source = fs.readFileSync(SCRIPT_PATH, "utf8");
  assert.doesNotMatch(source, /process\.env|Bun\.env|Deno\.env/);
});
