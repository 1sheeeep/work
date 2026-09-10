# Deserialization and dynamic code-execution surface gate

## Purpose and ownership

This gate prevents the XZ ERP application from silently gaining an
attacker-controlled deserialization, expression, lookup, reflective loading,
query-construction, or process-execution surface. It adds no application
runtime behavior. Its owned deliverables are:

- `platform/scripts/dynamic-code-execution-gate-check.mjs`, the fixed-root,
  fail-closed source and result checker;
- `platform/scripts/dynamic-code-execution-gate-check.test.mjs`, the checker's
  positive and deliberate-negative tests;
- `DynamicCodeExecutionSurfacePostgresql16GateTest`, a real Spring and
  one-use PostgreSQL 16 request gate; and
- this fact, evidence, and responsibility record.

The gate does not change an API route, request/response DTO, permission,
tenant boundary, audit contract, migration, runtime configuration, dependency,
or production code. It does not read `.env`, process environment values,
credentials, arbitrary paths, or URLs. Its executable accepts no arguments.
It never contacts a real shop or production resource and cannot deploy or
merge.

## Fixed static scope

The checker walks every regular, non-symbolic file under:

- `platform/backend/src/main/java`;
- `platform/backend/src/main/resources`;
- the fixed backend `pom.xml`;
- the fixed runtime test source; and
- the fixed Surefire XML result.

Missing sources, symbolic entries, parse failures, missing or stale reports, a
zero-test report, any failure/error/skip, and any external CLI input are hard
failures.
The checker prints classifications and repository-relative locations, never
matched source values.

The current passing baseline contains these reviewed facts:

| Fact | Count | Classification |
| --- | ---: | --- |
| Application Java sources | 467 | Entire `src/main/java` tree scanned |
| Application resource files | 52 | Config/factory files scanned; immutable migration SQL inventoried but excluded from application-config keyword rules |
| Query declarations/calls | 403 | Fixed Java string/text-block queries plus reviewed dynamic invocations |
| Bounded dynamic query owners | 20 files | Audit, analytics, inventory, logistics, procurement, order-list, warehouse-document and manual-movement repositories; every direct JDBC owner is source-integrity locked |
| Application logger calls | 6 | Exactly one fixed literal and no parameter/throwable |
| Direct `ObjectMapper` owners | 4 files | Typed database JSON readers/writers plus the Connector's fixed response classes; unknown fields/trailing tokens fail and no polymorphic typing is enabled |
| Direct JDBC-template owners | 39 files | Exact source SHA-256 and reviewed dynamic-call counts are locked; additions or any owner change fail |
| `@JsonAnySetter` methods | 24 in 10 files | Unknown-field rejection/validation only; additions or count drift fail |
| `Serializable` surface | 2 classes, 4 lexical facts | JPA composite IDs `LoginThrottleId` and `WarehouseScopeId`; no serialization stream API |
| Runtime tests | 4 | Failures 0, errors 0, skipped 0 required |

The 81 dynamic JDBC invocations are restricted to reviewed repositories:

- 2 audit-log invocations append a private fixed-column filter builder;
- 15 inventory/count/transfer invocations use fixed optional predicates, sort clauses
  and typed parameters;
- 1 Shopify inventory-publication invocation selects a fixed `FOR UPDATE`
  suffix from a private boolean;
- 6 order-list invocations use fixed call-site columns, enum-selected
  condition/sort expressions and typed parameters;
- 12 analytics-report invocations use fixed warehouse/date/category predicates
  and typed parameters;
- 5 logistics invocations use enum-selected expressions and fixed optional
  predicates with typed parameters;
- 22 procurement invocations use fixed optional predicates and enum-selected
  columns with typed parameters; and
- 2 warehouse-document invocations use fixed enum-selected search fragments;
  and
- 16 manual-movement invocations use fixed boolean/enum-selected fragments,
  pagination clauses and typed parameters.

All 39 direct JDBC owner files are locked by SHA-256. Any source edit requires
the complete owner to be reviewed and the baseline deliberately refreshed.
The audit-log owner additionally retains structural assertions requiring:

- the initial tenant predicate to remain a fixed literal;
- exactly two call sites whose column names are fixed literals `action` and
  `resource_type`;
- values to remain `MapSqlParameterSource` parameters;
- exactly two query expressions that append that bounded fragment; and
- no unreviewed nonliteral `@Query`, JPQL, native-query, or JDBC-template
  query text.

A new dynamic column, query variable, concatenated request value, formatted
query, Spring query expression, direct `Statement`, named query annotation, or
new JDBC-template owner, changed reviewed owner hash, or changed reviewed
dynamic-call count fails closed.

## Rejected application surfaces

The source and POM rules reject additions in these classes:

