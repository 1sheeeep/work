#!/bin/bash
# Fixed, frontend-only ERP release. Never manages customer-service or databases.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
release=${4:?release identifier required}
[[ "$release" =~ ^20260907T[0-9]{6}Z-usability-[a-f0-9]{8}$ ]]
image=xz-erp-web:$release
old_image=xz-erp-web:20260907T133200Z-usability-358f5c51
old_container=9ee55b4047bfd49b3f453f8c537d610f0d042b2c13f4db327b8c9c012f0f0c4c
root=/opt/xz-erp-test
archive=/tmp/xz-erp-web-$release.tar
backup=$root/backups/web-$release
expected=${1:?archive SHA256 required}
image_id=${2:?image SHA256 ID required}
asset=${3:?expected entry asset required}
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$asset" =~ ^/assets/index-[A-Za-z0-9_-]+\.js$ ]]
exec 9>"$root/.erp-ui-release.lock"
flock -n 9
test ! -e "$backup"
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$expected"
test "$(docker inspect -f '{{.Id}}' xz-erp-test-web-1)" = "$old_container"
test "$(docker inspect -f '{{.Config.Image}}' xz-erp-test-web-1)" = "$old_image"
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' xz-erp-test-web-1)" = xz-erp-test
test "$(docker inspect -f '{{.State.Health.Status}}' xz-erp-test-web-1)" = healthy
mkdir -m 700 "$backup"
cp -p "$root/staging.env" "$backup/staging.env"
cp -p "$root/compose.staging.yaml" "$backup/compose.staging.yaml"
docker inspect -f '{{.Config.Image}} {{.Image}}' xz-erp-test-web-1 > "$backup/previous-web.txt"
protected() {
  docker inspect -f '{{.Name}} {{.Id}} {{.Config.Image}} {{.State.StartedAt}} {{.RestartCount}}' xz-erp-test-backend-1 xz-erp-test-postgres-1
}
protected > "$backup/protected-before.txt"
test "$(grep -c '^ERP_WEB_IMAGE=' "$root/staging.env")" = 1
grep -Fxq "ERP_WEB_IMAGE=$old_image" "$root/staging.env"
docker load -i "$archive"
test "$(docker image inspect -f '{{.Id}}' "$image")" = "$image_id"
compose() { docker compose --project-name xz-erp-test --project-directory "$root" --env-file "$root/staging.env" -f "$root/compose.staging.yaml" "$@"; }
rollback() {
  code=$?
  trap - ERR
  if grep -Fxq "ERP_WEB_IMAGE=$image" "$root/staging.env"; then
    cp -p "$backup/staging.env" "$root/staging.env"
    compose up -d --no-deps --pull never --wait --wait-timeout 90 web || echo ERP_WEB_ROLLBACK_REQUIRES_CHECK
  fi
  echo ERP_WEB_RELEASE_FAILED
  exit "$code"
}
trap rollback ERR
cmp "$root/staging.env" "$backup/staging.env"
cmp "$root/compose.staging.yaml" "$backup/compose.staging.yaml"
temporary=$(mktemp "$root/.ui-env.XXXXXX")
awk -v image="$image" '/^ERP_WEB_IMAGE=/ {print "ERP_WEB_IMAGE=" image; next} {print}' "$root/staging.env" > "$temporary"
chmod 600 "$temporary"
mv -f "$temporary" "$root/staging.env"
compose config --quiet
compose up -d --no-deps --pull never --wait --wait-timeout 90 web
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:18888/readyz >/dev/null
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:18888/login > "$backup/new-index.html"
grep -Fq "$asset" "$backup/new-index.html"
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:18888$asset" >/dev/null
test "$(docker inspect -f '{{.Image}}' xz-erp-test-web-1)" = "$image_id"
test "$(docker inspect -f '{{.State.Health.Status}}' xz-erp-test-web-1)" = healthy
protected > "$backup/protected-after.txt"
cmp "$backup/protected-before.txt" "$backup/protected-after.txt"
cmp "$root/compose.staging.yaml" "$backup/compose.staging.yaml"
awk '!/^ERP_WEB_IMAGE=/' "$backup/staging.env" > "$backup/env-before-without-web"
awk '!/^ERP_WEB_IMAGE=/' "$root/staging.env" > "$backup/env-after-without-web"
cmp "$backup/env-before-without-web" "$backup/env-after-without-web"
sha256sum "$backup/staging.env" "$backup/compose.staging.yaml" > "$backup/SHA256SUMS"
trap - ERR
docker inspect -f '{{.Name}} {{.Config.Image}} {{.State.Health.Status}} {{.RestartCount}}' xz-erp-test-web-1
printf 'ERP_WEB_RELEASE_PASSED backup=%s asset=%s\n' "$backup" "$asset"
