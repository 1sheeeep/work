# Frontend build and static-delivery security gate

## Purpose

This gate checks the repository-owned production Web build and its real Nginx
static-delivery boundary. It is deliberately offline, fail-closed, and fixed to
the repository root.

The executable accepts no path, URL, environment, credential, or alternate
root. It reads only these fixed repository inputs:

- `platform/frontend/dist`;
- `platform/frontend/nginx.conf`;
- `platform/frontend/package-lock.json`;
- `platform/frontend/vite.config.ts`; and
- non-test product files below `platform/frontend/src`.

It never reads `.env`, user settings, credential stores, arbitrary external
paths, running applications, production resources, or real shops. Missing
inputs, aliased paths, unsupported filesystem entries, unreadable text, or
inspection bounds are hard failures. Output contains only issue class and
repository-relative file; matched values are never printed.

## Required execution order

Create the production build first with repository-local dependencies or the
digest-pinned Dockerfile stages already available locally. Do not install or
pull to make the gate pass.

```powershell
Set-Location platform/frontend
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
Set-Location ../..

node --check platform/scripts/frontend-build-security-gate.mjs
node platform/scripts/frontend-build-security-gate.mjs
node --test platform/scripts/frontend-build-security-gate.test.mjs
node --test platform/scripts/frontend-static-runtime.test.mjs
```

Docker runtime commands in the real-container test always use
`--pull=never`. Docker build has no `--pull=never` spelling; an offline build
must use the equivalent no-refresh and no-network controls:

```powershell
docker build --pull=false --network=none platform/frontend
```

If the pinned image, package layer, Docker daemon, or repository-local
dependencies are absent, the command must fail. Network access is not an
allowed cache-repair mechanism.

## Build-artifact policy

The checker recursively walks the canonical, non-symbolic `dist` directory
with fixed file-count and byte bounds. It requires:

- one `index.html`;
- only referenced, same-origin root `favicon.ico` and
  `manifest.webmanifest`;
- all other files below `assets/` with the reviewed static extension set;
- a complete reference graph from `index.html`, including HTML attributes,
  CSS URLs/imports, JavaScript imports/Vite preload arrays, and manifest
  resources; and
- no orphaned or missing artifacts.

Text artifacts fail for:

- `.map` files, source-map/source-URL metadata, source paths, source files,
  build-machine absolute paths, and retained source content;
- hidden files, `.env`, settings/configuration, backups, keys, certificates,
  SQL, logs, and sensitive filenames;
- inline executable script or environment objects;
- JWT-shaped values, private-key headers, value-bearing generic secrets,
  bearer literals, and common AWS, GitHub, and OpenAI signatures;
- JDBC/database endpoints, internal database hosts, development hosts,
  debug flags, fixed test/UAT accounts, and non-public actuator/internal API
  paths;
- unreviewed external resource references or absolute API/development/test
  URLs; and
- retained `/*!`, `@license`, or `@preserve` comments.

The rules distinguish credential field names needed by the ERP client from
hard-coded credential values. They do not print the match.

## Accepted TanStack Router dependency constant

The current production bundle contains exactly one dependency-owned
`http://localhost` value. It is not treated as a generic allowlist. The gate
accepts it only while all of these machine-verifiable facts hold:

1. `package-lock.json` pins `@tanstack/react-router` `1.170.18`;
2. that package pins `@tanstack/router-core` `1.171.15`;
3. all text artifacts contain exactly one `localhost`;
4. its bundle context is exactly the router's
   `window.origin -> http://localhost` fallback; and
5. non-test product source contains no local endpoint, absolute request base,
   or build-time environment injection.

`vite.config.ts` is separately locked so its one localhost value remains only
the development server's `/api` proxy. The gate rejects `define`, `loadEnv`,
environment-derived build configuration, another absolute URL, or another
local host in that file.

For normal browser HTTP/HTTPS execution, `window.origin` exists, so the
fallback is not selected. The dependency uses the value as a router URL
resolution origin; it is not an ERP API base or an outbound request
configuration. Any dependency version, occurrence count, surrounding
`window.origin` semantics, product source, or Vite boundary drift fails closed
and requires review. The dependency or build chain is not patched by this
gate.

