#!/bin/sh
set -eu

if [ "$#" -ne 2 ] || [ "$2" != "--confirm" ]; then
  echo "Usage: $0 /absolute/path/to/backup.dump --confirm" >&2
  exit 2
fi
backup_file=$1
test -f "$backup_file"
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compose_file=${COMPOSE_FILE_PATH:-$project_dir/compose.yaml}
compose_env_file=${COMPOSE_ENV_FILE:-}
compose() {
  if [ -n "$compose_env_file" ]; then
    docker compose --env-file "$compose_env_file" -f "$compose_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}
services_stopped=false
restart_services() {
  if [ "$services_stopped" = true ]; then compose start backend web >/dev/null; fi
}
trap restart_services EXIT

COMPOSE_FILE_PATH=$compose_file COMPOSE_ENV_FILE=$compose_env_file "$project_dir/scripts/backup.sh" "$project_dir/backups/pre-restore"
compose stop backend web
services_stopped=true
compose exec -T db sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "$backup_file"
compose start backend web
services_stopped=false
compose ps
echo "Restore completed from: $backup_file"
