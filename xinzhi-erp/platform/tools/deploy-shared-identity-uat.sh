#!/bin/bash
# ERP test + copied-CS UAT only; no ingress, Shopify Connector or production-CS writes.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
release=${1:?release id required}
[[ "$release" =~ ^[A-Za-z0-9._-]+$ ]]
bundle=/tmp/xz-shared-identity-$release
erp=/opt/xz-erp-test
cs=/opt/xz-erp-customer-service-uat
backup=$erp/backups/shared-identity-$release
test -d "$bundle/erp" && test -d "$bundle/cs"
test -f "$erp/staging.env" && test -f "$cs/uat.env"
test ! -e "$backup"
for part in erp cs; do (cd "$bundle/$part" && sha256sum -c SHA256SUMS); done
for pair in 'xz-erp-test-backend-1 xz-erp-test' 'xz-erp-test-web-1 xz-erp-test' 'xz-erp-test-postgres-1 xz-erp-test' 'xz-erp-customer-service-uat-api-1 xz-erp-customer-service-uat' 'xz-erp-customer-service-uat-web-1 xz-erp-customer-service-uat' 'xz-erp-customer-service-uat-postgres-1 xz-erp-customer-service-uat'; do
  read -r container project <<< "$pair"
  test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" = "$project"
  test "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = healthy
done
mkdir -m 700 -p "$backup"
cp -p "$erp/staging.env" "$backup/erp.env"
cp -p "$cs/uat.env" "$backup/cs.env"
cp -p "$erp/compose.staging.yaml" "$backup/erp.yaml"
cp -p "$cs/compose.uat.yaml" "$backup/cs.yaml"
docker inspect -f '{{.Name}} {{.Image}} {{.Config.Image}}' xz-erp-test-backend-1 xz-erp-test-web-1 xz-erp-customer-service-uat-api-1 xz-erp-customer-service-uat-web-1 > "$backup/previous-images.txt"
docker exec xz-erp-test-postgres-1 pg_dump -U erp_test -d xz_erp_test -Fc > "$backup/erp.dump"
docker exec xz-erp-customer-service-uat-postgres-1 pg_dump -U postgres -d customer_service_uat -Fc > "$backup/cs.dump"
docker exec -i xz-erp-test-postgres-1 pg_restore --list < "$backup/erp.dump" > "$backup/erp-archive-list.txt"
docker exec -i xz-erp-customer-service-uat-postgres-1 pg_restore --list < "$backup/cs.dump" > "$backup/cs-archive-list.txt"
test -s "$backup/erp-archive-list.txt" && test -s "$backup/cs-archive-list.txt"
(cd "$backup" && sha256sum erp.dump cs.dump > backup-SHA256SUMS)
docker load -i "$bundle/erp/images.tar"
docker load -i "$bundle/cs/images.tar"
ec() { docker compose --project-name xz-erp-test --project-directory "$erp" --env-file "$erp/staging.env" -f "$erp/compose.staging.yaml" "$@"; }
cc() { docker compose --project-name xz-erp-customer-service-uat --project-directory "$cs" --env-file "$cs/uat.env" -f "$cs/compose.uat.yaml" "$@"; }
changed=0
rollback() {
  code=$?
  trap - ERR
  if test "$changed" = 1; then
    echo 'Deployment failed; restoring previous ERP and copied-CS application configuration.' >&2
    cp -p "$backup/erp.env" "$erp/staging.env"
    cp -p "$backup/cs.env" "$cs/uat.env"
    cp -p "$backup/erp.yaml" "$erp/compose.staging.yaml"
    cp -p "$backup/cs.yaml" "$cs/compose.uat.yaml"
    ec up -d --no-deps --wait --wait-timeout 240 backend web || true
    cc up -d --no-deps --wait --wait-timeout 180 api web || true
  fi
  exit "$code"
}
trap rollback ERR
update_env() {
  # Read only explicitly permitted release keys, never source or print credentials.
  awk -F= -v kind="$3" '
    NR==FNR { if ((kind=="erp" && $1 ~ /^ERP_(RELEASE_ID|BACKEND_IMAGE|WEB_IMAGE|CUSTOMER_SERVICE_ENTRY_ORIGIN)$/) || (kind=="cs" && $1 ~ /^XZDESK_UAT_(RELEASE_ID|API_IMAGE|WEB_IMAGE)$/)) replacement[$1]=$0; next }
    $1 in replacement { print replacement[$1]; seen[$1]=1; next }
    { print }
    END { for (key in replacement) if (!(key in seen)) print replacement[key] }
  ' "$1" "$2" > "$2.shared-new"
  chmod 600 "$2.shared-new"
  mv -f "$2.shared-new" "$2"
}
changed=1
update_env "$bundle/erp/release.env" "$erp/staging.env" erp
update_env "$bundle/cs/release.env" "$cs/uat.env" cs
install -m 600 "$bundle/erp/compose.staging.yaml" "$erp/compose.staging.yaml"
install -m 600 "$bundle/cs/compose.uat.yaml" "$cs/compose.uat.yaml"
ec config --quiet
cc config --quiet
# No database recreation or volume operations. This slice has no new migrations.
ec up -d --no-deps --wait --wait-timeout 240 backend web
cc up -d --no-deps --wait --wait-timeout 180 api web
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:18888/readyz > /dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:18787/readyz > /dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:18787/api/v1/bootstrap/status | grep -q 'erp_sso'
old_tool=$cs/tools/native-recovery-20260905T112429Z
if test -f "$old_tool/operator.sh"; then
  cp -p "$old_tool/operator.sh" "$backup/retired-operator.sh"
  install -m 500 "$bundle/native-account-recovery-operator.sh" "$old_tool/operator.sh"
fi
docker inspect -f '{{.Name}} {{.State.Health.Status}} {{.Config.Image}}' xz-erp-test-backend-1 xz-erp-test-web-1 xz-erp-customer-service-uat-api-1 xz-erp-customer-service-uat-web-1
printf 'DEPLOYED=%s\nBACKUP=%s\n' "$release" "$backup"
