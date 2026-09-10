$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root "release"
$packageDir = Join-Path $releaseDir "shopify-support-platform-linux"
$archive = Join-Path $releaseDir "shopify-support-platform-linux.tar.gz"
$zipArchive = Join-Path $releaseDir "shopify-support-platform-linux.zip"

Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipArchive -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

function Copy-DeployTree {
    param(
        [string]$Source,
        [string]$Destination
    )
    $excludedDirs = @(".git", ".codex", ".codex-shopify", ".shopify", ".shopify-ai-assistant", "runtime", "release", "tmp", "node_modules")
    $excludedFiles = @(".env", "gmail_credentials.json", "production.env")
    $sourceItem = Get-Item -LiteralPath $Source -Force
    if ($excludedDirs -contains $sourceItem.Name) {
        return
    }
    if (-not $sourceItem.PSIsContainer) {
        if ($excludedFiles -contains $sourceItem.Name -or $sourceItem.Name.EndsWith(".log") -or $sourceItem.Name.EndsWith(".tmp")) {
            return
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        return
    }

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-DeployTree -Source $_.FullName -Destination (Join-Path $Destination $_.Name)
    }
}

Push-Location (Join-Path $root "frontend")
try {
    npm.cmd run build
} finally {
    Pop-Location
}

$deployPaths = @(
    "go.mod",
    "go.sum",
    "cmd\support-server",
    "internal",
    "extensions",
    "frontend\dist",
    "sidecar\playwright-reader",
    "deploy",
    "server\DEPLOY_LINUX.md"
)
foreach ($relativePath in $deployPaths) {
    $source = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required deployment path is missing: $relativePath"
    }
    Copy-DeployTree -Source $source -Destination (Join-Path $packageDir $relativePath)
}

tar -czf $archive -C $packageDir .
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Linux deployment archive"
}

tar -acf $zipArchive -C $packageDir .
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Linux deployment ZIP archive"
}

Write-Host "Linux deploy package created:"
Write-Host $archive
Write-Host $zipArchive
