# Permission catalog and route consistency gate

## Purpose

`platform/scripts/permission-consistency-gate.mjs` is a deterministic static
gate for the checked-in authorization contract. It reads the repository's real
Flyway, Java, TypeScript and TSX sources and exits non-zero when their permission
facts drift.

Run it from any directory with:

```powershell
node platform/scripts/permission-consistency-gate.mjs
node --test platform/scripts/permission-consistency-gate.test.mjs
```

The executable accepts no arguments, environment-provided root, URL or fixture
path. It derives the repository root from its own checked-in location, verifies
the expected layout, rejects aliased roots and symbolic links in scanned source,
and emits sorted paths and error codes without source contents or credentials.
Success and failure output both state `skipped=0`.

## Source facts checked

The formal business permission catalog is derived from every
`INSERT INTO permissions (...) VALUES ...` statement under the Flyway migration
directory. No permission-code copy or allowlist is maintained by the gate.

The backend scan resolves literal and `*PermissionCodes`-constant
`@PreAuthorize` authorities on production controllers. Every resolved business
permission and every production Java permission-shaped literal must exist in
the Flyway catalog. Dynamic or unresolvable `@PreAuthorize` expressions fail the
gate instead of being ignored.

The frontend scan reads production TS/TSX permission references, including
module `requiredPermission` values and `hasPermission`/IAM `can` checks. It
verifies that:

- grouped tenant navigation is derived from
  `getAccessibleTenantNavigation(hasPermission)` and only renders its filtered
  result;
- dynamic module routes are all wrapped in `ModuleAccessGate`, whose decision
  uses the exact module `requiredPermission`;
- `/settings/iam` menu visibility and the page's four read permissions remain
  identical;
- direct navigation to `/settings/iam` without any of those read permissions
  reaches the page-level explicit 403 and cannot substitute button permissions
  for page-read permission;
- known frontend permission references exist in the Flyway catalog.

The platform/enterprise trust-domain checks keep these contracts separate:

- a base platform session carries `SYSTEM_ADMIN` only and is rejected by the
  general enterprise request boundary;
- platform-admin routes require `SYSTEM_ADMIN`;
- entering an enterprise creates a distinct session that loads all formal
  catalog permissions and carries `PLATFORM_ADMIN_TENANT_SESSION`, not
  `SYSTEM_ADMIN`;
- leaving that enterprise session requires the tenant-session authority;
- platform authorities are not business permission codes or catalog rows.

## Narrow fail-closed placeholder rule

A module permission absent from Flyway is accepted only as an unallocated,
fail-closed placeholder entry when all of these facts are derived from current
source at the same time:

1. its `moduleDefinitions` status is exactly `planned` or `integration`;
2. `App.tsx` does not map its id to a dedicated page and the route reaches the
   generic `ModulePage` fallback;
3. the shared dynamic route remains wrapped in `ModuleAccessGate`;
4. no production API client references its API namespace or permission, and no
   backend production source references its API namespace or permission;
5. the unknown code occurs only once, as that module's
   `requiredPermission`.

This is not a formal permission contract and does not allocate V40 or any later
migration. Changing such a module to `foundation`, adding a dedicated page or
API, adding an operation permission check, adding a controller, removing the
route guard, or reusing the unknown code anywhere else makes the gate fail until
the user approves a formal catalog change.

## Tests and capability boundary

The Node test suite runs the real repository as its positive fixture and injects
isolated negative mutations for frontend spelling drift, backend unknown
authority, missing module guard, missing IAM page guard, platform/enterprise
authority mixing, premature placeholder promotion, dedicated-page activation,
symbolic-link input and CLI path injection.

This gate is lexical and structure-aware; it is not a complete proof of runtime
authorization. It does not execute Spring Security, infer arbitrary Java or
TypeScript data flow, validate tenant isolation, prove that a correctly named
permission is the right business decision, or replace controller integration
tests. New authorization mechanisms, Spring meta-annotations, generated routes,
computed permission expressions or a different router structure must first
extend this parser and its negative tests; unresolvable backend method-security
expressions fail closed.
