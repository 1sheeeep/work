[CmdletBinding()]
param(
    [string]$BuildRoot = "D:\XzdeskBuild",
    [string]$ReleaseId = "",
    [switch]$SkipTests,
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Command exited with code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Invoke-CheckedWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [int]$Attempts = 3
    )
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Invoke-Checked -Command $Command -Arguments $Arguments -WorkingDirectory $WorkingDirectory
            return
        } catch {
            if ($attempt -eq $Attempts) {
                throw
            }
            Write-Warning "Build attempt $attempt failed; retrying in 10 seconds"
            Start-Sleep -Seconds 10
        }
    }
}

if (-not (Test-Path -LiteralPath "D:\")) {
    throw "D: drive is required for production builds"
}
$resolvedBuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
if (-not $resolvedBuildRoot.StartsWith("D:\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BuildRoot must be on D: to keep production build data off C:"
}
$dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
    $perUserDocker = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
    if (Test-Path -LiteralPath $perUserDocker) {
        $dockerCommand = Get-Item -LiteralPath $perUserDocker
    }
}
if (-not $dockerCommand) {
    throw "Docker Desktop is not installed or docker.exe is not on PATH"
}
$dockerExe = $dockerCommand.Source
if ([string]::IsNullOrWhiteSpace($dockerExe)) {
    $dockerExe = $dockerCommand.FullName
}
$dockerBin = Split-Path -Parent $dockerExe
if (($env:PATH -split ";") -notcontains $dockerBin) {
    $env:PATH = "$dockerBin;$env:PATH"
}
Invoke-Checked -Command $dockerExe -Arguments @("info", "--format", "Server={{.ServerVersion}} Root={{.DockerRootDir}} Driver={{.Driver}}") -WorkingDirectory $repoRoot

$gitStatus = (& git.exe -C $repoRoot status --porcelain)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read Git status"
}
if ($gitStatus -and -not $AllowDirty) {
    throw "Working tree is not clean. Commit changes or use -AllowDirty for a non-production test build."
}
$gitCommit = (& git.exe -C $repoRoot rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read Git commit"
}
if ([string]::IsNullOrWhiteSpace($ReleaseId)) {
    $ReleaseId = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ"), $gitCommit
}
if ($ReleaseId -notmatch '^[A-Za-z0-9_.-]+$') {
    throw "ReleaseId may contain only letters, numbers, dot, underscore, and hyphen"
}

$stagingRoot = Join-Path $resolvedBuildRoot "staging\$ReleaseId"
$contextDir = Join-Path $stagingRoot "context"
$releaseDir = Join-Path $resolvedBuildRoot "releases\$ReleaseId"
$packagePath = Join-Path $resolvedBuildRoot "releases\xzdesk-$ReleaseId.tar.gz"

if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
if (Test-Path -LiteralPath $releaseDir) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $contextDir, $releaseDir | Out-Null

if (-not $SkipTests) {
    Invoke-Checked -Command "git.exe" -Arguments @("diff", "--check") -WorkingDirectory $repoRoot
    Invoke-Checked -Command "go.exe" -Arguments @("test", "./...", "-count=1") -WorkingDirectory $repoRoot
    Invoke-Checked -Command "go.exe" -Arguments @("vet", "./...") -WorkingDirectory $repoRoot
    Invoke-Checked -Command "npm.cmd" -Arguments @("run", "build") -WorkingDirectory (Join-Path $repoRoot "frontend")
}

$contextPaths = @(
    "go.mod",
    "go.sum",
    "cmd",
    "internal",
    "extensions",
    "deploy\server.Dockerfile"
)
foreach ($relativePath in $contextPaths) {
    $source = Join-Path $repoRoot $relativePath
    $destination = Join-Path $contextDir $relativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required build path is missing: $relativePath"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$image = "shopify-support-platform-api:$ReleaseId"
Invoke-CheckedWithRetry -Command $dockerExe -Arguments @(
    "build",
    "--platform", "linux/amd64",
    "--build-arg", "XZDESK_RELEASE_ID=$ReleaseId",
    "--label", "org.opencontainers.image.revision=$gitCommit",
    "--tag", $image,
    "--file", "deploy/server.Dockerfile",
    "."
) -WorkingDirectory $contextDir
Invoke-Checked -Command $dockerExe -Arguments @("image", "inspect", "--format", "Image={{.Id}} Size={{.Size}}", $image) -WorkingDirectory $repoRoot
Invoke-Checked -Command $dockerExe -Arguments @("save", "--output", (Join-Path $releaseDir "image.tar"), $image) -WorkingDirectory $repoRoot

Copy-Item -LiteralPath (Join-Path $repoRoot "frontend\dist") -Destination (Join-Path $releaseDir "frontend") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\compose.production.yml") -Destination (Join-Path $releaseDir "compose.production.yml") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\caddy\Caddyfile.template") -Destination (Join-Path $releaseDir "Caddyfile.template") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\deploy-blue-green.sh") -Destination (Join-Path $releaseDir "deploy-blue-green.sh") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\backup-production.sh") -Destination (Join-Path $releaseDir "backup-production.sh") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\prepare-production-data-protection.sh") -Destination (Join-Path $releaseDir "prepare-production-data-protection.sh") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\verify-at-rest-encryption.sh") -Destination (Join-Path $releaseDir "verify-at-rest-encryption.sh") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\verify-encrypted-backup.sh") -Destination (Join-Path $releaseDir "verify-encrypted-backup.sh") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $releaseDir "systemd") | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\systemd\xzdesk-backup.service") -Destination (Join-Path $releaseDir "systemd\xzdesk-backup.service") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\systemd\xzdesk-backup.timer") -Destination (Join-Path $releaseDir "systemd\xzdesk-backup.timer") -Force

@(
    "XZDESK_RELEASE_ID=$ReleaseId"
    "XZDESK_IMAGE=$image"
    "XZDESK_GIT_COMMIT=$gitCommit"
) | Set-Content -LiteralPath (Join-Path $releaseDir "release.env") -Encoding ascii

$checksumLines = Get-ChildItem -LiteralPath $releaseDir -File -Recurse |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($releaseDir.Length + 1).Replace("\", "/")
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relative"
    }
$checksumLines | Set-Content -LiteralPath (Join-Path $releaseDir "SHA256SUMS") -Encoding ascii

if (Test-Path -LiteralPath $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
}
Invoke-Checked -Command "tar.exe" -Arguments @("-czf", $packagePath, "-C", $releaseDir, ".") -WorkingDirectory $repoRoot
Set-Content -LiteralPath (Join-Path $resolvedBuildRoot "latest-release.txt") -Value $packagePath -Encoding ascii
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

$package = Get-Item -LiteralPath $packagePath
Write-Host "Production release built successfully"
Write-Host "Release: $ReleaseId"
Write-Host "Image:   $image"
Write-Host "Package: $packagePath"
Write-Host ("Size:    {0:N2} MB" -f ($package.Length / 1MB))
