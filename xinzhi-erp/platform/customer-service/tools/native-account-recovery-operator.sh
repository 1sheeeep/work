#!/bin/sh
# Fixed copied-CS UAT target only. Run via authenticated SSH, never via HTTP.
set -eu
umask 077
mode=${1:-inspect}
case "$mode" in inspect) ;; *) echo 'Retired: accounts use ERP identity; password recovery apply is disabled.' >&2; exit 2 ;; esac
root=/opt/xz-erp-customer-service-uat
api=xz-erp-customer-service-uat-api-1
db=xz-erp-customer-service-uat-postgres-1
tool_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test -f "$tool_dir/recovery"
test -f "$root/uat.env"
# Refuse a renamed/unrelated container or database stack.
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$api")" = xz-erp-customer-service-uat
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$db")" = xz-erp-customer-service-uat
image=$(docker inspect -f '{{.Image}}' "$api")
network=$(docker inspect -f '{{range $name, $value := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$db" | awk '$0 == "xz-erp-customer-service-uat_data" {print}')
test "$network" = xz-erp-customer-service-uat_data
test "$(docker inspect -f '{{.State.Running}}' "$db")" = true

if [ "$mode" = inspect ]; then
  exec docker run --rm --user "$(id -u):$(id -g)" --network "$network" --env-file "$root/uat.env" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    -v "$tool_dir/recovery:/recovery:ro" --entrypoint /bin/sh "$image" -c '
      export XZDESK_ENVIRONMENT=uat
      export DATABASE_URL="postgres://customer_service_runtime:${XZDESK_UAT_RUNTIME_DB_PASSWORD}@postgres:5432/customer_service_uat?sslmode=disable"
      exec /recovery'
fi

# Applying is deliberately unavailable while the old snapshot-caching service
# is running. The release operator must schedule the native cutover first.
if [ "$(docker inspect -f '{{.State.Running}}' "$api")" != false ]; then
  echo 'RECOVERY_BLOCKED: finish release preparation and stop only the copied-CS UAT API before applying.' >&2
  exit 1
fi
backup="$root/backups/native-recovery-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$backup"
docker exec "$db" pg_dump -U postgres -d customer_service_uat -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
docker exec -i "$db" pg_restore --list < "$backup/database.dump" > /dev/null
cp "$root/uat.env" "$backup/uat.env"
cp "$root/compose.uat.yaml" "$backup/compose.uat.yaml"
(cd "$backup" && sha256sum database.dump uat.env compose.uat.yaml > SHA256SUMS && sha256sum -c SHA256SUMS > /dev/null)
exec docker run --rm -i --user "$(id -u):$(id -g)" --network "$network" --env-file "$root/uat.env" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$tool_dir/recovery:/recovery:ro" -v "$backup:/recovery-backup" \
  --entrypoint /bin/sh "$image" -c '
    export XZDESK_ENVIRONMENT=uat
    export DATABASE_URL="postgres://customer_service_runtime:${XZDESK_UAT_RUNTIME_DB_PASSWORD}@postgres:5432/customer_service_uat?sslmode=disable"
    exec /recovery --apply --backup-dir /recovery-backup'
