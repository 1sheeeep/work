#!/bin/sh
set -eu

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
drill_db=recruitment_restore_drill
drill_dir=$(mktemp -d)
cleanup() {
  compose exec -T db sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists --force recruitment_restore_drill' >/dev/null 2>&1 || true
  rm -rf "$drill_dir"
}
trap cleanup EXIT

COMPOSE_FILE_PATH=$compose_file COMPOSE_ENV_FILE=$compose_env_file "$project_dir/scripts/backup.sh" "$drill_dir"
backup_file=$(find "$drill_dir" -name '*.dump' -type f | head -1)
compose exec -T db sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists --force recruitment_restore_drill'
compose exec -T db sh -lc 'createdb -U "$POSTGRES_USER" recruitment_restore_drill'
compose exec -T db sh -lc 'pg_restore -U "$POSTGRES_USER" -d recruitment_restore_drill --no-owner --no-privileges' < "$backup_file"
compose exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d recruitment_restore_drill -v ON_ERROR_STOP=1 -c "SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1" -c "SELECT count(*) AS audit_rows FROM audit_logs"'
echo "Isolated restore drill passed: $drill_db"
