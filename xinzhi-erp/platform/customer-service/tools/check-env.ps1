$ErrorActionPreference = "Continue"

$preferredPaths = @(
    "C:\Program Files\Go\bin",
    "C:\Program Files\nodejs",
    "$env:USERPROFILE\go\bin"
) | Where-Object { Test-Path -LiteralPath $_ }

if ($preferredPaths.Count -gt 0) {
    $env:PATH = ($preferredPaths -join ";") + ";" + $env:PATH
}

Write-Host "Checking Xzdesk Agent Wails dev environment..."
Write-Host ""

$checks = @(
    @{ Name = "Go"; Command = "go"; Args = @("version") },
    @{ Name = "Node.js"; Command = "node"; Args = @("--version") },
    @{ Name = "npm"; Command = "npm"; Args = @("--version") },
    @{ Name = "Wails"; Command = "wails"; Args = @("version") }
)

$ok = $true
foreach ($check in $checks) {
    $cmd = Get-Command $check.Command -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Host ("[missing] " + $check.Name) -ForegroundColor Yellow
        $ok = $false
        continue
    }
    try {
        $output = & $cmd.Source @($check.Args) 2>&1
        Write-Host ("[ok] " + $check.Name + " -> " + (($output | Select-Object -First 1) -join "")) -ForegroundColor Green
    } catch {
        Write-Host ("[failed] " + $check.Name + " -> " + $_.Exception.Message) -ForegroundColor Red
        $ok = $false
    }
}

Write-Host ""
if ($ok) {
    Write-Host "Environment is ready. Run: wails dev" -ForegroundColor Green
    exit 0
}

Write-Host "Environment is not ready yet. Install Go, Node.js/npm, and Wails CLI before running wails dev." -ForegroundColor Yellow
exit 1
