# Linux Production Deployment

> Retained deployment reference only. The imported ERP copy's new
> `customer_service` schema-role contract is currently local/synthetic. Real
> database migration and production enablement are not authorized or executed;
> this document and the retained production Compose template do not provide a
> cutover path for that contract.

Production releases are built and tested on the Windows workstation. The
server only loads the resulting Linux image and switches between blue and
green API containers. Do not run Docker builds on the production server.

## Workstation Setup

Use Docker Desktop with the WSL 2 backend. Keep Docker's WSL data root on the
large data disk:

```text
D:\DockerData
```

Production build staging, image archives, and release packages use:

```text
D:\XzdeskBuild
```

The build script refuses a build root outside `D:` and does not package
`production.env`, OAuth secrets, API keys, database passwords, or SSH keys.

## Build A Release

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\build-production-release.ps1
```

The script runs:

1. `git diff --check`
2. `go test ./... -count=1`
3. `go vet ./...`
4. the frontend TypeScript/Vite production build
5. a Linux `amd64` Docker image build
6. an image export and checksummed release package on `D:`

Production builds require a clean Git working tree. `-AllowDirty` exists only
for local validation and must not be used for a production deployment.

## Server Prerequisites

The server must already have Docker Engine, Docker Compose, Caddy ports 80/443,
and the production secrets file:

```text
/opt/xzdesk/deploy/production.env
```

Keep the secrets file only on the server. At minimum, configure the database,
upload directory, public domain, OAuth providers, and encryption keys. Runtime
deployment state is stored separately:

```text
/opt/xzdesk/runtime/deploy
```

## Deploy A Release

Pass the package produced by the build script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\deploy-production-blue-green.ps1 `
  -PackagePath D:\XzdeskBuild\releases\xzdesk-RELEASE_ID.tar.gz `
  -ServerHost YOUR_SERVER
```

The deployment process:

1. creates and verifies a database backup;
2. loads the prebuilt image without compiling on the server;
3. starts the inactive blue or green API container in standby mode;
4. waits for its database-backed health check;
5. reloads Caddy to route new traffic to the candidate;
6. verifies the public `/healthz` release identifier;
7. gracefully stops the previous API so WebSocket clients reconnect;
8. promotes the candidate to run periodic background jobs.

If candidate or public verification fails, traffic remains on or is restored
to the previous API. After success, only the active and immediately previous
API images and frontend releases are retained on the server.

## Roll Back

The most recent previous color and release are retained:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\rollback-production-blue-green.ps1 `
  -ServerHost YOUR_SERVER
```

Rollback starts and verifies the previous API before switching traffic back.
Database migrations must remain backward compatible with the previous release.

## Operations

Do not run `docker compose down -v`; it deletes the PostgreSQL volume. The
active API color and image mapping are recorded under
`/opt/xzdesk/runtime/deploy`. Use `/healthz` to verify the active release and
storage health.
