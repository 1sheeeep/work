#!/bin/sh
set -eu

umask 077

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compose_file="$root_dir/deploy/compose.production.yml"
env_file="$root_dir/deploy/production.env"
at_rest_check="$root_dir/deploy/verify-at-rest-encryption.sh"

test -f "$compose_file"
test -f "$env_file"
test -f "$at_rest_check"

read_setting() {
  key=$1
  default_value=$2
  value=$(awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END { sub(/\r$/, "", value); print value }
  ' "$env_file")
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

data_mount=${XZDESK_DATA_MOUNT:-$(read_setting XZDESK_DATA_MOUNT /data)}
upload_dir=${XZDESK_UPLOAD_HOST_DIR:-$(read_setting XZDESK_UPLOAD_HOST_DIR /data/xzdesk/uploads)}
backup_dir=${XZDESK_BACKUP_DIR:-$(read_setting XZDESK_BACKUP_DIR /data/xzdesk/backups)}
staging_root=${XZDESK_BACKUP_STAGING_DIR:-$(read_setting XZDESK_BACKUP_STAGING_DIR /data/xzdesk/backup-staging)}
recipients_file=${XZDESK_BACKUP_AGE_RECIPIENTS_FILE:-$(read_setting XZDESK_BACKUP_AGE_RECIPIENTS_FILE '')}
retention_days=${XZDESK_BACKUP_RETENTION_DAYS:-$(read_setting XZDESK_BACKUP_RETENTION_DAYS 30)}
require_data_mount=${XZDESK_REQUIRE_DATA_MOUNT:-$(read_setting XZDESK_REQUIRE_DATA_MOUNT true)}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
daily_dir="$backup_dir/daily"
destination="$daily_dir/$stamp"
destination_tmp="$daily_dir/.$stamp.tmp"

for command_name in age tar sha256sum docker mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required backup command is unavailable: $command_name" >&2
    exit 1
  }
done
if ! tar --version 2>/dev/null | grep -q 'GNU tar'; then
  echo "Required backup command is unavailable: GNU tar" >&2
  exit 1
fi

case "$data_mount" in
  /*) ;;
  *) echo "XZDESK_DATA_MOUNT must be an absolute path" >&2; exit 1 ;;
esac
case "$upload_dir" in
  "$data_mount"/xzdesk/uploads) ;;
  *) echo "Refusing to read uploads outside $data_mount/xzdesk/uploads" >&2; exit 1 ;;
esac
case "$backup_dir" in
  "$data_mount"/xzdesk/backups) ;;
  *) echo "Refusing to use backup directory outside $data_mount/xzdesk/backups" >&2; exit 1 ;;
esac
case "$staging_root" in
  "$data_mount"/xzdesk/backup-staging) ;;
  *) echo "Refusing to stage backup outside $data_mount/xzdesk/backup-staging" >&2; exit 1 ;;
esac

case "$require_data_mount" in
  true|false) ;;
  *) echo "XZDESK_REQUIRE_DATA_MOUNT must be true or false" >&2; exit 1 ;;
esac
if [ "$require_data_mount" = true ] && ! mountpoint -q "$data_mount"; then
  echo "Backup aborted: data disk is not mounted at $data_mount" >&2
  exit 1
fi

case "$retention_days" in
  ''|*[!0-9]*) echo "XZDESK_BACKUP_RETENTION_DAYS must be a positive integer" >&2; exit 1 ;;
esac
if [ "$retention_days" -lt 1 ] || [ "$retention_days" -gt 30 ]; then
  echo "XZDESK_BACKUP_RETENTION_DAYS must be between 1 and 30" >&2
  exit 1
fi

if [ -z "$recipients_file" ] || [ ! -f "$recipients_file" ] || [ -L "$recipients_file" ]; then
  echo "XZDESK_BACKUP_AGE_RECIPIENTS_FILE must reference a regular non-symbolic age recipients file" >&2
  exit 1
fi
case "$recipients_file" in
  /*) ;;
  *) echo "XZDESK_BACKUP_AGE_RECIPIENTS_FILE must be an absolute path" >&2; exit 1 ;;
esac

sh "$at_rest_check" "$env_file" "$data_mount"

test -d "$upload_dir"
mkdir -p "$daily_dir" "$staging_root"
chmod 700 "$backup_dir" "$daily_dir" "$staging_root"

legacy_plaintext=$(find "$backup_dir" -type f \( \
  -name 'postgres.dump' -o -name 'production.env' -o -name '*.tar' \
\) -print -quit)
if [ -n "$legacy_plaintext" ]; then
  echo "Backup aborted: an unencrypted legacy backup remains under the backup directory" >&2
  exit 1
fi
if [ -d "$backup_dir/monthly" ] && find "$backup_dir/monthly" -mindepth 1 -print -quit | grep -q .; then
  echo "Backup aborted: legacy monthly backups must be reviewed before enforcing the 30-day policy" >&2
  exit 1
fi

staging=$(mktemp -d "$staging_root/.xzdesk-backup-$stamp.XXXXXX")
case "$staging" in
  "$staging_root"/.xzdesk-backup-*) ;;
  *) echo "Backup staging allocation escaped the approved directory" >&2; exit 1 ;;
esac

cleanup() {
  case "$staging" in
    "$staging_root"/.xzdesk-backup-*) rm -rf -- "$staging" ;;
  esac
  case "$destination_tmp" in
    "$daily_dir"/.*.tmp) rm -rf -- "$destination_tmp" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

mkdir "$staging/database" "$staging/config"
dump_file="$staging/database/postgres.dump"
archive_file="$staging/xzdesk-backup.tar"
encrypted_tmp="$destination_tmp/xzdesk-backup.tar.age.tmp"

docker compose --env-file "$env_file" -f "$compose_file" \
  exec -T postgres pg_dump -U support -d shopify_support -Fc > "$dump_file"
docker compose --env-file "$env_file" -f "$compose_file" \
  exec -T postgres pg_restore --list < "$dump_file" >/dev/null

cp "$env_file" "$staging/config/production.env"
cp "$compose_file" "$staging/config/compose.production.yml"
cp "$root_dir/deploy/caddy/Caddyfile" "$staging/config/Caddyfile"
cat > "$staging/MANIFEST.txt" <<EOF
format=xzdesk-encrypted-backup-v1
created_at_utc=$stamp
backup_retention_days=$retention_days
encryption=age-recipient
contents=database,uploads,configuration
EOF
chmod 600 "$staging/database/postgres.dump" "$staging/config/"* "$staging/MANIFEST.txt"

upload_parent=$(dirname -- "$upload_dir")
upload_name=$(basename -- "$upload_dir")
tar -cf "$archive_file" \
  -C "$staging" MANIFEST.txt database config \
  -C "$upload_parent" "$upload_name"

mkdir "$destination_tmp"
age -R "$recipients_file" -o "$encrypted_tmp" "$archive_file"
test -s "$encrypted_tmp"
mv "$encrypted_tmp" "$destination_tmp/xzdesk-backup.tar.age"
(cd "$destination_tmp" && sha256sum xzdesk-backup.tar.age > SHA256SUMS)
chmod 600 "$destination_tmp/xzdesk-backup.tar.age" "$destination_tmp/SHA256SUMS"
mv "$destination_tmp" "$destination"

retention_minutes=$((retention_days * 1440))
find "$daily_dir" -mindepth 1 -maxdepth 1 -type d \
  -name '20??????T??????Z' -mmin "+$retention_minutes" -exec rm -rf -- {} +

echo "Encrypted backup completed: $destination"
