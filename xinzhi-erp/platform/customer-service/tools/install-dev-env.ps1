$ErrorActionPreference = "Stop"

Write-Host "This script installs the development tools needed for Wails dev mode."
Write-Host "It uses winget for Go and Node.js, then installs Wails CLI with go install."
Write-Host ""

winget install --id GoLang.Go --silent --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements

$preferredPaths = @(
    "C:\Program Files\Go\bin",
    "C:\Program Files\nodejs",
    "$env:USERPROFILE\go\bin"
) | Where-Object { Test-Path -LiteralPath $_ }

if ($preferredPaths.Count -gt 0) {
    $env:PATH = ($preferredPaths -join ";") + ";" + $env:PATH
}

$goCandidates = @(
    "C:\Program Files\Go\bin\go.exe",
    "$env:LOCALAPPDATA\Programs\Go\bin\go.exe",
    "go"
)

$go = $null
foreach ($candidate in $goCandidates) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        $go = $cmd.Source
        break
    }
}

if (-not $go) {
    throw "Go was installed but go.exe was not found in this PowerShell session. Reopen PowerShell and run: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
}

& $go install github.com/wailsapp/wails/v2/cmd/wails@latest

Write-Host ""
Write-Host "Done. Reopen PowerShell, then run:" -ForegroundColor Green
$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host "Set-Location -LiteralPath `"$repoRoot`""
Write-Host "wails dev"
