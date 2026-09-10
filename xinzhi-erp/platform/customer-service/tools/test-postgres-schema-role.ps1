param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$owner = [Guid]::NewGuid().ToString("N")
$containerName = "xzdesk-schema-role-$owner"
$containerId = $null

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the synthetic PostgreSQL schema-role gate."
}

try {
    $containerId = (& docker run -d `
        --name $containerName `
        --label "xz.erp.synthetic-schema-role=$owner" `
        --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m `
        -e POSTGRES_USER=postgres `
        -e POSTGRES_PASSWORD=not-a-real-secret-postgres-admin `
        -e POSTGRES_DB=xz_erp_synthetic `
        -p 127.0.0.1::5432 `
        postgres:16-alpine).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $containerId) {
        throw "The synthetic PostgreSQL container did not start."
    }
    $deadline = (Get-Date).AddSeconds(45)
    do {
        & docker exec $containerId pg_isready -U postgres -d xz_erp_synthetic *> $null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($LASTEXITCODE -ne 0) {
        throw "The synthetic PostgreSQL container did not become ready."
    }

    $portLine = (& docker port $containerId 5432/tcp).Trim()
    if ($LASTEXITCODE -ne 0 -or $portLine -notmatch '127\.0\.0\.1:(\d+)$') {
        throw "The synthetic PostgreSQL loopback port could not be resolved."
    }
    $port = $Matches[1]
    $env:XZDESK_TEST_POSTGRES_ADMIN_URL = "postgres://postgres:not-a-real-secret-postgres-admin@127.0.0.1:$port/xz_erp_synthetic?sslmode=disable"
    $env:DATABASE_URL = "postgres://customer_service_runtime:not-a-real-secret-customer-service-runtime@127.0.0.1:$port/xz_erp_synthetic?sslmode=disable"
    $env:XZDESK_DATABASE_MIGRATION_URL = "postgres://customer_service_migrator:not-a-real-secret-customer-service-migrator@127.0.0.1:$port/xz_erp_synthetic?sslmode=disable"
    $env:TEST_DATABASE_URL = $env:DATABASE_URL
    $env:TEST_MIGRATION_DATABASE_URL = $env:XZDESK_DATABASE_MIGRATION_URL
    $env:XZDESK_DATABASE_SCHEMA = "customer_service"

    Push-Location $root
    try {
        & go test -count=1 ./internal/platform -run 'Test(Postgres(StoreContract|SchemaRoleContract|RejectsNonemptySchemaWithoutHistory|StoreConfigRequiresFixedSchemaAndSeparateConnections|ConfigurationErrorsDoNotExposeDSNSecrets)|FreshBootstrapRejectsExistingSchemaBeforeMutations)$'
        if ($LASTEXITCODE -ne 0) {
            throw "The synthetic PostgreSQL schema-role Go gate failed."
        }
        & go test -count=1 ./internal/platform -run 'Test(PostgresConversationMetadataUpdateCannotUndoConcurrentClaim|PostgresCloseInactiveCustomerConversationsIntegration|PostgresEmailProcessingPaginationIntegration|PostgresEmailReliabilityStores|PostgresEmailStatisticsPaginationIntegration|PostgresOperationalConversationQueryExcludesHistoryAndNotifications|PostgresShopifyOrderSyncQueueAndWebhookDedupe)$'
        if ($LASTEXITCODE -ne 0) {
            throw "The synthetic PostgreSQL imported-production integration gate failed."
        }
    } finally {
        Pop-Location
    }
} finally {
    if ($containerId) {
        $inspection = @(& docker inspect $containerId 2>$null | ConvertFrom-Json)
        $actualId = if ($inspection.Count -eq 1) { [string]$inspection[0].Id } else { "" }
        $actualOwner = if ($inspection.Count -eq 1) { [string]$inspection[0].Config.Labels.'xz.erp.synthetic-schema-role' } else { "" }
        if ($actualId -eq $containerId -and $actualOwner -eq $owner) {
            & docker rm -f $containerId *> $null
        }
    }
}
