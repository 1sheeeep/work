param(
    [switch]$ERPIntegration,
    [switch]$UnifiedLocal,
    [switch]$CustomerServiceOnly,
    [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$frontendDir = Join-Path $root "frontend"
$serverExe = Join-Path $runtimeDir "support-server-dev.exe"
$pidFile = Join-Path $runtimeDir "platform-dev-pids.json"
$serverLog = Join-Path $runtimeDir "support-server-dev.log"
$serverErr = Join-Path $runtimeDir "support-server-dev.err.log"
$viteLog = Join-Path $runtimeDir "vite-dev.log"
$viteErr = Join-Path $runtimeDir "vite-dev.err.log"
$envFile = Join-Path $root ".env"
$stopScript = Join-Path $PSScriptRoot "stop-platform-dev.ps1"
$safetyScript = Join-Path $PSScriptRoot "local-runtime-safety.ps1"
. $safetyScript

function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) {
            return
        }
        $parts = $line.Split("=", 2)
        if ($parts.Count -ne 2) {
            return
        }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        if ($name) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Stop-ExistingDevProcess {
    if (-not (Test-Path $pidFile)) {
        return
    }
    & $stopScript
}

function Get-RecordedProcess {
    param([int]$Id)
    if ($Id -le 0) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction Stop
}

function Test-RecordedProcess {
    param([object]$Process, [string]$Kind)
    if (-not $Process) { return $false }
    $path = if ($Process.ExecutablePath) {
        [System.IO.Path]::GetFullPath([string]$Process.ExecutablePath)
    } else { "" }
    $command = [string]$Process.CommandLine
    switch ($Kind) {
        "backend" { return $path.Equals([System.IO.Path]::GetFullPath($serverExe), [System.StringComparison]::OrdinalIgnoreCase) -and $command.Contains("127.0.0.1:8787") }
        "frontend" { return $command.Contains("npm.cmd run dev") -and $command.Contains("vite-dev.log") }
        "frontend-server" { return $command.Contains([System.IO.Path]::GetFullPath($frontendDir)) -and $command.Contains("vite") }
        default { return $false }
    }
}

function Get-DevRuntimeStatus {
    [void](Assert-SafeRuntimeAncestors -RuntimeDirectory $runtimeDir)
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
        foreach ($port in @(8787, 5173)) {
            if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
                throw "Xzdesk port $port is owned by an unrecorded process; preflight made no changes."
            }
        }
        return [pscustomobject]@{ Ready = $false; StaleRecord = $false }
    }
    try {
        $record = Get-Content -LiteralPath $pidFile -Raw -Encoding utf8 | ConvertFrom-Json
        $targets = @(
            @{ Id = [int]$record.backendPid; Kind = "backend" },
            @{ Id = [int]$record.frontendPid; Kind = "frontend" },
            @{ Id = [int]$record.frontendServerPid; Kind = "frontend-server" }
        )
    } catch {
        throw "Xzdesk owner record is malformed; preflight made no changes."
    }
    if ($UnifiedLocal -or $CustomerServiceOnly) {
        if (-not $record.dataFile) { throw "Xzdesk unified owner record has no scratch store path." }
        [void](Assert-OwnedScratchPath -Path ([string]$record.dataFile) -RuntimeDirectory $runtimeDir -Prefix "customer-service-unified-" -Extension ".json")
        if ([string]$record.mode -ne $(if ($UnifiedLocal) { "unified" } else { "customer-service-only" })) {
            throw "Xzdesk is already owned by a different local runtime mode."
        }
    }
    $alive = @()
    foreach ($target in $targets) {
        $process = Get-RecordedProcess -Id $target.Id
        if ($process -and -not (Test-RecordedProcess -Process $process -Kind $target.Kind)) {
            throw "Xzdesk owner record points to an unverified $($target.Kind) process; preflight made no changes."
        }
        $alive += [bool]$process
    }
    if (@($alive | Where-Object { $_ }).Count -eq 0) {
        foreach ($port in @(8787, 5173)) {
            if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
                throw "Xzdesk port $port is occupied while its owner record is stale; preflight made no changes."
            }
        }
        return [pscustomobject]@{ Ready = $false; StaleRecord = $true; DataFile = [string]$record.dataFile }
    }
    if (@($alive | Where-Object { $_ }).Count -ne $targets.Count) {
        throw "Xzdesk owner record is only partially alive; stop it explicitly before retrying."
    }
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:5173/healthz" -UseBasicParsing -TimeoutSec 2
    } catch {
        throw "Recorded Xzdesk runtime is unhealthy; preflight made no changes."
    }
    if ($health.StatusCode -ne 200) { throw "Recorded Xzdesk runtime is unhealthy; preflight made no changes." }
    return [pscustomobject]@{ Ready = $true; StaleRecord = $false; Record = $record }
}

