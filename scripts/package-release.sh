#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'usage: package-release.sh OUTPUT_DIRECTORY' >&2
  exit 2
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
jar="$root/backend/target/recruitment-console-0.0.1-SNAPSHOT.jar"
web="$root/frontend/dist"
if [ ! -s "$jar" ] || [ ! -s "$web/index.html" ]; then
  echo 'backend JAR and frontend build are required' >&2
  exit 1
fi

revision=$(git -C "$root" rev-parse --verify HEAD)
if [ -n "${GITHUB_SHA:-}" ] && [ "$revision" != "$GITHUB_SHA" ]; then
  echo 'checked-out revision does not match this workflow run' >&2
  exit 1
fi

output=$1
mkdir -p -- "$output"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp -- "$jar" "$work/app.jar"
tar -C "$web" -cf "$work/web.tar" .
git -C "$root" archive HEAD:boss-browser-bridge -o "$work/browser-bridge.tar"
git -C "$root" archive HEAD:boss-local-connector -o "$work/local-connector.tar"

{
  printf 'repository=%s\n' "${GITHUB_REPOSITORY:-xz-development/recruitment-console}"
  printf 'commit=%s\n' "$revision"
  printf 'app.jar='; sha256sum "$work/app.jar" | cut -d' ' -f1
  printf 'web.tar='; sha256sum "$work/web.tar" | cut -d' ' -f1
  printf 'browser-bridge.tar='; sha256sum "$work/browser-bridge.tar" | cut -d' ' -f1
  printf 'local-connector.tar='; sha256sum "$work/local-connector.tar" | cut -d' ' -f1
} > "$work/manifest.txt"

tar -C "$work" -czf "$output/recruitment-release.tar.gz" \
  app.jar web.tar browser-bridge.tar local-connector.tar manifest.txt
(cd "$output" && sha256sum recruitment-release.tar.gz > recruitment-release.tar.gz.sha256)
