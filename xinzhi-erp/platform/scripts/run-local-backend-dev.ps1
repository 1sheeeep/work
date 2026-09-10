[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "local-dev-common.ps1")

$platformRoot = Get-PlatformRoot
$backendRoot = Join-Path $platformRoot "backend"
$state = Initialize-LocalDevState
$pomFile = Join-Path $backendRoot "pom.xml"
$sourceRoot = Join-Path $backendRoot "src\main"
$supervisorScript = Resolve-AbsoluteFile -Path $PSCommandPath -Label "Backend supervisor script"
$maven = Resolve-MavenCommand
$java = Resolve-Java25
$database = Get-LocalDatabaseConfig
$env:JAVA_HOME = $java.Home
$env:ERP_DB_URL = "jdbc:postgresql://127.0.0.1:$($database.Port)/$($database.Name)"
$env:ERP_DB_USER = $database.User
$env:ERP_DB_PASSWORD = $database.Password
$env:ERP_ENVIRONMENT = "local"
$env:SERVER_ADDRESS = "127.0.0.1"
if (-not $env:ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN) {
  $env:ERP_CUSTOMER_SERVICE_ENTRY_ORIGIN = "http://127.0.0.1:8787"
}
if (-not $env:ERP_FIRST_PARTY_ONE_ORIGIN) {
  $env:ERP_FIRST_PARTY_ONE_ORIGIN = "http://one.localhost:18888"
}
if (-not $env:ERP_FIRST_PARTY_ERP_ORIGIN) {
  $env:ERP_FIRST_PARTY_ERP_ORIGIN = "http://erp.localhost:18888"
}
if (-not $env:ERP_CHANNEL_CONNECTOR_MODE) {
  $env:ERP_CHANNEL_CONNECTOR_MODE = "xz-erp-app"
}
if (-not $env:ERP_XZ_ERP_APP_CONNECTOR_BASE_URL) {
  $env:ERP_XZ_ERP_APP_CONNECTOR_BASE_URL = "http://127.0.0.1:8787"
}
if (-not $env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN) {
  $env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN = "xz-erp-local-customer-service-workload"
}
$existingSupervisorPid = Read-PidFile -Path $state.SupervisorPid
if (Test-Path -LiteralPath $state.SupervisorPid) {
  if (-not $existingSupervisorPid) {
    throw "Backend supervisor PID record is malformed; refusing to replace it."
  }
  $existingSupervisor = Get-ProcessInfo -ProcessId $existingSupervisorPid
  if ($null -eq $existingSupervisor) {
    Remove-Item -LiteralPath $state.SupervisorPid -Force -ErrorAction SilentlyContinue
  } elseif (-not (Test-ProcessCommand -ProcessId $existingSupervisorPid -NamePattern "^(powershell|pwsh)(\.exe)?$" -RequiredLiterals @($supervisorScript))) {
    throw "Backend supervisor PID record belongs to an unverified process; refusing to replace it."
  } elseif ($existingSupervisorPid -ne $PID) {
    throw "A recorded backend supervisor is already running; refusing to replace it."
  }
}
$existingBackendPid = Read-PidFile -Path $state.BackendPid
if (Test-Path -LiteralPath $state.BackendPid) {
  if (-not $existingBackendPid) {
    throw "Backend PID record is malformed; refusing to replace it."
  }
  if (Get-ProcessInfo -ProcessId $existingBackendPid) {
    throw "A recorded backend Maven process already exists; run stop-local-dev.ps1 to verify and stop it before starting a new supervisor."
  }
  Remove-Item -LiteralPath $state.BackendPid -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $state.BackendOwner -Force -ErrorAction SilentlyContinue
}
$ownerToken = [Guid]::NewGuid().ToString("N")
Set-Content -LiteralPath $state.BackendOwner -Value $ownerToken -NoNewline -Encoding ascii

function Get-BackendWatchSignature {
  $files = @((Get-Item -LiteralPath $pomFile))
  if (Test-Path -LiteralPath $sourceRoot -PathType Container) {
    $files += @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -ErrorAction Stop)
  }
  return ($files | Sort-Object FullName | ForEach-Object {
    "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)"
  }) -join "`n"
}

function Stop-BackendChild {
  $backendPid = Read-PidFile -Path $state.BackendPid
  if ($backendPid) {
    if (Get-ProcessInfo -ProcessId $backendPid) {
      if (-not (Test-BackendMavenProcess -ProcessId $backendPid -MavenCommand $maven -OwnerToken $ownerToken) -or
          -not (Stop-VerifiedProcessTree -RootProcessId $backendPid -NamePattern "^(cmd|mvn)(\.exe)?$" -RequiredLiterals @($maven, "-Dxz.erp.local.dev.owner=$ownerToken", "spring-boot:run"))) {
        throw "Backend PID record belongs to an unverified process; refusing to replace it."
      }
    }
  }
  if (Test-Path -LiteralPath $state.BackendPid) {
    Remove-Item -LiteralPath $state.BackendPid -Force -ErrorAction SilentlyContinue
  }
}

function Start-BackendChild {
  Stop-BackendChild
  $startOptions = @{
    FilePath = $maven
    ArgumentList = @("-o", "-Dxz.erp.local.dev.owner=$ownerToken", "spring-boot:run")
    WorkingDirectory = $backendRoot
    WindowStyle = "Hidden"
    PassThru = $true
    RedirectStandardOutput = $state.BackendOut
    RedirectStandardError = $state.BackendErr
  }
  $child = Start-Process @startOptions
  Set-Content -LiteralPath $state.BackendPid -Value $child.Id -NoNewline -Encoding ascii
  Write-Output "Backend compile/restart started; logs: $($state.BackendOut)"
}

if (-not (Test-Path -LiteralPath $state.SupervisorPid)) {
  Set-Content -LiteralPath $state.SupervisorPid -Value $PID -NoNewline -Encoding ascii
}
$signature = Get-BackendWatchSignature
$changedAt = [DateTime]::UtcNow
try {
  Start-BackendChild
  $changedAt = [DateTime]::MaxValue
  while ($true) {
    Start-Sleep -Milliseconds 750
    $currentSignature = Get-BackendWatchSignature
    if ($currentSignature -ne $signature) {
      $signature = $currentSignature
      $changedAt = [DateTime]::UtcNow
      continue
    }
    if ($changedAt -ne [DateTime]::MaxValue -and
        ([DateTime]::UtcNow - $changedAt).TotalMilliseconds -ge 750) {
      Start-BackendChild
      $changedAt = [DateTime]::MaxValue
    }
    $backendPid = Read-PidFile -Path $state.BackendPid
    if (-not $backendPid -or -not (Test-BackendMavenProcess -ProcessId $backendPid -MavenCommand $maven -OwnerToken $ownerToken)) {
      Start-BackendChild
    }
  }
} finally {
  Stop-BackendChild
  if ((Read-PidFile -Path $state.SupervisorPid) -eq $PID) {
    Remove-Item -LiteralPath $state.SupervisorPid -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $state.BackendOwner) {
    Remove-Item -LiteralPath $state.BackendOwner -Force -ErrorAction SilentlyContinue
  }
}
