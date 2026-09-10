# API contract gate

`platform/scripts/api-contract-gate.mjs` is the fail-closed, offline contract
gate for the Spring API surface. It reads only the canonical repository source
tree under `platform/backend/src/main/java`; it never starts Spring, loads
production code, reads `.env` or credentials, follows symbolic links, accepts a
repository path/URL, or prints source-file contents.

The committed [machine-readable baseline](../contracts/api-contract-baseline.json)
is generated from the current Controller, request DTO, exception-advice,
permission-constant, and `SecurityConfig` sources. It is not a hand-maintained
endpoint table. The baseline has `schemaVersion`, deterministic ordering,
SHA-256 source provenance, and an integrity SHA-256 over the complete document
without its own integrity field.

## Check and refresh

Run from the repository root:

```powershell
node --check platform/scripts/api-contract-gate.mjs
node platform/scripts/api-contract-gate.mjs
node --test platform/scripts/api-contract-gate.test.mjs
```

The no-argument command is the CI gate. It compares the source-derived facts
with the committed baseline and exits non-zero for endpoint deletion or
method/path changes, trust-domain changes, authority changes (including a
permission removal or lowering), path/query parameter changes, request DTO
changes, response status/type changes, explicit error mapping changes, and new
endpoints. A new endpoint is never silently accepted.

After the contract change has been explicitly approved and a human has
inspected the resulting diff, refresh explicitly:

```powershell
node platform/scripts/api-contract-gate.mjs --refresh-baseline --reviewed
```

`--reviewed` is an intentional acknowledgement. The command still fails on
unresolved source facts and prints a review-required message; it does not
provide a way to pass an unreviewed new endpoint through the normal check.

## Captured contract

Each endpoint records the Controller operation, HTTP method, complete path,
trust domain (`public`, `platform-admin`, or `tenant`), source-derived
authority/permission, path and query parameters (type, requiredness, default,
and validation constraints), request body DTO reference, success status,
declared response type, and a narrow response-shape classification. Current
generic responses are accepted only for the explicit `PageEnvelope`,
`PageResult`, and `ResponseEntity` wrappers. The system-info `Map<String,Object>`
is an explicit, named opaque-map exception because its source contract is a
small readiness metadata map. Other unresolved generic responses fail closed.

Explicit `@ExceptionHandler` mappings are recorded with target Controller,
exception classes, HTTP status, response type, and error code(s). The two
global `SecurityConfig` JSON error mappings are recorded separately.

## Safety and limitations

The extractor is intentionally a bounded source checker, not OpenAPI and not a
runtime proof. It rejects dynamic mapping paths, unresolved response wrappers,
unresolved authority expressions, unresolved Controller/advice targets,
Spring mapping meta-annotations, malformed DTOs, source symlinks, baseline
symlinks, baseline integrity failures, and external command-line input. It does
not infer serialization naming policies, Jackson modules, nested response JSON
shapes, database-driven permissions, or runtime handler precedence. Those
remain part of Spring/integration review.

The baseline currently covers 306 endpoints, 161 request DTO schemas, 270
Controller exception mappings, 2 global security error mappings, and 88 source
provenance files. All built-in checks report `skipped=0`.

The negative tests inject endpoint deletion, method/path drift, permission
lowering/removal, trust-domain mixing, required-field deletion, field type drift,
required-query drift, response status/type drift, a new endpoint, dynamic
mapping, baseline tampering, source symlinks, and path injection. They use
temporary copies only and never load or contact an external repository.