if (($UnifiedLocal -or $CustomerServiceOnly) -and -not $ERPIntegration) {
    throw "UnifiedLocal and CustomerServiceOnly require ERPIntegration."
}
if ($UnifiedLocal -and $CustomerServiceOnly) {
    throw "UnifiedLocal and CustomerServiceOnly are mutually exclusive."
}
$runtimeStatus = Get-DevRuntimeStatus
if ($PreflightOnly) {
    $runtimeStatus
    return
}
if ($runtimeStatus.Ready) {
    Write-Host "Xzdesk is already ready at http://127.0.0.1:8787 and http://127.0.0.1:5173."
    [pscustomobject]@{ Started = $false; BackendPid = [int]$runtimeStatus.Record.backendPid; DataFile = [string]$runtimeStatus.Record.dataFile }
    return
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
[void](Assert-SafeRuntimeDirectory -RuntimeDirectory $runtimeDir)
if ($runtimeStatus.StaleRecord) {
    if (($UnifiedLocal -or $CustomerServiceOnly) -and $runtimeStatus.DataFile) {
        Remove-StaleOwnedScratchRecord `
            -Path $runtimeStatus.DataFile `
            -RuntimeDirectory $runtimeDir `
            -Prefix "customer-service-unified-" `
            -Extension ".json" `
            -OwnerRecordPath $pidFile `
            -ExpectedOwnerRecordName "platform-dev-pids.json" `
            -IncludeTenantDirectory
    } else {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction Stop
    }
}
if (-not $UnifiedLocal -and -not $CustomerServiceOnly) {
    Import-DotEnv -Path $envFile
}
$scratchDataFile = ""
if ($UnifiedLocal -or $CustomerServiceOnly) {
    $localWorkloadToken = "xz-erp-local-customer-service-workload"
    Clear-UnifiedLocalProviderEnvironment
    $scratchDataFile = New-IsolatedLocalStatePath `
        -RuntimeDirectory $runtimeDir `
        -Prefix "customer-service-unified-" `
        -Extension ".json"
    foreach ($setting in @{
        DATABASE_URL = ""
        DATA_FILE = $scratchDataFile
        SUPPORT_PLATFORM_ADDR = "127.0.0.1:8787"
        XZDESK_FRONTEND_PORT = "5173"
        VITE_XZDESK_BACKEND = "http://127.0.0.1:8787"
        XZDESK_STRICT_OFFLINE_LOCAL = "1"
        XZ_ERP_CONNECTOR_TOKEN = $localWorkloadToken
        ERP_XZ_ERP_APP_CONNECTOR_TOKEN = $localWorkloadToken
        XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL = if ($UnifiedLocal) {
            "http://127.0.0.1:8790"
        } else {
            ""
        }
        HTTP_PROXY = "http://127.0.0.1:9"
        HTTPS_PROXY = "http://127.0.0.1:9"
        ALL_PROXY = "http://127.0.0.1:9"
        NO_PROXY = "127.0.0.1,localhost,::1"
    }.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($setting.Key, $setting.Value, "Process")
    }
}
if (-not $env:DATABASE_URL -and -not $env:DATA_FILE) {
    $env:DATA_FILE = Join-Path $runtimeDir "platform-dev-data.json"
}

$addr = if ($env:SUPPORT_PLATFORM_ADDR) { $env:SUPPORT_PLATFORM_ADDR } else { "127.0.0.1:8787" }
if ($ERPIntegration) {
    $erpOrigin = "http://127.0.0.1:18888"
    $entryOrigin = "http://127.0.0.1:8787"
    if ($addr -ne "127.0.0.1:8787") {
        throw "ERP local integration requires SUPPORT_PLATFORM_ADDR=127.0.0.1:8787."
    }
    $serviceToken = if ($env:XZ_ERP_CONNECTOR_TOKEN) {
        $env:XZ_ERP_CONNECTOR_TOKEN
    } else {
        $env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN
    }
    if (-not $serviceToken) {
        throw "ERP local integration requires the existing XZ ERP connector workload credential."
    }
    foreach ($setting in @{
        XZDESK_ALLOWED_ORIGINS = $erpOrigin
        XZDESK_ERP_IAM_BASE_URL = "http://127.0.0.1:8080"
        XZDESK_PUBLIC_ORIGIN = $entryOrigin
        XZDESK_LOCAL_DEMO = "1"
    }.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($setting.Key, $setting.Value, "Process")
    }
    Push-Location $frontendDir
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to build the ERP-enabled customer service frontend."
        }
    } finally {
        Pop-Location
    }
}
$frontendPort = 5173
if ($env:XZDESK_FRONTEND_PORT) {
    try {
        $frontendPort = [int]$env:XZDESK_FRONTEND_PORT
    } catch {
        throw "XZDESK_FRONTEND_PORT must be a valid TCP port."
    }
}
if ($frontendPort -lt 1 -or $frontendPort -gt 65535) {
    throw "XZDESK_FRONTEND_PORT must be between 1 and 65535."
}
$frontendURL = "http://127.0.0.1:$frontendPort"
$existingBackendListener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($existingBackendListener) {
    throw "Xzdesk backend port 8787 became occupied after preflight; no process was replaced."
}
$existingFrontendListener = Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction SilentlyContinue
if ($existingFrontendListener) {
    throw "Xzdesk frontend port $frontendPort is already in use. Set XZDESK_FRONTEND_PORT to a free port and update the development tunnel target to the same port."
}
$env:VITE_XZDESK_BACKEND = if ($env:VITE_XZDESK_BACKEND) {
    $env:VITE_XZDESK_BACKEND.TrimEnd("/")
} else {
    "http://$addr"
}

