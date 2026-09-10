#!/bin/sh
set -eu

test -n "${XZDESK_UAT_RUNTIME_DB_PASSWORD:-}"
test -n "${XZDESK_UAT_MIGRATOR_DB_PASSWORD:-}"

psql \
  --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set runtime_password="$XZDESK_UAT_RUNTIME_DB_PASSWORD" \
  --set migrator_password="$XZDESK_UAT_MIGRATOR_DB_PASSWORD" <<'SQL'
ALTER ROLE customer_service_runtime PASSWORD :'runtime_password';
ALTER ROLE customer_service_migrator PASSWORD :'migrator_password';
SQL
