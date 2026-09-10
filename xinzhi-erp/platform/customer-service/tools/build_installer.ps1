$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $Root "release"
$InstallerScript = Join-Path $Root "packaging\XzdeskAgent.iss"
$OutputInstaller = Join-Path $ReleaseDir "XzdeskAgentSetup_v3.0.6.exe"

$BundledNodeBin = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:PATH = "C:\Program Files\Go\bin;$BundledNodeBin;C:\Program Files\nodejs;$env:USERPROFILE\go\bin;$env:PATH"

Write-Host "Building Xzdesk Agent Wails release..."
Push-Location $Root
try {
    if (Test-Path -LiteralPath $ReleaseDir) {
        Get-ChildItem -LiteralPath $ReleaseDir -Filter "XzdeskAgentSetup_v3.0.6.exe" -ErrorAction SilentlyContinue | Remove-Item -Force
    } else {
        New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
    }

    & go test ./...
    if ($LASTEXITCODE -ne 0) { throw "go test failed" }

    Push-Location (Join-Path $Root "frontend")
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File ..\tools\check-mojibake.ps1
        if ($LASTEXITCODE -ne 0) { throw "mojibake check failed" }
        & .\node_modules\.bin\tsc.cmd
        if ($LASTEXITCODE -ne 0) { throw "tsc failed" }
        & .\node_modules\.bin\vite.cmd build
        if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
    } finally {
        Pop-Location
    }

    & wails build -clean -s
    if ($LASTEXITCODE -ne 0) { throw "wails build failed" }

    $exe = Join-Path $Root "build\bin\XzdeskAgent.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "Missing Wails executable: $exe"
    }

    $nodeRuntimeDir = Join-Path $Root "build\bin\runtime\node"
    New-Item -ItemType Directory -Force -Path $nodeRuntimeDir | Out-Null
    $nodeCandidates = @(
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
        "C:\Program Files\nodejs\node.exe"
    )
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $nodeCandidates += $nodeCommand.Source
    }
    $nodeSource = $null
    foreach ($candidate in $nodeCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $nodeSource = $candidate
            break
        }
    }
    if (-not $nodeSource) {
        throw "Node runtime not found. It is required for the packaged Playwright CDP sidecar."
    }
    Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $nodeRuntimeDir "node.exe") -Force

    $isccCandidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    $iscc = $null
    foreach ($candidate in $isccCandidates) {
        if (Test-Path -LiteralPath $candidate) {
            $iscc = $candidate
            break
        }
    }
    if (-not $iscc) {
        throw "Inno Setup ISCC.exe not found. Wails exe is built at $exe"
    }

    & $iscc "/DSourceDir=$Root\build\bin" "/DOutputDir=$ReleaseDir" $InstallerScript
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup build failed" }
    if (-not (Test-Path -LiteralPath $OutputInstaller)) {
        throw "Installer was not created: $OutputInstaller"
    }

    Write-Host "Installer ready: $OutputInstaller" -ForegroundColor Green
} finally {
    Pop-Location
}
