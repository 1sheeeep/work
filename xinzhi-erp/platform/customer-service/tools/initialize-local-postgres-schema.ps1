param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $root "deploy\docker-compose.yml"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required to initialize the synthetic local customer-service database."
}

$containerId = (& docker compose -f $composeFile ps -q postgres).Trim()
if ($LASTEXITCODE -ne 0 -or -not $containerId) {
    throw "The customer-service local PostgreSQL container is not running."
}
$workingDirectory = (& docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' $containerId).Trim()
if ($LASTEXITCODE -ne 0 -or -not $workingDirectory) {
    throw "The local PostgreSQL container owner could not be verified."
}
$expectedDirectory = [System.IO.Path]::GetFullPath((Split-Path -Parent $composeFile)).TrimEnd('\')
$actualDirectory = [System.IO.Path]::GetFullPath($workingDirectory).TrimEnd('\')
if (-not [string]::Equals($expectedDirectory, $actualDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The local PostgreSQL container belongs to another project directory."
}

$boundaryState = (& docker exec $containerId psql -v ON_ERROR_STOP=1 -U support -d shopify_support -Atc @'
SELECT
  CASE WHEN to_regnamespace('customer_service') IS NULL THEN 'missing' ELSE 'present' END
  || ':' ||
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND c.relname IN ('users','shops','shop_sources','conversations','messages','sessions')
  ) THEN 'legacy-public-data' ELSE 'no-legacy-public-data' END;
'@).Trim()
if ($LASTEXITCODE -ne 0 -or $boundaryState -notmatch '^(missing|present):(legacy-public-data|no-legacy-public-data)$') {
    throw "The local PostgreSQL schema boundary could not be verified."
}
if ($boundaryState -eq "missing:legacy-public-data") {
    throw "This named volume contains a legacy public-schema customer-service store. Automatic migration is not authorized; keep it unchanged and use a fresh synthetic local volume."
}
if ($boundaryState.StartsWith("present:")) {
    throw "This named volume already contains a customer_service schema. Bootstrap and automatic takeover are not authorized; keep it unchanged and use a fresh synthetic local volume."
}
throw "This PostgreSQL container uses an already initialized named volume. Schema-role bootstrap is fresh-only and runs only through docker-entrypoint-initdb.d on an empty synthetic volume; this volume was not modified."
