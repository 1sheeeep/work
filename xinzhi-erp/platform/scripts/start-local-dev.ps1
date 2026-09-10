[CmdletBinding()]
param(
  [switch]$ShopifyOAuthTest,
  [string]$ShopifyCallbackUrl
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "local-dev-common.ps1")

$platformRoot = Get-PlatformRoot
$frontendRoot = Join-Path $platformRoot "frontend"
$composeFile = Join-Path $platformRoot "compose.yaml"
$devComposeFile = Join-Path $platformRoot "compose.dev.yaml"
$viteEntry = Join-Path $frontendRoot "node_modules\vite\bin\vite.js"
$supervisorScript = Join-Path $PSScriptRoot "run-local-backend-dev.ps1"
$state = Get-LocalDevState
$script:stalePidFiles = @()
$customerServiceStart = Join-Path $platformRoot "customer-service\tools\start-platform-dev.ps1"
$customerServiceStop = Join-Path $platformRoot "customer-service\tools\stop-platform-dev.ps1"
$connectorStart = Join-Path $platformRoot "customer-service\tools\start-shopify-connector-dev.ps1"
$connectorStop = Join-Path $platformRoot "customer-service\tools\stop-shopify-connector-dev.ps1"
$localWorkloadToken = "xz-erp-local-customer-service-workload"

if ($ShopifyOAuthTest -and [string]::IsNullOrWhiteSpace($ShopifyCallbackUrl)) {
  throw "Shopify OAuth test mode requires -ShopifyCallbackUrl."
}

function Invoke-Compose {
  param([string[]]$Arguments)
  & $script:docker compose --project-directory $platformRoot -f $composeFile -f $devComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE." }
}

function Invoke-ComposeProbe {
  param([string[]]$Arguments)
  & $script:docker compose --project-directory $platformRoot -f $composeFile -f $devComposeFile @Arguments 2>$null
  return $LASTEXITCODE -eq 0
}

function Get-OwnedPid {
  param([string]$PidFile, [string]$NamePattern, [string[]]$RequiredLiterals, [string]$Label)
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $processId = Read-PidFile -Path $PidFile
  if (-not $processId) { throw "$Label PID record is malformed; refusing to guess which process to stop." }
  if (-not (Get-ProcessInfo -ProcessId $processId)) {
    $script:stalePidFiles += $PidFile
    return $null
  }
  if (-not (Test-ProcessCommand -ProcessId $processId -NamePattern $NamePattern -RequiredLiterals $RequiredLiterals)) {
    throw "$Label PID record belongs to an unverified process; refusing to stop or replace it."
  }
  return $processId
}

function Get-OwnedVitePid {
  if (-not (Test-Path -LiteralPath $state.VitePid)) { return $null }
  $processId = Read-PidFile -Path $state.VitePid
  if (-not $processId) { throw "Vite PID record is malformed; refusing to guess which process to stop." }
  if (-not (Get-ProcessInfo -ProcessId $processId)) {
    $script:stalePidFiles += $state.VitePid
    return $null
  }
  if (-not (Test-ProjectViteProcess -ProcessId $processId -ViteEntry $viteEntry)) {
    throw "Vite PID record belongs to an unverified process; refusing to stop or replace it."
  }
  return $processId
}

function Assert-PortAvailableOrOwned {
  param(
    [int]$Port,
    [int]$OwnedProcessId,
    [string]$Label,
    [object]$ComposeContainer,
    [int]$ContainerPort = 0
  )
  $listeners = @(Get-ListeningProcessIds -Port $Port | Where-Object {
    $_ -ne $OwnedProcessId -and -not (Test-ProcessDescendsFrom -ProcessId $_ -AncestorProcessId $OwnedProcessId)
  })
  if ($listeners.Count -eq 0) { return }
  if ($ComposeContainer -and $ContainerPort -gt 0 -and
      (Test-ComposePublishesPort -Container $ComposeContainer -ContainerPort $ContainerPort -HostPort $Port)) {
    return
  }
  throw "Port $Port is used by an unverified process. $Label will not terminate it."
}