Push-Location $root
try {
    go build -o $serverExe .\cmd\support-server
} finally {
    Pop-Location
}

$serverArgs = @("-addr", $addr)
$backend = $null
$frontend = $null
$frontendServerPid = 0
try {
    $backend = Start-Process -FilePath $serverExe `
        -ArgumentList $serverArgs `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $serverLog `
        -RedirectStandardError $serverErr `
        -PassThru

    $viteCommand = "npm.cmd run dev -- --host 127.0.0.1 --port $frontendPort --strictPort > ..\runtime\vite-dev.log 2> ..\runtime\vite-dev.err.log"
    $frontend = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", $viteCommand) `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden `
        -PassThru

    $frontendReady = $false
    $startupFailure = ""
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($backend.HasExited) {
            $startupFailure = "Xzdesk API failed to start. Check $serverErr."
            break
        }
        if ($frontend.HasExited) {
            $startupFailure = "Xzdesk workbench failed to start on port $frontendPort. Check $viteErr."
            break
        }
        try {
            $health = Invoke-WebRequest -Uri "$frontendURL/healthz" -UseBasicParsing -TimeoutSec 2
            if ($health.StatusCode -eq 200) {
                $frontendReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $frontendReady) {
        if ($startupFailure) { throw $startupFailure }
        throw "Xzdesk workbench did not become ready at $frontendURL. Check $viteErr."
    }
    $frontendServerPid = [int](Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess
    $frontendServer = Get-RecordedProcess -Id $frontendServerPid
    if (-not (Test-RecordedProcess -Process $frontendServer -Kind "frontend-server")) {
        throw "Xzdesk frontend listener could not be attributed to the new runtime."
    }

    $ownerRecord = @{
        backendPid = $backend.Id
        frontendPid = $frontend.Id
        frontendServerPid = $frontendServerPid
        api = "http://$addr"
        frontend = "$frontendURL/"
        frontendPort = $frontendPort
        frontendBackendProxy = $env:VITE_XZDESK_BACKEND
        storage = if ($env:DATABASE_URL) { "postgres" } elseif ($env:DATA_FILE) { "file" } else { "memory" }
        dataFile = if ($env:DATA_FILE) { $env:DATA_FILE } else { "" }
        mode = if ($UnifiedLocal) { "unified" } elseif ($CustomerServiceOnly) { "customer-service-only" } else { "standard" }
        strictOffline = [bool]($UnifiedLocal -or $CustomerServiceOnly)
        startedAt = (Get-Date).ToString("o")
    }
    $ownerRecord | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
} catch {
    $startupFailure = $_.Exception.Message
    $cleanupFailures = @()
    $candidateFrontendPids = @()
    if ($frontendServerPid -gt 0) { $candidateFrontendPids += $frontendServerPid }
    $candidateFrontendPids += @(Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($candidateId in @($candidateFrontendPids | Select-Object -Unique)) {
        $candidate = Get-RecordedProcess -Id ([int]$candidateId)
        if ($candidate -and (Test-RecordedProcess -Process $candidate -Kind "frontend-server")) {
            try { Stop-Process -Id ([int]$candidateId) -ErrorAction Stop } catch { $cleanupFailures += $_.Exception.Message }
        } elseif ($candidate) {
            $cleanupFailures += "Frontend listener PID $candidateId was not owned by this launch and was left untouched."
        }
    }
    if ($frontend) {
        $frontendProcess = Get-RecordedProcess -Id $frontend.Id
        if ($frontendProcess -and (Test-RecordedProcess -Process $frontendProcess -Kind "frontend")) {
            try { Stop-Process -Id $frontend.Id -ErrorAction Stop } catch { $cleanupFailures += $_.Exception.Message }
        } elseif ($frontendProcess) {
            $cleanupFailures += "Frontend PID $($frontend.Id) could not be reverified and was left untouched."
        }
    }
    if ($backend) {
        $backendProcess = Get-RecordedProcess -Id $backend.Id
        if ($backendProcess -and (Test-RecordedProcess -Process $backendProcess -Kind "backend")) {
            try { Stop-Process -Id $backend.Id -ErrorAction Stop } catch { $cleanupFailures += $_.Exception.Message }
        } elseif ($backendProcess) {
            $cleanupFailures += "Backend PID $($backend.Id) could not be reverified and was left untouched."
        }
    }
    if ($cleanupFailures.Count -eq 0 -and $scratchDataFile) {
        Remove-OwnedScratchArtifacts -Path $scratchDataFile -RuntimeDirectory $runtimeDir -Prefix "customer-service-unified-" -Extension ".json" -IncludeTenantDirectory
    }
    if ($cleanupFailures.Count -gt 0) {
        throw "$startupFailure Cleanup also reported: $($cleanupFailures -join ' ')"
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw $startupFailure
}

Write-Host "Xzdesk API: http://$addr"
Write-Host "Workbench UI: $frontendURL/"
Write-Host "Workbench backend proxy: $env:VITE_XZDESK_BACKEND"
if ($ERPIntegration) {
    Write-Host "ERP browser origin: $env:XZDESK_ALLOWED_ORIGINS"
    Write-Host "ERP IAM base: $env:XZDESK_ERP_IAM_BASE_URL"
    Write-Host "ERP customer-service entry origin: $env:XZDESK_PUBLIC_ORIGIN"
    Write-Host "ERP local deterministic mode: enabled"
    if ($UnifiedLocal) {
        Write-Host "Independent Shopify connector: $env:XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL"
    } elseif ($CustomerServiceOnly) {
        Write-Warning "Customer-service-only mode does not start or configure the independent Shopify connector. Use platform\scripts\start-local-dev.ps1 for the full local system."
    }
}
if ($env:DATABASE_URL) {
    Write-Host "Storage: postgres"
} elseif ($env:DATA_FILE) {
    Write-Host "Storage: file ($env:DATA_FILE)"
} else {
    Write-Host "Storage: memory"
}
Write-Host "PID file: $pidFile"
[pscustomobject]@{ Started = $true; BackendPid = $backend.Id; DataFile = if ($env:DATA_FILE) { $env:DATA_FILE } else { "" } }
