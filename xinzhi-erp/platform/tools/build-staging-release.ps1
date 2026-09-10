param(
    [string]$ReleaseId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ"),
    [string]$CustomerServiceWorkbenchUrl = "https://kf-uat.xzkj.ai"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $repoRoot "release"
$releaseDir = Join-Path $releaseRoot $ReleaseId
$backendImage = "xz-erp-backend:$ReleaseId"
$webImage = "xz-erp-web:$ReleaseId"
$postgresSourceImage = "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
$postgresReleaseImage = "xz-erp-postgres:16-alpine-57c72fd2a128"

if ($ReleaseId -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ReleaseId may contain only letters, numbers, dots, underscores, and hyphens."
}

$customerServiceUri = $null
if (-not [System.Uri]::TryCreate(
        $CustomerServiceWorkbenchUrl,
        [System.UriKind]::Absolute,
        [ref]$customerServiceUri) `
        -or $customerServiceUri.Scheme -ne "https" `
        -or -not [string]::IsNullOrEmpty($customerServiceUri.UserInfo) `
        -or $customerServiceUri.AbsolutePath -ne "/" `
        -or -not [string]::IsNullOrEmpty($customerServiceUri.Query) `
        -or -not [string]::IsNullOrEmpty($customerServiceUri.Fragment)) {
    throw "CustomerServiceWorkbenchUrl must be an HTTPS origin without credentials, path, query, or fragment."
}
$customerServiceOrigin = $customerServiceUri.GetLeftPart([System.UriPartial]::Authority)

if (Test-Path -LiteralPath $releaseDir) {
    throw "Release directory already exists: $releaseDir"
}

$gitRoot = (& git -C $repoRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot)) {
    throw "Unable to locate the Git repository root."
}
$normalizedGitRoot = [System.IO.Path]::GetFullPath($gitRoot)
$normalizedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
$gitRootPrefix = $normalizedGitRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if (-not $normalizedRepoRoot.StartsWith($gitRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Platform directory is outside the Git repository root."
}
$platformPath = $normalizedRepoRoot.Substring($gitRootPrefix.Length).Replace('\', '/')

& git -C $gitRoot diff --quiet -- $platformPath
if ($LASTEXITCODE -ne 0) {
    throw "Tracked platform changes must be committed before packaging."
}
& git -C $gitRoot diff --cached --quiet -- $platformPath
if ($LASTEXITCODE -ne 0) {
    throw "Staged platform changes must be committed before packaging."
}

$snapshotRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("xz-erp-release-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $snapshotRoot "platform.tar"

try {
    New-Item -ItemType Directory -Path $snapshotRoot | Out-Null
    & git -C $gitRoot archive --format=tar --output=$archivePath HEAD -- $platformPath
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to export the committed platform snapshot."
    }
    & tar -xf $archivePath -C $snapshotRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to extract the committed platform snapshot."
    }

    $snapshotPlatform = Join-Path $snapshotRoot $platformPath
    New-Item -ItemType Directory -Path $releaseDir | Out-Null

    docker build `
        --file (Join-Path $snapshotPlatform "backend\Dockerfile") `
        --tag $backendImage `
        $snapshotPlatform
    if ($LASTEXITCODE -ne 0) {
        throw "Backend image build failed."
    }

    docker build `
        --build-arg "VITE_CUSTOMER_SERVICE_WORKBENCH_URL=$customerServiceOrigin" `
        --tag $webImage `
        (Join-Path $snapshotPlatform "frontend")
    if ($LASTEXITCODE -ne 0) {
        throw "Web image build failed."
    }

    docker image inspect $postgresSourceImage | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Pinned PostgreSQL image is unavailable locally."
    }
    docker tag $postgresSourceImage $postgresReleaseImage
    if ($LASTEXITCODE -ne 0) {
        throw "Pinned PostgreSQL release tag failed."
    }

    docker save --output (Join-Path $releaseDir "images.tar") $backendImage $webImage $postgresReleaseImage
    if ($LASTEXITCODE -ne 0) {
        throw "Image export failed."
    }
} finally {
    if (Test-Path -LiteralPath $snapshotRoot) {
        Remove-Item -LiteralPath $snapshotRoot -Recurse -Force
    }
}

Copy-Item `
    -LiteralPath (Join-Path $repoRoot "infra\staging\compose.staging.yaml") `
    -Destination (Join-Path $releaseDir "compose.staging.yaml") `
    -Force
Copy-Item `
    -LiteralPath (Join-Path $repoRoot "infra\staging\deploy-staging.sh") `
    -Destination (Join-Path $releaseDir "deploy-staging.sh") `
    -Force

@(
    "ERP_RELEASE_ID=$ReleaseId"
    "ERP_BACKEND_IMAGE=$backendImage"
    "ERP_WEB_IMAGE=$webImage"
    "ERP_POSTGRES_IMAGE=$postgresReleaseImage"
    "ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN=$customerServiceOrigin"
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
