#!/usr/bin/env bash
set -euo pipefail

shopify_dir="${SHOPIFY_DEPLOY_DIR:-/opt/xinzhi-erp/shopify}"
env_file="${shopify_dir}/shopify.env"
compose_file="${shopify_dir}/compose.shopify.yaml"
container_name="xz-erp-shopify-connector-1"

if [[ ! -f "${env_file}" || ! -f "${compose_file}" ]]; then
  printf 'Shopify deployment files were not found in %s.\n' "${shopify_dir}" >&2
  exit 1
fi

read -r -p 'Shopify Client ID: ' api_key
read -r -s -p 'Shopify Client Secret (hidden): ' api_secret
printf '\n'

if [[ ! "${api_key}" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
  printf 'Client ID format is invalid. No changes were made.\n' >&2
  exit 1
fi
if [[ ! "${api_secret}" =~ ^[A-Za-z0-9_-]{16,256}$ ]]; then
  printf 'Client Secret format is invalid. No changes were made.\n' >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${env_file}.before-public-app-${timestamp}"
temp_file="$(mktemp "${shopify_dir}/shopify.env.XXXXXX")"
cleanup() {
  unset api_key api_secret
  rm -f "${temp_file}"
}
trap cleanup EXIT

cp -p "${env_file}" "${backup_file}"
grep -v -E '^(SHOPIFY_APP_API_KEY|SHOPIFY_APP_API_SECRET)=' "${env_file}" > "${temp_file}"
printf 'SHOPIFY_APP_API_KEY=%s\n' "${api_key}" >> "${temp_file}"
printf 'SHOPIFY_APP_API_SECRET=%s\n' "${api_secret}" >> "${temp_file}"
chmod 0600 "${temp_file}"
mv -f "${temp_file}" "${env_file}"
unset api_key api_secret

cd "${shopify_dir}"
if ! docker compose --env-file "${env_file}" -f "${compose_file}" config >/dev/null; then
  cp -p "${backup_file}" "${env_file}"
  printf 'Configuration validation failed; previous credentials were restored.\n' >&2
  exit 1
fi

if ! docker compose --env-file "${env_file}" -f "${compose_file}" up -d --no-deps connector; then
  cp -p "${backup_file}" "${env_file}"
  docker compose --env-file "${env_file}" -f "${compose_file}" up -d --no-deps connector
  printf 'Connector restart failed; previous credentials were restored.\n' >&2
  exit 1
fi

for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "${container_name}" 2>/dev/null || true)"
  [[ "${status}" == 'healthy' ]] && break
  sleep 2
done

status="$(docker inspect -f '{{.State.Health.Status}}' "${container_name}" 2>/dev/null || true)"
if [[ "${status}" != 'healthy' ]]; then
  cp -p "${backup_file}" "${env_file}"
  docker compose --env-file "${env_file}" -f "${compose_file}" up -d --no-deps connector
  printf 'Connector health check failed; previous credentials were restored.\n' >&2
  exit 1
fi

printf 'Shopify Public App credentials updated; connector is healthy.\n'