| Surface | Representative rejected facts |
| --- | --- |
| Jackson polymorphism | default typing activation/customization, polymorphic validators, `@JsonTypeInfo`, `@JsonSubTypes`, `@JsonTypeName`, subtype registration and custom deserializers |
| Java native serialization | `ObjectInputStream`, `ObjectInputFilter`, object read/write stream methods; any new `Serializable` owner |
| XML/object construction | `XMLDecoder`, XStream, JAXB unmarshalling, SAX/DOM factories/builders, StAX, schema/transformer and SAX input APIs |
| YAML | direct SnakeYAML imports, `Yaml` construction and unsafe constructors |
| Expressions/templates/scripts | SpEL evaluation contexts/parsers, EL, OGNL, MVEL, JSR-223, Groovy and common server template engines |
| Naming and remote lookup | JNDI/naming APIs and JNDI/LDAP/RMI source literals |
| Reflection/class loading | reflection packages, `Class.forName`, class loaders, `loadClass`, `defineClass` and method-handle lookup |
| Process execution | `ProcessBuilder`, `Runtime.exec`, process types and pipelines |
| SQL/JPQL/native query | nonliteral or interpolated query text, direct statement APIs and unreviewed JDBC-template ownership |
| Logging lookup/input | Log4j Core as a direct dependency; every application log call must remain a single fixed literal |
| Build/runtime additions | direct parser, template, expression, lookup, Log4j Core and executable-build plugin artifacts listed by the checker |
| Configuration | polymorphic typing, lookup/script-engine and external-entity-enabling configuration |

The direct-dependency rules do not claim that Spring's transitive classpath
contains none of these general-purpose libraries. They prevent application
code/configuration from acquiring a callable surface and require dependency
review before a direct artifact or execution plugin is introduced.

## Real Spring/PostgreSQL 16 request evidence

`DynamicCodeExecutionSurfacePostgresql16GateTest` starts the real Spring
application and all current Flyway migrations through V75 on a one-use
`postgres:16-alpine` container. It authenticates only synthetic platform and
tenant administrators created inside that disposable database.

The test sends 15 bounded requests:

| Matrix | IAM | Platform/shop | Product | Order | Supplier | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Root/nested `@class` and `@type` hints | 1 | 1 | 1 | 1 | 1 | Fixed 400 safe rejection |
| XML with DOCTYPE/entity and synthetic `urn:` system ID | 1 | 1 | 1 | 1 | 1 | Fixed 415 before XML parsing |
| Expression, JNDI-loopback, process, SQL and log-lookup canaries | 1 | 1 | 1 | 1 | 1 | Fixed 400 safe rejection |

The runtime canaries are inert strings. The test imports or invokes no socket,
URL, naming, XML decoder, native serialization, reflection-loading, or process
API. It does not start a canary listener, resolve DNS, make a JNDI/RMI/LDAP
call, execute a process, or read a file. The JNDI value uses loopback port 9;
the XML system identifier is a synthetic `urn:`. Safety evidence is the
combination of the complete application-source gate and Spring rejection, not
an attempted exploit.

For each five-domain matrix the test proves:

- response status is exactly 400 or 415, never 500;
- the response envelope contains only the existing safe fields and fixed
  messages/codes;
- response headers and bodies do not expose a canary, exception, stack,
  class/package name, classpath, local path, JDBC URL, or PostgreSQL detail;
- captured application logs contain no canary, stack/classpath/path/JDBC text
  and no WARN or ERROR record;
- business, user, session and login-throttle row counts do not change;
- tenant and platform committed-success audit counts do not change; and
- no audit detail contains any canary.

All five requests use the synthetic tenant administrator, so the supplemental
platform-administrator attempted-write filter is not invoked. Both committed
success-audit counts and attempted-only audit counts must remain unchanged;
there is no malicious-request database write of either class.

## Commands

Run the checker unit tests after a passing real-PG result exists:

```powershell
node --check platform/scripts/dynamic-code-execution-gate-check.mjs
node --check platform/scripts/dynamic-code-execution-gate-check.test.mjs
node --test platform/scripts/dynamic-code-execution-gate-check.test.mjs
node platform/scripts/dynamic-code-execution-gate-check.mjs
```

The real test uses only existing local images and the documented local Maven
cache. Maven is offline and Docker must not pull:

```powershell
$repository = (Get-Location).Path
docker run --rm --pull=never `
  --mount "type=bind,source=$repository,target=/workspace" `
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock `
  -v erp-maven-cache:/root/.m2 `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -w /workspace/platform/backend `
  --entrypoint sh xz-erp-maven:security-baseline-cache `
  -lc "mvn -o -B -Dtest=cn.xzkj.erp.security.DynamicCodeExecutionSurfacePostgresql16GateTest test"
```

The result checker requires exactly four tests with zero failures, errors, and
skips. A stale successful report cannot replace clean integration verification;
the report and changed sources must be produced and
reviewed from the same source revision.

## Capability limits and integration responsibility

This is a lexical application-source gate plus representative request
evidence, not a general bytecode SAST engine, third-party gadget database,
transitive CVE audit, JVM sandbox, egress firewall, database firewall, WAF, or
proof over future framework internals. It does not send exploit traffic or
prove every endpoint individually. The five selected write endpoints cover
the current IAM, platform/shop, product, order, and supplier advice/DTO
boundaries; the API contract and resource/redaction gates remain authoritative
for the complete endpoint inventory and shared safe error behavior.

MockMvc executes the real Spring filters, converters, validation, advice,
services, persistence and PostgreSQL path, but it does not exercise Nginx or a
raw Tomcat socket. XML safety here depends on unsupported media rejection and
the absence of an application XML parser surface; a future XML media contract
requires an explicit architecture and security review.

Any finding of a reachable polymorphic/gadget, XML entity, expression, lookup,
reflective loading, process, or request-controlled query path is a stop
condition. Report the exact source, safe reproduction, impact and smallest
proposed remediation for approval before changing
runtime code, configuration, dependencies, contracts, or migrations.
