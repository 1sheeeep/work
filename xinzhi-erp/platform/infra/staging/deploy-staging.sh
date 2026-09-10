#!/bin/sh
set -eu

umask 077

release_dir=${1:-}
root_dir=${ERP_STAGING_ROOT:-/opt/xz-erp-test}
compose_file="$root_dir/compose.staging.yaml"
env_file="$root_dir/staging.env"

if [ -z "$release_dir" ]; then
  echo "Usage: deploy-staging.sh RELEASE_DIR" >&2
  exit 2
fi

test -f "$release_dir/images.tar"
test -f "$release_dir/release.env"
test -f "$release_dir/compose.staging.yaml"
test -f "$release_dir/SHA256SUMS"

(cd "$release_dir" && sha256sum -c SHA256SUMS >/dev/null)

read_env() {
  key=$1
  awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END { sub(/\r$/, "", value); print value }
  ' "$release_dir/release.env"
}

set_env() {
  key=$1
  value=$2
  file=$3
  temporary="$file.tmp"

  awk -v key="$key" -v value="$value" '
    BEGIN { written = 0 }
    index($0, key "=") == 1 {
      if (!written) {
        print key "=" value
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) {
        print key "=" value
      }
    }
  ' "$file" > "$temporary"
  mv "$temporary" "$file"
}

release_id=$(read_env ERP_RELEASE_ID)
backend_image=$(read_env ERP_BACKEND_IMAGE)
web_image=$(read_env ERP_WEB_IMAGE)
postgres_image=$(read_env ERP_POSTGRES_IMAGE)
customer_service_entry_origin=$(read_env ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN)

[ -n "$release_id" ] && [ -n "$backend_image" ] && [ -n "$web_image" ] && [ -n "$postgres_image" ] && [ -n "$customer_service_entry_origin" ] || {
  echo "Release metadata is incomplete" >&2
  exit 1
}

mkdir -p "$root_dir"
docker load -i "$release_dir/images.tar" >/dev/null
cp "$release_dir/compose.staging.yaml" "$compose_file"

if [ ! -f "$env_file" ]; then
  database_password=$(openssl rand -hex 32)
  logistics_credential_key=$(openssl rand -base64 32 | tr -d '\n')
  {
    printf 'ERP_RELEASE_ID=%s\n' "$release_id"
    printf 'ERP_HTTP_PORT=18888\n'
    printf 'ERP_DB_NAME=xz_erp_test\n'
    printf 'ERP_DB_USER=erp_test\n'
    printf 'ERP_DB_PASSWORD=%s\n' "$database_password"
    printf 'ERP_LOGISTICS_CREDENTIAL_KEY=%s\n' "$logistics_credential_key"
    printf 'ERP_XZ_ERP_APP_CONNECTOR_TOKEN=%s\n' "$(openssl rand -hex 32)"
    printf 'ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN=%s\n' "$customer_service_entry_origin"
    printf 'ERP_BACKEND_IMAGE=%s\n' "$backend_image"
    printf 'ERP_WEB_IMAGE=%s\n' "$web_image"
    printf 'ERP_POSTGRES_IMAGE=%s\n' "$postgres_image"
  } > "$env_file"
else
  set_env ERP_RELEASE_ID "$release_id" "$env_file"
  set_env ERP_BACKEND_IMAGE "$backend_image" "$env_file"
  set_env ERP_WEB_IMAGE "$web_image" "$env_file"
  set_env ERP_POSTGRES_IMAGE "$postgres_image" "$env_file"
  set_env ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN "$customer_service_entry_origin" "$env_file"
  if ! grep -Eq '^ERP_LOGISTICS_CREDENTIAL_KEY=.+$' "$env_file"; then
    logistics_credential_key=$(openssl rand -base64 32 | tr -d '\n')
    set_env ERP_LOGISTICS_CREDENTIAL_KEY "$logistics_credential_key" "$env_file"
  fi
  if ! grep -Eq '^ERP_XZ_ERP_APP_CONNECTOR_TOKEN=.+$' "$env_file"; then
    set_env ERP_XZ_ERP_APP_CONNECTOR_TOKEN "$(openssl rand -hex 32)" "$env_file"
  fi
fi

chmod 600 "$env_file"
chmod 644 "$compose_file"

docker compose \
  --project-name xz-erp-test \
  --env-file "$env_file" \
  -f "$compose_file" \
  up -d --remove-orphans

attempt=0
until curl --fail --silent --show-error http://127.0.0.1:18888/readyz >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose \
      --project-name xz-erp-test \
      --env-file "$env_file" \
      -f "$compose_file" \
      ps
    echo "ERP staging edge readiness check failed" >&2
    exit 1
  fi
  sleep 2
done

echo "ERP test deployed: $release_id"