function Wait-ForPostgres {
  param([string]$User, [string]$Database)
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Invoke-ComposeProbe @("exec", "-T", "postgres", "pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", $User, "-d", $Database)) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "PostgreSQL did not become ready within 60 seconds."
}

function Wait-ForLoopbackTcp {
  param([int]$Port, [string]$Label)
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $connect = $client.ConnectAsync("127.0.0.1", $Port)
      if ($connect.Wait(1000) -and $client.Connected) { return }
    } catch {
      # The container health check and host port publication may settle separately.
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Seconds 1
  }
  throw "$Label is not reachable on host loopback. Refusing to start dependent host processes."
}

function Wait-ForHttp {
  param([string]$Uri, [string]$Label)
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return }
    } catch {
      # Startup is expected to race the first readiness probes.
    }
    Start-Sleep -Seconds 1
  }
  throw "$Label did not become ready within 120 seconds."
}

if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
  throw "Vite is not present in platform/frontend/node_modules. This command never installs dependencies; restore the approved local cache before retrying."
}
$viteEntry = Resolve-AbsoluteFile -Path $viteEntry -Label "Vite entry"
$node = Resolve-CommandFile -Names @("node.exe", "node") -Label "Node.js"
$docker = Resolve-DockerCommand
$serverVersion = Test-DockerDaemon -Docker $docker
[void](Resolve-Java25)
[void](Resolve-MavenCommand)
$database = Get-LocalDatabaseConfig
$vitePid = Get-OwnedVitePid
$supervisorPid = Get-OwnedPid -PidFile $state.SupervisorPid -NamePattern "^(powershell|pwsh)(\.exe)?$" -RequiredLiterals @($supervisorScript) -Label "Backend supervisor"
foreach ($requiredScript in @($customerServiceStart, $customerServiceStop, $connectorStart, $connectorStop)) {
  if (-not (Test-Path -LiteralPath $requiredScript -PathType Leaf)) {
    throw "Required local runtime script was not found: $requiredScript"
  }
}
$composeServices = Get-VerifiedComposeServices `
  -Docker $script:docker `
  -PlatformRoot $platformRoot `
  -ComposeFiles @($composeFile, $devComposeFile) `
  -ProjectName "xz-erp-local"
$customerServiceStatus = @(& $customerServiceStart -ERPIntegration -UnifiedLocal -PreflightOnly) | Where-Object {
  $_ -and $_.PSObject.Properties.Name -contains "Ready"
} | Select-Object -Last 1
if (-not $customerServiceStatus) { throw "Customer-service preflight did not return ownership status." }
$connectorStatus = @(if ($ShopifyOAuthTest) {
  & $connectorStart -OAuthTest -CallbackUrl $ShopifyCallbackUrl -PreflightOnly
} else {
  & $connectorStart -PreflightOnly
}) | Where-Object {
  $_ -and $_.PSObject.Properties.Name -contains "Ready"
} | Select-Object -Last 1
if (-not $connectorStatus) { throw "Shopify connector preflight did not return ownership status." }

$webContainer = if ($composeServices.ContainsKey("web")) { $composeServices["web"] } else { $null }
$postgresContainer = if ($composeServices.ContainsKey("postgres")) { $composeServices["postgres"] } else { $null }
$composeServicesToRestore = @()
foreach ($service in @("web", "backend")) {
  if ($composeServices.ContainsKey($service) -and [bool]$composeServices[$service].State.Running) {
    $composeServicesToRestore += [string]$composeServices[$service].Id
  }
}
$postgresStartedHere = -not ($postgresContainer -and [bool]$postgresContainer.State.Running)
Assert-PortAvailableOrOwned -Port 18888 -OwnedProcessId $vitePid -Label "Vite" -ComposeContainer $webContainer -ContainerPort 8080
Assert-PortAvailableOrOwned -Port 8080 -OwnedProcessId $supervisorPid -Label "Backend supervisor"
Assert-PortAvailableOrOwned -Port $database.Port -OwnedProcessId 0 -Label "PostgreSQL" -ComposeContainer $postgresContainer -ContainerPort 5432

