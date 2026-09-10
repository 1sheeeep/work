# Authentication and Sensitive Response Cache Gate

## Purpose

This gate protects browser-facing and proxy-facing authentication, session,
one-time credential, platform administration, IAM, audit, and supplier API
responses from shared-cache persistence and response-header secret disclosure.
It was established from baseline `2c206fa`.

The executable gate is
`SecurityResponseHeadersIntegrationTest`. It boots the real Spring application
and `springSecurityFilterChain`, migrates a test-owned PostgreSQL 16 database,
uses API calls to build its test state except for one direct historical
supplier fixture used only by the retained sensitive-read coverage, and relies
on the existing `PostgresqlApiFixture`/Testcontainers lifecycle to remove the
database container after the test. Docker startup failure fails the test; there
is no Docker-unavailable skip and no external JDBC, container, or path override.

On the current Docker Desktop runner, Maven is executed inside the repository's
Maven image with `/var/run/docker.sock` mounted and
`TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`. Testcontainers `1.21.4`
negotiates a compatible Docker API version with current Docker Desktop.

## Enforced application contract

Every covered sensitive success or failure response must:

- include `Cache-Control` directives `no-store`, `no-cache`, `max-age=0`, and
  `must-revalidate`;
- include `Pragma: no-cache` and `Expires: 0`;
- include `X-Content-Type-Options: nosniff`;
- deny framing with `X-Frame-Options: DENY` or a CSP
  `frame-ancestors 'none'` directive;
- emit no `Set-Cookie`, because these APIs use stateless bearer sessions;
- avoid redirects and omit `Location`, except that resource creation may return
  an origin-relative, query-free, fragment-free `Location`;
- never place generated access tokens, one-time credentials, passwords,
  authorization values, internal-path/exception canaries, or malicious
  `Origin`, `Host`, `Forwarded`, `X-Forwarded-*`, and `X-Request-Id` values in
  any response header.

If `WWW-Authenticate`, `Referrer-Policy`, CSP, or HSTS is added, the gate checks
that the value is non-empty, single-line, and free of request/secret canaries.
For a present authentication challenge, the scheme must be `Bearer`.

## Coverage matrix

| Area | Positive coverage | Negative or replay coverage |
| --- | --- | --- |
| Enterprise authentication | login token response, repeated login, `/auth/me` | failed login, logout, revoked token returns 401 |
| Enterprise one-time credential | activation redemption returns 204 | repeated consumption returns the uniform 400 response |
| Platform authentication | `SYSTEM_ADMIN` login, repeated login, `/auth/me` | failed login, logout, revoked token returns 401 |
| Platform one-time credential | administrator activation credential issue and redemption | repeated consumption returns the uniform 401 response |
| Platform tenant switching | enter tenant, tenant-session `/auth/me`, base session remains valid | leave tenant, revoked tenant-session token returns 401 |
| Authorization | authorized platform and tenant routes | platform token on tenant route and tenant token on platform route return 403 |
| Sensitive GETs | system administrators, current identity, own sessions, IAM members, IAM audit logs, suppliers with contact data | repeated and `If-None-Match`/`If-Modified-Since` requests remain `no-store` |
| Header injection | valid API traffic carrying hostile browser/proxy headers | no hostile request header or authorization canary appears in response headers |
| Redirect surface | authentication, session, credential, IAM member creation, and sensitive GET responses do not redirect | every covered response omits `Location`; relative resource-creation locations are checked by the browser-origin trust-boundary gate |

## Current responsibility boundary

The application currently supplies cache prevention, MIME-sniffing protection,
and `X-Frame-Options: DENY` through the Spring Security response-header chain.
The gate treats these as required application behavior because the response may
contain bearer tokens, one-time credentials, identity, administrator, member,
audit, or supplier contact data before any edge policy is applied.

The following are documented boundaries, not production cache defects found by
this task:

- `Referrer-Policy` is not currently emitted. This is a browser-hardening GAP;
  the product-wide policy remains to be selected.
- A full CSP is not currently emitted. Framing is covered by
  `X-Frame-Options: DENY`; the broader CSP ownership and policy remain a GAP.
- The JSON bearer-resource 401 response does not currently emit
  `WWW-Authenticate`. This is an authentication interoperability/hardening GAP,
  not a cache or redirect leak.
- HSTS is not emitted on the HTTP integration path. Production TLS termination,
  HSTS, trusted-proxy topology, and the production domain are edge decisions and
  must not be inferred or configured by this gate.
- The gate verifies application responses before an external reverse proxy or
  CDN. Edge configuration must preserve or strengthen `no-store` and must be
  checked during integrated staging review.

## Change boundaries

This gate changes no API shape, permission code, state transition, migration,
production domain, TLS/HSTS setting, reverse-proxy configuration, logging
policy, or business behavior. Migration `V40` remains unallocated and unused.
