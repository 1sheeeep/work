[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [switch]$OAuthTest,
    [string]$CallbackUrl
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$connectorExe = [System.IO.Path]::GetFullPath((Join-Path $runtimeDir "shopify-connector-dev.exe"))
$pidFile = Join-Path $runtimeDir "shopify-connector-dev-pid.json"
$stdoutLog = Join-Path $runtimeDir "shopify-connector-dev.log"
$stderrLog = Join-Path $runtimeDir "shopify-connector-dev.err.log"
$connectorAddr = "127.0.0.1:8790"
$connectorOrigin = "http://127.0.0.1:8790"
$workloadToken = "xz-erp-local-customer-service-workload"
. (Join-Path $PSScriptRoot "local-runtime-safety.ps1")

function Get-ConnectorProcess {
    param([int]$Id)
    if ($Id -le 0) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction Stop
}

function Test-ConnectorProcess {
    param([object]$Process)
    if (-not $Process -or -not $Process.ExecutablePath) { return $false }
    $path = [System.IO.Path]::GetFullPath([string]$Process.ExecutablePath)
    $command = [string]$Process.CommandLine
    return $path.Equals($connectorExe, [System.StringComparison]::OrdinalIgnoreCase) -and
        $command.Contains("-addr") -and $command.Contains($connectorAddr)
}

function Test-ConnectorHealth {
    try {
        $response = Invoke-WebRequest -Uri "$connectorOrigin/healthz" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Assert-ConnectorScratchBehavior {
    foreach ($attempt in 1..3) {
        $probeId = [Guid]::NewGuid().ToString("N")
        $body = @{
            identity = @{
                tenantId = [Guid]::NewGuid().ToString()
                shopId = [Guid]::NewGuid().ToString()
            }
            context = @{
                correlationId = "local-runtime-$probeId"
                requestId = "local-runtime-$probeId"
            }
        } | ConvertTo-Json -Depth 4 -Compress
        $summary = Invoke-RestMethod `
            -Uri "$connectorOrigin/api/v1/erp-connector/shopify/connection" `
            -Method Post `
            -Headers @{ "X-XZ-ERP-Connector-Token" = $workloadToken } `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 3
        if ($summary.contractVersion -ne "shopify.connector.connection.v3" -or
            $summary.state -ne "NOT_CONFIGURED" -or @($summary.grantedScopes).Count -ne 0) {
            throw "Fresh local Shopify connector scratch repository returned a configured identity."
        }
    }
}

function Get-ConnectorRuntimeStatus {
    [void](Assert-SafeRuntimeAncestors -RuntimeDirectory $runtimeDir)
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
        if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) {
            throw "Shopify connector port 8790 is owned by an unrecorded process; preflight made no changes."
        }
        return [pscustomobject]@{ Ready = $false; StaleRecord = $false }
    }
    try {
        $record = Get-Content -LiteralPath $pidFile -Raw -Encoding utf8 | ConvertFrom-Json
        $recordedPid = [int]$record.pid
        $recordedDataFile = Assert-OwnedScratchPath `
            -Path ([string]$record.dataFile) `
            -RuntimeDirectory $runtimeDir `
            -Prefix "shopify-connector-unified-" `
            -Extension ".enc"
    } catch {
        throw "Shopify connector owner record is malformed; preflight made no changes."
    }
    $process = Get-ConnectorProcess -Id $recordedPid
    if (-not $process) {
        if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) {
            throw "Shopify connector port 8790 is occupied while its owner record is stale; preflight made no changes."
        }
        return [pscustomobject]@{ Ready = $false; StaleRecord = $true; DataFile = $recordedDataFile }
    }
    if (-not (Test-ConnectorProcess -Process $process)) {
        throw "Shopify connector owner record belongs to an unverified process; preflight made no changes."
    }
    if (-not (Test-ConnectorHealth)) {
        throw "Recorded Shopify connector is unhealthy; preflight made no changes."
    }
    $strictOffline = if ($record.PSObject.Properties.Name -contains "strictOffline") {
        [bool]$record.strictOffline
    } else {
        $true
    }
    return [pscustomobject]@{
        Ready = $true
        StaleRecord = $false
        Pid = $recordedPid
        DataFile = $recordedDataFile
        StrictOffline = $strictOffline
    }
}