# No state, process or Compose mutation is allowed above this point.
[void](Initialize-LocalDevState)
foreach ($stalePidFile in @($script:stalePidFiles | Select-Object -Unique)) {
  if (Test-Path -LiteralPath $stalePidFile -PathType Leaf) {
    Remove-Item -LiteralPath $stalePidFile -Force -ErrorAction Stop
  }
}
$env:ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN = "http://127.0.0.1:8787"
$env:ERP_FIRST_PARTY_ONE_ORIGIN = "http://one.localhost:18888"
$env:ERP_FIRST_PARTY_ERP_ORIGIN = "http://erp.localhost:18888"
$env:ERP_CHANNEL_CONNECTOR_MODE = "xz-erp-app"
$env:ERP_XZ_ERP_APP_CONNECTOR_BASE_URL = "http://127.0.0.1:8787"
$env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN = $localWorkloadToken
$env:XZ_ERP_CONNECTOR_TOKEN = $localWorkloadToken
$env:XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL = "http://127.0.0.1:8790"
$env:XZ_CUSTOMER_SERVICE_INTERNAL_BASE_URL = "http://127.0.0.1:8787"

$startedSupervisorPid = 0
$startedVitePid = 0
$connectorStartedHere = $false
$customerServiceStartedHere = $false
try {
  # Static preview owns web/backend containers. Their project ownership and all
  # five host ports were verified before this first mutating operation.
  Invoke-Compose @("stop", "web", "backend")
  Invoke-Compose @("up", "--pull", "never", "--no-build", "-d", "postgres")
  Wait-ForPostgres -User $database.User -Database $database.Name
  Wait-ForLoopbackTcp -Port $database.Port -Label "PostgreSQL"

  if (-not $supervisorPid) {
    $hostPowerShell = Resolve-CommandFile -Names @("powershell.exe") -Label "Windows PowerShell"
    $supervisor = Start-Process -FilePath $hostPowerShell -ArgumentList @(
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $supervisorScript
    ) -WorkingDirectory $platformRoot -WindowStyle Hidden -PassThru
    $startedSupervisorPid = $supervisor.Id
    Set-Content -LiteralPath $state.SupervisorPid -Value $supervisor.Id -NoNewline -Encoding ascii
  }

  if (-not $vitePid) {
    $vite = Start-Process -FilePath $node -ArgumentList @(
      $viteEntry, "--host", "127.0.0.1", "--port", "18888", "--strictPort"
    ) -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru
    $startedVitePid = $vite.Id
    Set-Content -LiteralPath $state.VitePid -Value $vite.Id -NoNewline -Encoding ascii
  }

  Wait-ForHttp -Uri "http://127.0.0.1:8080/actuator/health/readiness" -Label "Local backend"
  Wait-ForHttp -Uri "http://127.0.0.1:18888/" -Label "Vite HMR"
  Wait-ForHttp -Uri "http://127.0.0.1:18888/api/v1/system/info" -Label "Vite API proxy"

  if ($ShopifyOAuthTest) {
    $env:XZ_ERP_SHOPIFY_APP_API_KEY = [Environment]::GetEnvironmentVariable(
      "XZ_ERP_SHOPIFY_APP_API_KEY", "User")
    $env:XZ_ERP_SHOPIFY_APP_API_SECRET = [Environment]::GetEnvironmentVariable(
      "XZ_ERP_SHOPIFY_APP_API_SECRET", "User")
  }
  $connectorResult = @(if ($ShopifyOAuthTest) {
    & $connectorStart -OAuthTest -CallbackUrl $ShopifyCallbackUrl
  } else {
    & $connectorStart
  }) | Where-Object {
    $_ -and $_.PSObject.Properties.Name -contains "Started"
  } | Select-Object -Last 1
  if (-not $connectorResult) { throw "Shopify connector launcher did not return ownership status." }
  $connectorStartedHere = [bool]$connectorResult.Started
  Wait-ForHttp -Uri "http://127.0.0.1:8790/healthz" -Label "Independent Shopify connector"

  $customerServiceResult = @(& $customerServiceStart -ERPIntegration -UnifiedLocal) | Where-Object {
    $_ -and $_.PSObject.Properties.Name -contains "Started"
  } | Select-Object -Last 1
  if (-not $customerServiceResult) { throw "Customer-service launcher did not return ownership status." }
  $customerServiceStartedHere = [bool]$customerServiceResult.Started
  Wait-ForHttp -Uri "http://127.0.0.1:8787/healthz" -Label "Imported customer-service backend"
  Wait-ForHttp -Uri "http://127.0.0.1:5173/" -Label "Imported customer-service frontend"
  Wait-ForHttp -Uri "http://127.0.0.1:5173/healthz" -Label "Customer-service frontend backend proxy"
} catch {
  $startupFailure = $_.Exception.Message
  $cleanupFailures = @()
  if ($customerServiceStartedHere) {
    try { & $customerServiceStop } catch { $cleanupFailures += $_.Exception.Message }
  }
  if ($connectorStartedHere) {
    try { & $connectorStop } catch { $cleanupFailures += $_.Exception.Message }
  }
  if ($startedVitePid -gt 0) {
    try {
      $viteProcess = Get-ProcessInfo -ProcessId $startedVitePid
      if ($viteProcess -and -not (Test-ProjectViteProcess -ProcessId $startedVitePid -ViteEntry $viteEntry)) {
        throw "New Vite PID could not be reverified and was left untouched."
      }
      if ($viteProcess) { Stop-Process -Id $startedVitePid -ErrorAction Stop }
      if ((Read-PidFile -Path $state.VitePid) -eq $startedVitePid) {
        Remove-Item -LiteralPath $state.VitePid -Force -ErrorAction Stop
      }
    } catch { $cleanupFailures += $_.Exception.Message }
  }
  if ($startedSupervisorPid -gt 0) {
    try {
      $supervisorProcess = Get-ProcessInfo -ProcessId $startedSupervisorPid
      if ($supervisorProcess -and
          -not (Stop-VerifiedProcessTree -RootProcessId $startedSupervisorPid -NamePattern "^(powershell|pwsh)(\.exe)?$" -RequiredLiterals @($supervisorScript))) {
        throw "New backend supervisor could not be reverified or safely stopped."
      }
      if ((Read-PidFile -Path $state.SupervisorPid) -eq $startedSupervisorPid) {
        Remove-Item -LiteralPath $state.SupervisorPid -Force -ErrorAction Stop
      }
    } catch { $cleanupFailures += $_.Exception.Message }
  }
  if ($postgresStartedHere) {
    try { Invoke-Compose @("stop", "postgres") } catch { $cleanupFailures += $_.Exception.Message }
  }
  foreach ($containerId in $composeServicesToRestore) {
    try {
      & $script:docker start $containerId | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Could not restore verified Compose container $containerId." }
    } catch { $cleanupFailures += $_.Exception.Message }
  }
  if ($cleanupFailures.Count -gt 0) {
    throw "$startupFailure Cleanup also reported: $($cleanupFailures -join ' ')"
  }
  throw $startupFailure
}

Write-Output "Docker Server $serverVersion; PostgreSQL is ready on 127.0.0.1:$($database.Port)."
Write-Output "Local backend auto compile/restart is ready at http://127.0.0.1:8080."
Write-Output "Vite HMR is ready at http://127.0.0.1:18888."
Write-Output "Imported customer-service backend is ready at http://127.0.0.1:8787."
Write-Output "Imported customer-service frontend is ready at http://127.0.0.1:5173."
Write-Output "Independent Shopify connector is ready at http://127.0.0.1:8790 and reports NOT_CONFIGURED."
Write-Output "Backend logs: $($state.BackendOut) and $($state.BackendErr)"
Write-Output "Stop with .\platform\scripts\stop-local-dev.ps1."