`src/auth/redirects.ts` has a separate exact pair of
`https://erp.local` parser sentinels: one `new URL(value, base)` and one
same-origin comparison. The checker removes only those two exact non-request
uses before it checks the rest of that file for external request
configuration.

## Nginx delivery contract

The repository Nginx configuration:

- serves root artifacts only through exact `/index.html`, `/favicon.ico`, and
  `/manifest.webmanifest` locations, plus existing files below `/assets/**`
  whose extensions are on the reviewed asset allowlist;
- treats every other non-API request whose final path segment contains a dot
  and a non-empty extension as a static filename, returning the generic `404`
  instead of the SPA;
- keeps extensionless application routes such as `/orders` and `/settings` on
  the SPA fallback;
- returns the generic `404 text/plain` body `not found` for hidden paths,
  sensitive names, every unrecognized root or nested static extension,
  unknown asset paths, and asset directories;
- never falls back an unknown static filename to SPA `200`;
- retains `server_tokens off` and prohibits `autoindex on`; and
- keeps `/api/` as a separate `^~` trust domain. Static deny regex locations
  do not apply below that prefix, so API paths containing extensions or dots
  retain their original proxy route and method. Health and readiness behavior
  is unchanged.

The real-container test mounts the repository configuration and a disposable
static root into the already-local `xz-erp-local-web:latest` Nginx runtime. It
uses random container/network names, an internal stub backend, a loopback-only
published port, and `--pull=never`. It runs `nginx -t`, checks extensionless
SPA routes, known JS/CSS/favicon/manifest assets, `HEAD`, readiness, and API
proxying for dotted paths and common methods, then proves fail-closed behavior
for:

- `/.env` and variants;
- `/.git/config`;
- `/src/**`;
- `/settings.json`;
- source-map, key, SQL, configuration, backup, image-default, and generic
  unrecognized extensions such as `.txt`, `.xml`, `.wasm`, and `.pdf`;
- `/50x.html`;
- `/assets`, `/assets/`, and unknown or sensitive `/assets/**`; and
- encoded traversal.

Every owned container, network, port, and temporary fixture is removed in
`finally`. Missing Docker or the local image is a failed test, never a skip.

## Responsibility boundary and incident handling

The formal production build must pass both the static and real-container gates
from the current `main` revision. Release-image rebuild and complete frontend
verification are required before deployment. TLS/domain/HSTS/trusted-proxy
policy, ingress, release packaging, rollback, and production acceptance remain
separate release responsibilities.

If the gate finds a real secret, source map, source/absolute path, dangerous
external URL, directory listing, or readable sensitive file, stop runtime
changes. Report the issue category, exact artifact path, safe reproduction,
impact, and minimal remediation without repeating the value. Do not weaken a
signature or add an exception merely to make a build green.

## Evidence and limits

On 2026-07-29 the reviewer supplied a local image built from `main`
`ca4b692`:

- image: `xz-erp-local-web:latest`;
- local image ID:
  `sha256:bcc51f27746412f2e97a8d3d56273fba02a2cd8bd0662f4f7ebe73109f26ab1d`;
- image creation time: `2026-07-29 11:22:02 +08:00`;
- extracted Vite artifact after excluding the Nginx base image's separately
  runtime-gated `50x.html`: 24 files, 558,027 bytes, 24 text files, and 89
  checked references; and
- accepted dependency constants: exactly 1.

That is local evidence, not supply-chain provenance. The image has no commit
revision label. The recorded offline rebuild from `bb78fe8` could not complete
because repository-local dependencies were absent and the `--network=none` npm
layer did not match an available cache key. No dependency or image was
downloaded to repair that condition.

The gate is not:

- a complete SBOM or dependency-license inventory;
- proof of byte-for-byte reproducibility;
- proof that minified code has no undiscovered semantic vulnerability;
- a binary steganography scanner;
- a browser, backend authorization, tenant-isolation, or production probe; or
- a production security or deployment-readiness conclusion.

Release provenance, dependency advisories, signed artifacts, browser behavior,
and the integrated release image require their own release evidence.
