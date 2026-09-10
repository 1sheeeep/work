#!/bin/sh
set -eu

umask 077

release_dir=${1:-}
root_dir=${XZDESK_UAT_ROOT:-/opt/xz-erp-customer-service-uat}
erp_env_file=${ERP_STAGING_ENV_FILE:-/opt/xz-erp-test/staging.env}
shopify_env_file=${SHOPIFY_REVIEW_ENV_FILE:-/opt/xinzhi-erp/shopify/shopify.env}
compose_file="$root_dir/compose.uat.yaml"
env_file="$root_dir/uat.env"

if [ -z "$release_dir" ]; then
  echo "Usage: deploy-uat.sh RELEASE_DIR" >&2
  exit 2
fi

for required in images.tar release.env compose.uat.yaml SHA256SUMS; do
  test -f "$release_dir/$required"
done
test -f "$erp_env_file"
test -f "$shopify_env_file"
(cd "$release_dir" && sha256sum -c SHA256SUMS >/dev/null)

read_env() {
  file=$1
  key=$2
  awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END { sub(/\r$/, "", value); print value }
  ' "$file"
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
      if (!written) print key "=" value
    }
  ' "$file" > "$temporary"
  mv "$temporary" "$file"
}

release_id=$(read_env "$release_dir/release.env" XZDESK_UAT_RELEASE_ID)
api_image=$(read_env "$release_dir/release.env" XZDESK_UAT_API_IMAGE)
web_image=$(read_env "$release_dir/release.env" XZDESK_UAT_WEB_IMAGE)
postgres_image=$(read_env "$release_dir/release.env" XZDESK_UAT_POSTGRES_IMAGE)
erp_connector_token=$(read_env "$erp_env_file" ERP_XZ_ERP_APP_CONNECTOR_TOKEN)
shopify_app_secret=$(read_env "$shopify_env_file" SHOPIFY_APP_API_SECRET)
if [ -z "$shopify_app_secret" ]; then
  shopify_app_secret=$(read_env "$shopify_env_file" SHOPIFY_API_SECRET)
fi
public_legal_name=$(read_env "$shopify_env_file" SHOPIFY_PUBLIC_LEGAL_NAME)
public_support_email=$(read_env "$shopify_env_file" SHOPIFY_PUBLIC_SUPPORT_EMAIL)
public_effective_date=$(read_env "$shopify_env_file" SHOPIFY_PUBLIC_EFFECTIVE_DATE)

[ -n "$release_id" ] && [ -n "$api_image" ] && [ -n "$web_image" ] \
  && [ -n "$postgres_image" ] && [ -n "$erp_connector_token" ] \
  && [ -n "$shopify_app_secret" ] && [ -n "$public_legal_name" ] \
  && [ -n "$public_support_email" ] && [ -n "$public_effective_date" ] || {
  echo "UAT release metadata, connector credential or public app information is incomplete" >&2
  exit 1
}

mkdir -p "$root_dir"
docker load -i "$release_dir/images.tar" >/dev/null
cp "$release_dir/compose.uat.yaml" "$compose_file"

if [ ! -f "$env_file" ]; then
  {
    printf 'XZDESK_UAT_RELEASE_ID=%s\n' "$release_id"
    printf 'XZDESK_UAT_API_IMAGE=%s\n' "$api_image"
    printf 'XZDESK_UAT_WEB_IMAGE=%s\n' "$web_image"
    printf 'XZDESK_UAT_POSTGRES_IMAGE=%s\n' "$postgres_image"
    printf 'XZDESK_UAT_DB_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'XZDESK_UAT_RUNTIME_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'XZDESK_UAT_MIGRATOR_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'XZDESK_UAT_AI_SETTINGS_KEY=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
    printf 'XZDESK_UAT_ERP_CONNECTOR_TOKEN=%s\n' "$erp_connector_token"
    printf 'XZDESK_UAT_SHOPIFY_APP_API_SECRET=%s\n' "$shopify_app_secret"
    printf 'XZDESK_UAT_XZ_ERP_LEGAL_NAME=%s\n' "$public_legal_name"
    printf 'XZDESK_UAT_XZ_ERP_SUPPORT_EMAIL=%s\n' "$public_support_email"
    printf 'XZDESK_UAT_XZ_ERP_PRIVACY_EFFECTIVE_DATE=%s\n' "$public_effective_date"
    printf 'XZDESK_UAT_ERP_ORIGIN=https://erp.xzkj.ai\n'
    printf 'XZDESK_UAT_PUBLIC_ORIGIN=https://kf-uat.xzkj.ai\n'
    printf 'XZDESK_UAT_HTTP_PORT=18787\n'
  } > "$env_file"
else
  set_env XZDESK_UAT_RELEASE_ID "$release_id" "$env_file"
  set_env XZDESK_UAT_API_IMAGE "$api_image" "$env_file"
  set_env XZDESK_UAT_WEB_IMAGE "$web_image" "$env_file"
  set_env XZDESK_UAT_POSTGRES_IMAGE "$postgres_image" "$env_file"
  set_env XZDESK_UAT_ERP_CONNECTOR_TOKEN "$erp_connector_token" "$env_file"
  set_env XZDESK_UAT_SHOPIFY_APP_API_SECRET "$shopify_app_secret" "$env_file"
  set_env XZDESK_UAT_XZ_ERP_LEGAL_NAME "$public_legal_name" "$env_file"
  set_env XZDESK_UAT_XZ_ERP_SUPPORT_EMAIL "$public_support_email" "$env_file"
  set_env XZDESK_UAT_XZ_ERP_PRIVACY_EFFECTIVE_DATE "$public_effective_date" "$env_file"
fi

chmod 600 "$env_file"
chmod 644 "$compose_file"

docker compose \
  --project-name xz-erp-customer-service-uat \
  --env-file "$env_file" \
  -f "$compose_file" \
  up -d --remove-orphans

http_port=$(read_env "$env_file" XZDESK_UAT_HTTP_PORT)
attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:$http_port/readyz" >/dev/null \
  && curl --fail --silent --show-error "http://127.0.0.1:$http_port/healthz" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 40 ]; then
    docker compose \
      --project-name xz-erp-customer-service-uat \
      --env-file "$env_file" \
      -f "$compose_file" \
      ps
    echo "Customer-service UAT readiness check failed" >&2
    exit 1
  fi
  sleep 2
done

echo "Customer-service UAT deployed locally on the server: $release_id"
echo "Public traffic remains unchanged until ingress.caddy is applied to the shared edge."
