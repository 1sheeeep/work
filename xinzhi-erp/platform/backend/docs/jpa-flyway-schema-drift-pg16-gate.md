# JPA/Flyway Schema Drift and Constraint Integrity PostgreSQL 16 Gate

## Purpose and responsibility boundary

This gate verifies the schema produced by the reviewed boundary: V1 through V89
against all 30 current JPA/Hibernate entities on a one-use
`postgres:16-alpine` database. The gate adds
verification only; it does not rewrite an applied migration or change runtime
behavior.

The recorded schema facts are not a product contract. Changing a product
contract still requires explicit approval. The gate distinguishes intentional
database hardening from dangerous drift and fails closed when it cannot prove
the reviewed state.

## Executable coverage

The runtime test has no skip path and performs these stages:

1. Starts an isolated PostgreSQL 16 Testcontainers instance and applies the
   complete classpath Flyway history to an empty database.
2. Requires exactly these sparse versions:
   `1,10,20,21,30,31,32,33,34,35,36,37,38,39,40,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89`.
   The current version must be 89, validation must succeed, and no migration
   may remain pending.
3. Boots the real Spring application with `ddl-auto=validate`.
4. Derives entity tables and mapped columns from the live JPA metamodel and
   compares them with PostgreSQL catalog types, lengths, and nullability.
5. Verifies primary keys, reviewed tenant foreign keys, selected
   unique/check/index definitions, defaults, all 22 `@Version` mappings,
   delete actions, guard triggers, and tenant discriminator columns.
6. Proves cross-tenant shop, product, and order references are rejected with
   PostgreSQL state `23503`.
7. Deliberately weakens a mapped nullability rule, tenant foreign key, and
   critical index inside transactions. Every mutation must make the same
   checker fail, after which rollback restores the baseline.

The Node checker requires these fixed source facts, the exact V1-through-V89
boundary, a single successful Surefire runtime result, complete evidence, and
`0 skipped`. Its unit tests prove that missing history,
duplicate versions, external input, skip paths, incomplete evidence, failures,
and skipped tests are rejected.

## Strengthening versus dangerous drift

The intentional database hardening category includes reviewed format/state checks,
non-negative version checks, tenant composite foreign keys, redundant tenant
identity keys, partial unique indexes, and delete/write guard triggers.

Dangerous drift includes an incompatible mapped table or column, changed type
or length, missing required nullability, key, constraint, index, or trigger,
unexpected cascade behavior, cross-tenant reference acceptance, an unreviewed
migration-boundary change, Hibernate validation failure, incomplete evidence,
or any skipped test.

Reviewed cascading deletes are limited to derived login-throttle rows and
owned children of manual movements, boxes, inventory-count batches, and
warehouse-transfer batches. Other current foreign keys retain `NO ACTION`.
JPA relationships must not add `REMOVE` or `ALL` cascade or orphan removal.

## Safe execution

From the repository root in PowerShell:

```powershell
$backendPath = (Resolve-Path 'platform/backend').Path
docker run --rm `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -e DOCKER_HOST=unix:///var/run/docker.sock `
  -e TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -e TESTCONTAINERS_RYUK_DISABLED=true `
  -v "${backendPath}:/workspace" `
  -v xz-erp-maven-cache:/root/.m2 `
  -w /workspace `
  maven:3.9.11-eclipse-temurin-25 `
  mvn -B `
  '-Dtest=SchemaDriftPostgresql16GateTest' test

node platform/scripts/schema-drift-gate-check.mjs
node --test platform/scripts/schema-drift-gate-check.test.mjs
node --check platform/scripts/schema-drift-gate-check.mjs
```

The runtime gate has no JDBC, database, host, credential, schema, migration
location, or output-path input. It does not read `.env`, process production
credentials, or reuse repository Compose databases. Missing Docker, cached
dependencies, PostgreSQL startup, Flyway, Hibernate validation, catalog facts,
or result evidence is a hard failure.

## Current limitations and escalation

This is finite schema and constraint evidence. It is not a production-data
audit, online migration rehearsal, lock-duration analysis, query-plan gate,
backup proof, capacity test, or authorization-service proof.

If the gate exposes production drift, a tenant-boundary gap, a missing
constraint, an unsafe cascade, or a migration defect, report the catalog
evidence and wait for approval. Do not edit V1 through V89 or
silently change runtime behavior.
