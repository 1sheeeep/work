[CmdletBinding()]
param([switch]$PreflightOnly)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$pidFile = Join-Path $runtimeDir "shopify-connector-dev-pid.json"
$connectorExe = [System.IO.Path]::GetFullPath((Join-Path $runtimeDir "shopify-connector-dev.exe"))
$connectorAddr = "127.0.0.1:8790"
. (Join-Path $PSScriptRoot "local-runtime-safety.ps1")

if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
    Write-Host "Shopify connector dev process is not recorded."
    return
}

try {
    $record = Get-Content -LiteralPath $pidFile -Raw -Encoding utf8 | ConvertFrom-Json
    $recordedPid = [int]$record.pid
    $dataFile = Assert-OwnedScratchPath `
        -Path ([string]$record.dataFile) `
        -RuntimeDirectory $runtimeDir `
        -Prefix "shopify-connector-unified-" `
        -Extension ".enc"
} catch {
    throw "Shopify connector PID record is malformed and was left untouched."
}
if ($recordedPid -le 0) {
    throw "Shopify connector PID record is malformed and was left untouched."
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId = $recordedPid" -ErrorAction Stop
if (-not $process) {
    if ($PreflightOnly) {
        [pscustomobject]@{ Verified = $true; RunningProcesses = 0; DataFile = $dataFile }
        return
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction Stop
    Remove-OwnedScratchArtifacts `
        -Path $dataFile `
        -RuntimeDirectory $runtimeDir `
        -Prefix "shopify-connector-unified-" `
        -Extension ".enc" `
        -IncludeLockFile
    Write-Host "Removed a stale Shopify connector PID record."
    return
}
$path = if ($process.ExecutablePath) {
    [System.IO.Path]::GetFullPath([string]$process.ExecutablePath)
} else {
    ""
}
$command = [string]$process.CommandLine
if (-not $path.Equals($connectorExe, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $command.Contains("-addr") -or -not $command.Contains($connectorAddr)) {
    throw "Shopify connector PID record belongs to an unverified process; it was not stopped."
}

if ($PreflightOnly) {
    [pscustomobject]@{ Verified = $true; RunningProcesses = 1; DataFile = $dataFile }
    return
}

Stop-Process -Id $recordedPid -ErrorAction Stop
$stopped = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (-not (Get-CimInstance Win32_Process -Filter "ProcessId = $recordedPid" -ErrorAction Stop)) {
        $stopped = $true
        break
    }
    Start-Sleep -Milliseconds 250
}
if (-not $stopped) {
    throw "Shopify connector did not stop within 10 seconds; PID record was retained."
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction Stop
Remove-OwnedScratchArtifacts `
    -Path $dataFile `
    -RuntimeDirectory $runtimeDir `
    -Prefix "shopify-connector-unified-" `
    -Extension ".enc" `
    -IncludeLockFile
Write-Host "Shopify connector dev process stopped."
