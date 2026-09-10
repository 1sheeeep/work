[CmdletBinding()]
param([switch]$PreflightOnly)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$pidFile = Join-Path $runtimeDir "platform-dev-pids.json"
$serverExe = [System.IO.Path]::GetFullPath((Join-Path $runtimeDir "support-server-dev.exe"))
$frontendDir = [System.IO.Path]::GetFullPath((Join-Path $root "frontend"))
$safetyScript = Join-Path $PSScriptRoot "local-runtime-safety.ps1"
. $safetyScript

function Get-RecordedProcess {
    param([int]$Id)
    return Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction Stop
}

function Assert-OwnedProcess {
    param([int]$Id, [string]$Kind)
    if ($Id -le 0) { return $null }
    $process = Get-RecordedProcess -Id $Id
    if (-not $process) { return $null }
    $path = if ($process.ExecutablePath) {
        [System.IO.Path]::GetFullPath($process.ExecutablePath)
    } else {
        ""
    }
    $command = [string]$process.CommandLine
    $owned = switch ($Kind) {
        "backend" { $path.Equals($serverExe, [System.StringComparison]::OrdinalIgnoreCase) }
        "frontend" { $command.Contains("npm.cmd run dev") -and $command.Contains("vite-dev.log") }
        "frontend-server" { $command.Contains($frontendDir) -and $command.Contains("vite") }
        default { $false }
    }
    if (-not $owned) {
        throw "Recorded Xzdesk $Kind PID $Id belongs to an unverified process; refusing to stop it."
    }
    return $process
}

if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
    Write-Host "Xzdesk dev processes are not recorded."
    return
}

$pids = Get-Content -LiteralPath $pidFile -Raw -Encoding utf8 | ConvertFrom-Json
$scratchDataFile = ""
if ([string]$pids.mode -in @("unified", "customer-service-only")) {
    $scratchDataFile = Assert-OwnedScratchPath `
        -Path ([string]$pids.dataFile) `
        -RuntimeDirectory $runtimeDir `
        -Prefix "customer-service-unified-" `
        -Extension ".json"
}
$targets = @(
    @{ Id = [int]$pids.backendPid; Kind = "backend" },
    @{ Id = [int]$pids.frontendPid; Kind = "frontend" },
    @{ Id = [int]$pids.frontendServerPid; Kind = "frontend-server" }
)
$verified = @()
foreach ($target in $targets) {
    $process = Assert-OwnedProcess -Id $target.Id -Kind $target.Kind
    if ($process) { $verified += $target }
}
if ($PreflightOnly) {
    [pscustomobject]@{ Verified = $true; RunningProcesses = $verified.Count; DataFile = $scratchDataFile }
    return
}
foreach ($target in $verified) {
    Stop-Process -Id $target.Id -ErrorAction Stop
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction Stop
if ($scratchDataFile) {
    Remove-OwnedScratchArtifacts `
        -Path $scratchDataFile `
        -RuntimeDirectory $runtimeDir `
        -Prefix "customer-service-unified-" `
        -Extension ".json" `
        -IncludeTenantDirectory
}
Write-Host "Xzdesk dev processes stopped."
