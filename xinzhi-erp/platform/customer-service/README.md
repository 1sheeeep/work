# Xzdesk

This directory is the authoritative imported Xzdesk customer-service source
copy inside the XZ ERP repository. Its Go backend, React frontend, Wails source,
Chinese UI, business logic and operator workflows are retained rather than
rewritten in Java. The original
`C:\Users\新知科技\Documents\客服助手` repository and its production runtime are
not used or modified by ERP development.

## Project Boundary

- `server`: central API, WebSocket events, storage, accounts, permissions,
  assignment, statistics, SLA, and Shopify app integration.
- `admin`: web management console for shops, agents, roles, rules,
  sources, and reports.
- `client`: customer-service workbench connected to the server rather than the
  owner of all business data.
- `connectors`: Gmail, Outlook, Shopify Inbox, Shopify Chat, and other
  source connectors.

Shopify installation, OAuth, API scopes, webhooks, and uninstall handling are
owned by the shared Xinzhi ERP Shopify connector and public app. Xzdesk reuses
the ERP-bound store identity, then owns the customer-service channel binding,
widget configuration, and recent-load status. It only copies the official App
Embed link; the merchant opens it manually in a browser already signed in to
the matching store. Xzdesk does not open or control a browser, log in to a
store, or maintain separate per-store App credentials, Automation Tokens,
deployment, or reauthorization flows.

## Shopify App Release

The Shopify app configuration and Theme App Extension in this directory are
packaged into the ERP backend image as the single release source. A system
administrator stores the app-level Automation Token and confirms releases from
ERP Platform Management. Xzdesk does not store the token, expose a deployment
action, or require a Git host or local terminal release script.

## Development

Start the API and workbench UI together:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-platform-dev.ps1
```

Stop the local dev processes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-platform-dev.ps1
```

Run the platform server:

```powershell
go run .\cmd\support-server -addr 127.0.0.1:8787
```

By default the server uses an in-memory store in local development. PostgreSQL
uses a fixed `customer_service` schema and separate migration/runtime roles:

```powershell
$env:XZDESK_DATABASE_SCHEMA="customer_service"
$env:DATABASE_URL="postgres://customer_service_runtime:not-a-real-secret-customer-service-runtime@127.0.0.1:54329/shopify_support?sslmode=disable"
$env:XZDESK_DATABASE_MIGRATION_URL="postgres://customer_service_migrator:not-a-real-secret-customer-service-migrator@127.0.0.1:54329/shopify_support?sslmode=disable"
go run .\cmd\support-server -addr 127.0.0.1:8787
```

Existing migration SQL remains embedded under `internal/platform/migrations`.
The migration role applies each file once and records its checksum in
`customer_service.customer_service_schema_migrations`; the runtime connection
serves requests only after its DML-only boundary is verified. Startup verifies
the database, role, schema, search path, relation ownership, exact runtime and
default privileges, and cross-schema create/write boundary before any migration
SQL runs. The two DSNs must retain the same ordered host/port/database targets,
and both authenticated connections must reach the same actual PostgreSQL cluster,
database and server endpoint; a same-named database at another endpoint is
rejected. Connection failures are reported without echoing either DSN.

Development PostgreSQL is available through Docker Compose:

```powershell
docker compose -f .\deploy\docker-compose.yml up -d
Copy-Item .\.env.example .\.env
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-platform-dev.ps1
```

The Docker init template creates the two bounded roles and schema only while
PostgreSQL initializes an empty synthetic data directory. It rejects an existing
`customer_service` schema, either pre-existing service role, or any user object
before role, owner, grant or default-ACL changes. The
`tools\initialize-local-postgres-schema.ps1` helper is now a read-only refusal
gate for already initialized named volumes; it never bootstraps or takes them
over. This is a fresh-only local initialization contract, not a seamless upgrade
path. The package does not read, copy, migrate, delete or otherwise adopt legacy
`public` data. Keep any existing volume unchanged and use a new synthetic local
volume instead.

`tools\start-platform-dev.ps1` loads `.env` automatically. In local mode an
explicit `DATA_FILE` remains supported, and no storage configuration still uses
memory for quick experiments. `XZDESK_ENVIRONMENT=production` never falls back
to file or memory storage. The schema-role contract is ready only for local
synthetic validation; real data migration and production enablement have not
been authorized or executed, and the retained production deployment templates
are not wired to this new contract.

