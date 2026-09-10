#!/bin/sh
set -eu

umask 077

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${1:-"$root_dir/deploy/production.env"}
at_rest_check="$root_dir/deploy/verify-at-rest-encryption.sh"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this one-time preparation as root" >&2
  exit 1
fi
test -f "$env_file"
test ! -L "$env_file"
test -f "$at_rest_check"

for command_name in awk grep mktemp mountpoint openssl sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required preparation command is unavailable: $command_name" >&2
    exit 1
  }
done

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
postgres_dir=${XZDESK_POSTGRES_HOST_DIR:-$(read_setting XZDESK_POSTGRES_HOST_DIR /data/xzdesk/postgres)}
tls_dir=${XZDESK_POSTGRES_TLS_DIR:-$(read_setting XZDESK_POSTGRES_TLS_DIR /data/xzdesk/postgres-tls)}
require_data_mount=${XZDESK_REQUIRE_DATA_MOUNT:-$(read_setting XZDESK_REQUIRE_DATA_MOUNT true)}

case "$data_mount" in
  /*) ;;
  *) echo "XZDESK_DATA_MOUNT must be an absolute path" >&2; exit 1 ;;
esac
if [ "$tls_dir" != "$data_mount/xzdesk/postgres-tls" ]; then
  echo "XZDESK_POSTGRES_TLS_DIR must be $data_mount/xzdesk/postgres-tls" >&2
  exit 1
fi
if [ "$postgres_dir" != "$data_mount/xzdesk/postgres" ]; then
  echo "XZDESK_POSTGRES_HOST_DIR must be $data_mount/xzdesk/postgres" >&2
  exit 1
fi
case "$require_data_mount" in
  true|false) ;;
  *) echo "XZDESK_REQUIRE_DATA_MOUNT must be true or false" >&2; exit 1 ;;
esac
if [ "$require_data_mount" = true ] && ! mountpoint -q "$data_mount"; then
  echo "Preparation aborted: data disk is not mounted at $data_mount" >&2
  exit 1
fi

sh "$at_rest_check" "$env_file" "$data_mount"

if ! id ubuntu >/dev/null 2>&1 || [ "$(id -u ubuntu)" -ne 1000 ] || [ "$(id -g ubuntu)" -ne 1000 ]; then
  echo "The production ubuntu account must use uid/gid 1000 to match the API container" >&2
  exit 1
fi
install -d -o root -g root -m 755 "$data_mount/xzdesk"
install -d -o ubuntu -g ubuntu -m 700 "$data_mount/xzdesk/uploads" \
  "$data_mount/xzdesk/backups" "$data_mount/xzdesk/backup-staging"
install -d -o 70 -g 70 -m 700 "$postgres_dir"
install -d -o 70 -g 70 -m 700 "$tls_dir"

key_file="$tls_dir/server.key"
cert_file="$tls_dir/server.crt"
if { [ -e "$key_file" ] && [ ! -f "$key_file" ]; } || \
   { [ -e "$cert_file" ] && [ ! -f "$cert_file" ]; } || \
   [ -L "$key_file" ] || [ -L "$cert_file" ]; then
  echo "PostgreSQL TLS paths must be regular non-symbolic files" >&2
  exit 1
fi
if { [ -f "$key_file" ] && [ ! -f "$cert_file" ]; } || \
   { [ -f "$cert_file" ] && [ ! -f "$key_file" ]; }; then
  echo "PostgreSQL TLS key and certificate must either both exist or both be absent" >&2
  exit 1
fi

validate_pair() {
  key=$1
  cert=$2
  openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null
  openssl x509 -in "$cert" -noout -ext subjectAltName | grep -Eq 'DNS:postgres([,[:space:]]|$)'
  key_hash=$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')
  cert_hash=$(openssl x509 -in "$cert" -pubkey -noout | \
    openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}')
  test -n "$key_hash" && test "$key_hash" = "$cert_hash"
}

if [ -f "$key_file" ]; then
  validate_pair "$key_file" "$cert_file" || {
    echo "Existing PostgreSQL TLS certificate is invalid, mismatched, or expires within 30 days" >&2
    exit 1
  }
else
  staging=$(mktemp -d "$tls_dir/.prepare.XXXXXX")
  cleanup() {
    case "$staging" in
      "$tls_dir"/.prepare.*) rm -rf -- "$staging" ;;
    esac
  }
  trap cleanup EXIT HUP INT TERM
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
    -subj '/CN=postgres' -addext 'subjectAltName=DNS:postgres' \
    -keyout "$staging/server.key" -out "$staging/server.crt" >/dev/null 2>&1
  validate_pair "$staging/server.key" "$staging/server.crt"
  chown 70:70 "$staging/server.key"
  chmod 600 "$staging/server.key"
  chown root:root "$staging/server.crt"
  chmod 644 "$staging/server.crt"
  mv "$staging/server.key" "$key_file"
  mv "$staging/server.crt" "$cert_file"
fi

echo "Production data-protection preparation passed"
