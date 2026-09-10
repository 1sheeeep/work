#!/bin/bash
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
release=${1:?release id required}
[[ "$release" =~ ^[A-Za-z0-9._-]+$ ]]
backup=/opt/xz-erp-test/backups/shared-identity-$release
name=xz-erp-shared-backup-check
test -f "$backup/erp.dump" && test -f "$backup/cs.dump"
if docker container inspect "$name" > /dev/null 2>&1; then echo 'Restore-check container already exists; refusing reuse.' >&2; exit 1; fi
cleanup() {
  if test "$(docker inspect -f '{{index .Config.Labels "xz.shared-backup-check"}}' "$name" 2>/dev/null)" = "$release"; then
    docker rm -f "$name" > /dev/null
  fi
}
trap cleanup EXIT
docker run -d --name "$name" --label "xz.shared-backup-check=$release" --network none --memory 512m --cpus 0.3 --pids-limit 100 --tmpfs /var/lib/postgresql/data:rw,size=256m --env POSTGRES_HOST_AUTH_METHOD=trust xz-erp-postgres:16-alpine-57c72fd2a128 > /dev/null
for attempt in {1..30}; do
  if docker exec "$name" pg_isready -U postgres > /dev/null; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -U postgres > /dev/null
for business in erp cs; do
  docker exec "$name" createdb -U postgres "${business}_restore"
  docker exec -i "$name" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d "${business}_restore" < "$backup/$business.dump"
  count=$(docker exec "$name" psql -U postgres -d "${business}_restore" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
  [[ "$count" =~ ^[0-9]+$ ]] && test "$count" -gt 0
  printf '%s restore OK, tables=%s\n' "$business" "$count"
done
docker exec "$name" psql -U postgres -d erp_restore -Atc 'SELECT max(version::integer) FROM flyway_schema_history WHERE success'