### ERP passwordless entry

The repository-level `platform\scripts\start-local-dev.ps1` starts this imported
service with ERP development, its frontend, and the separate loopback Shopify
connector. It checks each process independently and injects
`XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL=http://127.0.0.1:8790` plus the same
existing workload credential used by ERP and customer service.
ERP opens the configured imported-service origin and submits only a short-lived,
one-time opaque grant plus immutable tenant/user binding fields. The Go service
redeems the grant directly with ERP using the existing connector workload
credential, creates its own restricted session and passwordless seat/profile,
then loads the existing workbench UI. Browser URLs and `postMessage` never carry
ERP access tokens, Xzdesk sessions/cookies or provider tokens.

Local loopback HTTP is accepted only for development. Non-loopback entry and IAM
origins require HTTPS, and missing origin or workload configuration fails closed.
Each unified launch assigns customer service and the connector separate random
scratch paths that were proven absent before startup. It never reads the normal
`.env`, `runtime/platform-dev-data.json`, a database, or an older connector data
file. Strict-offline mode disables provider background registration and blocks
non-loopback HTTP provider requests through both default clients and explicit
email network transports; inherited provider environment families are
also cleared before the child process starts. Random connector identities must
report `NOT_CONFIGURED`, while repository emptiness comes from the fresh scratch
namespace rather than that probe. The launcher does not execute OAuth or
migration. `tools\start-erp-local.ps1`
remains a customer-service-only diagnostic entry and does not start a connector.

### Development OAuth callbacks

This section applies only to local Vite development. Server deployments expose
Caddy on port `80`; Caddy serves the frontend and proxies OAuth callbacks to the
internal API service on `8787`.

The Vite development server proxies backend routes, including
`/outlook/callback`, `/gmail/callback`, `/api`, and `/ws`, to
`VITE_XZDESK_BACKEND` (default `http://127.0.0.1:8787`). This lets a temporary
HTTPS tunnel expose the workbench on port `5173` without sending OAuth callbacks
into the React login page.

The frontend port is strict and defaults to `5173`. If another Xzdesk checkout
already uses that port, set `XZDESK_FRONTEND_PORT` to a free port such as `5174`
and point the development tunnel to that exact port. Startup fails with a clear
error instead of silently switching to a different port and printing a stale
URL.

When using a temporary public HTTPS URL, set the same origin as the backend
public base URL before restarting the development processes:

```env
PUBLIC_BASE_URL=https://your-temporary-host.example
# Optional provider-specific overrides:
# OUTLOOK_BASE_URL=https://your-temporary-host.example
# GMAIL_BASE_URL=https://your-temporary-host.example
```

Register these exact redirect URIs in the Microsoft and Google applications:

```text
https://your-temporary-host.example/outlook/callback
https://your-temporary-host.example/gmail/callback
```

After the public host changes, restart `tools\start-platform-dev.ps1` and
generate a new authorization URL. An old callback code or authorization URL
must not be reused.

Run the persistence smoke test. It creates a shop, source, conversation, and
message, restarts the API, and verifies the same records can still be read:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\test-platform-persistence.ps1 -StartPostgres
```

The smoke script uses `smoke-owner@example.com` / `password-123` by default on a
fresh database. If the database already has another admin, set
`SUPPORT_PLATFORM_SMOKE_EMAIL` and `SUPPORT_PLATFORM_SMOKE_PASSWORD` in `.env`.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/healthz
```

Bootstrap the first admin account. This endpoint only works while the user table
is empty:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/v1/bootstrap/admin `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"owner@example.com","displayName":"Owner","password":"password-123"}'
```

Login returns a bearer token for protected endpoints:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/v1/auth/login `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"owner@example.com","password":"password-123"}'
```

Most business endpoints now require `Authorization: Bearer <token>`. Admin users
can manage shops, sources, users, and shop-agent assignments. Agent users only
see shops and conversations assigned to them.

Run Go tests:

```powershell
go test ./...
```

## Source boundary

Changes for ERP customer service belong in this imported directory. Do not run,
modify or use credentials, databases or sessions from the original customer-
service repository or production system; see `IMPORTED_FROM.md` for provenance.
