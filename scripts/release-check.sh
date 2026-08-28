#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
docker compose -f "$project_dir/compose.yaml" config >/dev/null
docker run --rm -v recruitment_maven_cache:/root/.m2 -v "$project_dir/backend:/workspace" -w /workspace maven:3.9-eclipse-temurin-21 mvn -B -ntp test
docker compose -f "$project_dir/compose.yaml" build
docker compose -f "$project_dir/compose.yaml" up -d
"$project_dir/scripts/smoke-test.sh"
echo "Release checks passed. Run frontend E2E separately before production promotion."
