param(
    [string]$ReleaseId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$customerServiceRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $customerServiceRoot "release\erp-uat"
$releaseDir = Join-Path $releaseRoot $ReleaseId
$apiImage = "xz-erp-customer-service-uat-api:$ReleaseId"
$webImage = "xz-erp-customer-service-uat-web:$ReleaseId"
$postgresReleaseImage = "xz-erp-customer-service-uat-postgres:16-alpine-57c72fd2a128"

if ($ReleaseId -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ReleaseId may contain only letters, numbers, dots, underscores, and hyphens."
}
if (Test-Path -LiteralPath $releaseDir) {
    throw "Release directory already exists: $releaseDir"
}

$gitRoot = (& git -C $customerServiceRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot)) {
    throw "Unable to locate the Git repository root."
}
$normalizedGitRoot = [System.IO.Path]::GetFullPath($gitRoot)
$normalizedCustomerServiceRoot = [System.IO.Path]::GetFullPath($customerServiceRoot)
$gitRootPrefix = $normalizedGitRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if (-not $normalizedCustomerServiceRoot.StartsWith(
        $gitRootPrefix,
        [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Customer-service directory is outside the Git repository root."
}
$customerServicePath = $normalizedCustomerServiceRoot.Substring($gitRootPrefix.Length).Replace('\', '/')

& git -C $gitRoot diff --quiet -- $customerServicePath
if ($LASTEXITCODE -ne 0) {
    throw "Tracked customer-service changes must be committed before packaging."
}
& git -C $gitRoot diff --cached --quiet -- $customerServicePath
if ($LASTEXITCODE -ne 0) {
    throw "Staged customer-service changes must be committed before packaging."
}

$snapshotRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "xz-erp-customer-service-uat-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $snapshotRoot "customer-service.tar"

try {
    New-Item -ItemType Directory -Path $snapshotRoot | Out-Null
    & git -C $gitRoot archive --format=tar --output=$archivePath HEAD -- $customerServicePath
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to export the committed customer-service snapshot."
    }
    & tar -xf $archivePath -C $snapshotRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to extract the committed customer-service snapshot."
    }

    $snapshotCustomerService = Join-Path $snapshotRoot $customerServicePath
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

    docker build `
        --tag $apiImage `
        --file (Join-Path $snapshotCustomerService "deploy\server.Dockerfile") `
        $snapshotCustomerService
    if ($LASTEXITCODE -ne 0) {
        throw "Customer-service UAT API image build failed."
    }

    docker build `
        --tag $webImage `
        --file (Join-Path $snapshotCustomerService "deploy\erp-uat\web.Dockerfile") `
        $snapshotCustomerService
    if ($LASTEXITCODE -ne 0) {
        throw "Customer-service UAT web image build failed."
    }

    docker build `
        --tag $postgresReleaseImage `
        --file (Join-Path $snapshotCustomerService "deploy\erp-uat\postgres.Dockerfile") `
        $snapshotCustomerService
    if ($LASTEXITCODE -ne 0) {
        throw "Customer-service UAT PostgreSQL image build failed."
    }

    docker save `
        --output (Join-Path $releaseDir "images.tar") `
        $apiImage $webImage $postgresReleaseImage
    if ($LASTEXITCODE -ne 0) {
        throw "Customer-service UAT image export failed."
    }
} finally {
    if (Test-Path -LiteralPath $snapshotRoot) {
        Remove-Item -LiteralPath $snapshotRoot -Recurse -Force
    }
}

Copy-Item `
    -LiteralPath (Join-Path $customerServiceRoot "deploy\erp-uat\compose.uat.yaml") `
    -Destination (Join-Path $releaseDir "compose.uat.yaml") `
    -Force
Copy-Item `
    -LiteralPath (Join-Path $customerServiceRoot "deploy\erp-uat\deploy-uat.sh") `
    -Destination (Join-Path $releaseDir "deploy-uat.sh") `
    -Force
Copy-Item `
    -LiteralPath (Join-Path $customerServiceRoot "deploy\erp-uat\ingress.caddy") `
    -Destination (Join-Path $releaseDir "ingress.caddy") `
    -Force

@(
    "XZDESK_UAT_RELEASE_ID=$ReleaseId"
    "XZDESK_UAT_API_IMAGE=$apiImage"
    "XZDESK_UAT_WEB_IMAGE=$webImage"
    "XZDESK_UAT_POSTGRES_IMAGE=$postgresReleaseImage"
) | Set-Content -LiteralPath (Join-Path $releaseDir "release.env") -Encoding ascii

$checksumLines = Get-ChildItem -LiteralPath $releaseDir -File |
    Where-Object { $_.Name -ne "SHA256SUMS" } |
    Sort-Object Name |
    ForEach-Object {
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $($_.Name)"
    }
[System.IO.File]::WriteAllText(
    (Join-Path $releaseDir "SHA256SUMS"),
    (($checksumLines -join "`n") + "`n"),
    [System.Text.Encoding]::ASCII)

Write-Output $releaseDir
