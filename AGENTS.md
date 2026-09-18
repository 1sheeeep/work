# Recruitment console repository guidance

## Code Review Rules

- Do not expose candidate data, credentials, cookies, tokens, or message bodies in logs, audit records, fixtures, or error responses.
- Treat database migrations as release-impacting changes: preserve backward compatibility, verify idempotence where applicable, and document the backup and rollback plan in the pull request.
- Do not weaken the recruitment release gateway, environment-scoped credentials, readiness checks, or fail-closed behavior just to make a deployment pass.
- Keep automated tests, deployment health, real external-service results, and business acceptance evidence distinct; do not present one as another.
