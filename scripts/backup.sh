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
backup_dir=${1:-$project_dir/backups}
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/recruitment-$stamp.dump"

compose exec -T db sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$target"
test -s "$target"
sha256sum "$target" > "$target.sha256"
echo "Backup created: $target"
