# Backend and Web container runtime minimum-privilege gate

## Decision

The repository-owned local and delivery Compose application services now define
the reviewed minimum-privilege runtime boundary:

- the backend retains its existing non-root `erp` image identity;
- the Web final image runs as the existing `nginx` user;
- both application root filesystems are read-only;
- both services drop all Linux capabilities and add none;
- both services enable `no-new-privileges`;
- the only writable filesystem boundary is a bounded `/tmp` tmpfs; and
- health, readiness, static delivery, and `/api/**` routing remain at the
  repository edge.

This is a local Docker Desktop Linux and single-host delivery-Compose contract.
It is not a production deployment, cloud, Kubernetes, registry, or staging
acceptance claim.

## Runtime contract

| Property | Backend | Web |
| --- | --- | --- |
| Image | `xz-erp-local-backend:latest` | `xz-erp-local-web:latest` |
| Configured identity | `erp` | `nginx` |
| Effective local UID:GID | non-zero | non-zero |
| Internal listener | `8080` | `8080` |
| Root filesystem | read-only | read-only |
| Capabilities | `cap_drop: ALL`, no additions | `cap_drop: ALL`, no additions |
| Privilege transition | `no-new-privileges:true` | `no-new-privileges:true` |
| Writable path | `/tmp`, 64 MiB | `/tmp`, 16 MiB |
| tmpfs flags | `rw,noexec,nosuid,nodev,mode=1777` | `rw,noexec,nosuid,nodev,mode=1777` |
| Health target | `/actuator/health/readiness` | edge `/readyz` |

The Web image redirects the Nginx pid plus client-body, proxy, FastCGI, uWSGI,
and SCGI temporary paths into `/tmp`. It listens on unprivileged port `8080`.
The host-facing Compose endpoint remains loopback-only and keeps the existing
configurable host port.

The digest-pinned upstream Nginx image declares `80/tcp`; Docker image metadata
therefore retains inherited `80/tcp` alongside the reviewed `8080/tcp`. No
repository configuration publishes or listens on the inherited port. The gate
locks that fact so it cannot silently become an active edge boundary.

## Executable gate

`platform/scripts/container-runtime-security-gate.mjs` accepts no arguments and
locks:

- repository root and regular, non-symbolic source files;
- Docker context `desktop-linux`;
- the two fixed local image names;
- the Web and backend Dockerfile identities, commands, ports, pid, and temporary
  path source contracts;
- normalized local and delivery Compose application service security settings;
- loopback Web publication and both readiness healthchecks; and
- real disposable-container UID, GID, root/application/tmpfs writability,
  `/etc/shadow` readability, effective/bounding capabilities, and
  `NoNewPrivs`.

Compose is normalized with `--no-interpolate` and `--no-env-resolution`; the
gate does not render environment values or credentials. Runtime probes use
`--pull=never`, `--network none`, fixed image names, and random owned container
names. Cleanup removes only containers created by the gate.

Missing Docker, the wrong daemon OS, a missing image, malformed inspection
output, invalid Compose, an internal error, an incomplete scope, a probe
failure, zero checks, or any skipped check is a hard failure. Output contains
only stable issue codes and roles.

Run after rebuilding both fixed images from the current repository:

```powershell
docker --context desktop-linux compose -f platform/compose.yaml build backend web
node --check platform/scripts/container-runtime-security-gate.mjs
node --check platform/scripts/container-runtime-security-gate.test.mjs
node --test platform/scripts/container-runtime-security-gate.test.mjs
node platform/scripts/container-runtime-security-gate.mjs
```

The deterministic test suite covers success plus writable/privileged
containers, capability additions, incomplete drops, missing NNP, tmpfs and
volume drift, root overrides, port/health drift, image metadata drift, root
UID/GID, writable root/application surfaces, unusable tmpfs, readable shadow,
ineffective NNP, non-zero effective/bounding capabilities, missing
prerequisites, incomplete scope, skips, and rejected external input.

## Runtime integration verification

The existing real-Nginx gates now execute the edge with the same read-only,
zero-capability, NNP, and bounded-`/tmp` boundary:

```powershell
node --test platform/scripts/frontend-static-runtime.test.mjs
node --test platform/scripts/http-routing-edge-runtime.test.mjs
node --test platform/scripts/nginx-api-access-log-runtime.test.mjs
node --test platform/scripts/nginx-readiness.test.mjs
```

A complete isolated local Compose run remains required to prove both health
checks, backend readiness against PostgreSQL 16, edge liveness/readiness,
static content, and the protected `/api/**` boundary together. It must use
fixed local images, `--pull never`, a unique project name, a random loopback
port, and a disposable project volume.

## Limitations

This gate does not establish Kubernetes security contexts, Pod Security,
seccomp/AppArmor, orchestrator service accounts, cloud ingress or egress,
registry signatures, SBOM/provenance, production image digests, production
secrets, production persistence, or deployment safety. It does not authorize a
deployment or connection to production, real shops, or external provider
credentials.

PostgreSQL is not classified as an application service in this gate; its
database-specific writable data volume and runtime hardening require a separate
database review. Only an integrated and reviewed staging build may be handed to
a user for acceptance.
