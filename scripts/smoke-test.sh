#!/bin/sh
set -eu

base_url=${1:-http://localhost:8088}
request_id="smoke-$(date +%s)"
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
curl -fsS -D "$headers" -o /dev/null -H "X-Request-Id: $request_id" "$base_url/actuator/health/readiness"
grep -qi "X-Request-Id: $request_id" "$headers"
grep -qi "X-Content-Type-Options: nosniff" "$headers"
curl -fsS "$base_url/" >/dev/null
echo "Smoke test passed: $base_url"
