#!/bin/sh
set -eu

umask 077

env_file=${1:-}
data_mount=${2:-}

if [ -z "$env_file" ] || [ ! -f "$env_file" ] || [ -L "$env_file" ]; then
  echo "At-rest verification requires a regular non-symbolic environment file" >&2
  exit 1
fi
case "$data_mount" in
  /*) ;;
  *) echo "At-rest verification requires an absolute data mount" >&2; exit 1 ;;
esac
if ! mountpoint -q "$data_mount"; then
  echo "At-rest verification requires a dedicated data mount at $data_mount" >&2
  exit 1
fi

read_setting() {
  key=$1
  value=$(awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END { sub(/\r$/, "", value); print value }
  ' "$env_file")
  printf '%s' "$value"
}

mode=${XZDESK_AT_REST_ENCRYPTION_MODE:-$(read_setting XZDESK_AT_REST_ENCRYPTION_MODE)}
evidence_file=${XZDESK_AT_REST_ENCRYPTION_EVIDENCE_FILE:-$(read_setting XZDESK_AT_REST_ENCRYPTION_EVIDENCE_FILE)}
postgres_dir=${XZDESK_POSTGRES_HOST_DIR:-$(read_setting XZDESK_POSTGRES_HOST_DIR)}
upload_dir=${XZDESK_UPLOAD_HOST_DIR:-$(read_setting XZDESK_UPLOAD_HOST_DIR)}
backup_dir=${XZDESK_BACKUP_DIR:-$(read_setting XZDESK_BACKUP_DIR)}

if [ "$postgres_dir" != "$data_mount/xzdesk/postgres" ]; then
  echo "At-rest verification requires PostgreSQL under $data_mount/xzdesk/postgres" >&2
  exit 1
fi
if [ "$upload_dir" != "$data_mount/xzdesk/uploads" ]; then
  echo "At-rest verification requires uploads under $data_mount/xzdesk/uploads" >&2
  exit 1
fi
if [ "$backup_dir" != "$data_mount/xzdesk/backups" ]; then
  echo "At-rest verification requires backups under $data_mount/xzdesk/backups" >&2
  exit 1
fi

case "$mode" in
  provider-managed)
    if [ -z "$evidence_file" ] || [ ! -f "$evidence_file" ] || [ -L "$evidence_file" ]; then
      echo "At-rest verification requires a regular non-symbolic provider evidence file" >&2
      exit 1
    fi
    case "$evidence_file" in
      /*) ;;
      *) echo "At-rest evidence path must be absolute" >&2; exit 1 ;;
    esac
    grep -Eq '^database_encryption=enabled$' "$evidence_file"
    grep -Eq '^uploads_encryption=enabled$' "$evidence_file"
    grep -Eq '^backups_encryption=enabled$' "$evidence_file"
    grep -Eq '^verified_at_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$evidence_file"
    ;;
  *)
    echo "XZDESK_AT_REST_ENCRYPTION_MODE must be provider-managed for the current production layout" >&2
    exit 1
    ;;
esac

echo "At-rest encryption preflight passed: mode=$mode"
