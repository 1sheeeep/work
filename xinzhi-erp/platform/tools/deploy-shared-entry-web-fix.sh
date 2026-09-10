#!/bin/bash
# Frontend-only follow-up to the shared identity release, fixed ERP test target.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
release=20260905T133200Z-shared-entry-b145d96f
archive=/tmp/xz-erp-web-$release.tar
expected=${1:?expected SHA256 required}
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$expected"
root=/opt/xz-erp-test
backup=$root/backups/web-$release
test ! -e "$backup"
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' xz-erp-test-web-1)" = xz-erp-test
test "$(docker inspect -f '{{.Config.Image}}' xz-erp-test-web-1)" = xz-erp-web:20260905T131900Z-shared-erp-f83c0b0f
mkdir -m 700 "$backup"
cp -p "$root/staging.env" "$backup/staging.env"
docker inspect -f '{{.Config.Image}} {{.Image}}' xz-erp-test-web-1 > "$backup/previous-web.txt"
docker load -i "$archive"
compose() { docker compose --project-name xz-erp-test --project-directory "$root" --env-file "$root/staging.env" -f "$root/compose.staging.yaml" "$@"; }
rollback() { code=$?; trap - ERR; cp -p "$backup/staging.env" "$root/staging.env"; compose up -d --no-deps --wait --wait-timeout 90 web || true; exit "$code"; }
trap rollback ERR
test "$(grep -c '^ERP_WEB_IMAGE=' "$root/staging.env")" = 1
awk -v image="xz-erp-web:$release" '/^ERP_WEB_IMAGE=/ {print "ERP_WEB_IMAGE=" image; next} {print}' "$root/staging.env" > "$root/staging.env.web-new"
chmod 600 "$root/staging.env.web-new"
mv -f "$root/staging.env.web-new" "$root/staging.env"
compose config --quiet
compose up -d --no-deps --wait --wait-timeout 90 web
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:18888/readyz > /dev/null
docker inspect -f '{{.Name}} {{.State.Health.Status}} {{.Config.Image}}' xz-erp-test-web-1