$runtimeStatus = Get-ConnectorRuntimeStatus
if ($PreflightOnly) {
    $runtimeStatus
    return
}
if ($runtimeStatus.Ready) {
    if ($OAuthTest -eq $runtimeStatus.StrictOffline) {
        $requestedMode = if ($OAuthTest) { "OAuth test" } else { "strict offline" }
        throw "Shopify connector is running in a different mode. Stop the verified local connector before starting $requestedMode mode."
    }
    Assert-ConnectorScratchBehavior
    Write-Host "Shopify connector is already ready at $connectorOrigin."
    [pscustomobject]@{ Started = $false; Adopted = $false; Pid = $runtimeStatus.Pid; DataFile = $runtimeStatus.DataFile }
    return
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
[void](Assert-SafeRuntimeDirectory -RuntimeDirectory $runtimeDir)
if ($runtimeStatus.StaleRecord) {
    Remove-StaleOwnedScratchRecord `
        -Path $runtimeStatus.DataFile `
        -RuntimeDirectory $runtimeDir `
        -Prefix "shopify-connector-unified-" `
        -Extension ".enc" `
        -OwnerRecordPath $pidFile `
        -ExpectedOwnerRecordName "shopify-connector-dev-pid.json" `
        -IncludeLockFile
}
$dataFile = New-IsolatedLocalStatePath `
    -RuntimeDirectory $runtimeDir `
    -Prefix "shopify-connector-unified-" `
    -Extension ".enc"
if (Test-Path -LiteralPath $dataFile) {
    throw "Fresh connector scratch repository path unexpectedly exists."
}
if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) {
    throw "Shopify connector port 8790 became occupied after preflight; no process was replaced."
}

$go = Get-Command go.exe -CommandType Application -ErrorAction SilentlyContinue
if (-not $go) { $go = Get-Command go -CommandType Application -ErrorAction Stop }

$appApiKey = [Environment]::GetEnvironmentVariable(
    "XZ_ERP_SHOPIFY_APP_API_KEY", "Process")
$appApiSecret = [Environment]::GetEnvironmentVariable(
    "XZ_ERP_SHOPIFY_APP_API_SECRET", "Process")
if ($OAuthTest) {
    if ([string]::IsNullOrWhiteSpace($appApiKey) -or
        [string]::IsNullOrWhiteSpace($appApiSecret) -or
        $appApiKey.Contains("not-configured") -or
        $appApiSecret.Contains("not-configured")) {
        throw "OAuth test mode requires XZ_ERP_SHOPIFY_APP_API_KEY and XZ_ERP_SHOPIFY_APP_API_SECRET in the current process environment."
    }
    $callback = $null
    if (-not [Uri]::TryCreate($CallbackUrl, [UriKind]::Absolute, [ref]$callback) -or
        $callback.Scheme -ne "https" -or
        -not [string]::IsNullOrEmpty($callback.UserInfo) -or
        -not [string]::IsNullOrEmpty($callback.Query) -or
        -not [string]::IsNullOrEmpty($callback.Fragment) -or
        $callback.AbsolutePath -ne "/shopify/oauth/callback") {
        throw "OAuth test mode requires -CallbackUrl with an exact HTTPS /shopify/oauth/callback URL."
    }
}

$keyBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($keyBytes)
} finally {
    $random.Dispose()
}
$scratchEncryptionKey = [Convert]::ToBase64String($keyBytes)

# The path was proven absent before launch; that is the empty-repository
# invariant. Random connection probes below are behavior smoke, not an attempt
# to infer whole-repository state from one identity.
Clear-UnifiedLocalProviderEnvironment
$env:XZ_ERP_CONNECTOR_TOKEN = $workloadToken
$env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN = $workloadToken
$env:XZ_CUSTOMER_SERVICE_INTERNAL_BASE_URL = "http://127.0.0.1:8787"
$env:SHOPIFY_CONNECTOR_DATA_FILE = $dataFile
$env:SHOPIFY_CONNECTOR_ENCRYPTION_KEY = $scratchEncryptionKey
$env:SHOPIFY_CONNECTOR_ENCRYPTION_KEY_VERSION = "local-v1"
$env:SHOPIFY_CONNECTOR_CALLBACK_URL = if ($OAuthTest) {
    $callback.AbsoluteUri
} else {
    "https://local.invalid/shopify/oauth/callback"
}
$env:SHOPIFY_APP_API_KEY = if ($OAuthTest) {
    $appApiKey.Trim()
} else {
    "xz-erp-local-not-configured"
}
$env:SHOPIFY_APP_API_SECRET = if ($OAuthTest) {
    $appApiSecret.Trim()
} else {
    "xz-erp-local-not-configured"
}
$env:SHOPIFY_APP_API_VERSION = "2026-07"
$env:SHOPIFY_APP_SCOPES = "read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns"
$env:SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE = "connector-only"
$env:SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN = "https://local.invalid"
$env:HTTP_PROXY = if ($OAuthTest) { "" } else { "http://127.0.0.1:9" }
$env:HTTPS_PROXY = if ($OAuthTest) { "" } else { "http://127.0.0.1:9" }
$env:ALL_PROXY = if ($OAuthTest) { "" } else { "http://127.0.0.1:9" }
$env:NO_PROXY = "127.0.0.1,localhost,::1"

Push-Location $root
try {
    & $go.Source build -o $connectorExe .\cmd\shopify-connector
    if ($LASTEXITCODE -ne 0) { throw "Failed to build the local Shopify connector." }
} finally {
    Pop-Location
}

$connector = Start-Process `
    -FilePath $connectorExe `
    -ArgumentList @("-addr", $connectorAddr) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

try {
    @{
        pid = $connector.Id
        executable = $connectorExe
        address = $connectorAddr
        dataFile = $dataFile
        strictOffline = -not $OAuthTest
        callbackOrigin = if ($OAuthTest) { $callback.GetLeftPart([UriPartial]::Authority) } else { $null }
        startedAt = (Get-Date).ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($connector.HasExited) { break }
        if (Test-ConnectorHealth) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) {
        throw "Shopify connector did not become ready; inspect $stderrLog."
    }
    Assert-ConnectorScratchBehavior
} catch {
    $process = Get-ConnectorProcess -Id $connector.Id
    if ($process -and (Test-ConnectorProcess -Process $process)) {
        Stop-Process -Id $connector.Id -ErrorAction Stop
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Remove-OwnedScratchArtifacts `
        -Path $dataFile `
        -RuntimeDirectory $runtimeDir `
        -Prefix "shopify-connector-unified-" `
        -Extension ".enc" `
        -IncludeLockFile
    throw
}

if ($OAuthTest) {
    Write-Host "Shopify connector: $connectorOrigin (OAuth test mode; fresh encrypted scratch repository)"
    Write-Host "Shopify callback: $($callback.AbsoluteUri)"
} else {
    Write-Host "Shopify connector: $connectorOrigin (fresh scratch repository; NOT_CONFIGURED smoke passed)"
}
Write-Host "Connector data: $dataFile"
Write-Host "Connector logs: $stdoutLog and $stderrLog"
[pscustomobject]@{ Started = $true; Adopted = $false; Pid = $connector.Id; DataFile = $dataFile }
