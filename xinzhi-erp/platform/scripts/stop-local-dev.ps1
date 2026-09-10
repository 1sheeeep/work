[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "local-dev-common.ps1")

$platformRoot = Get-PlatformRoot
$frontendRoot = Join-Path $platformRoot "frontend"
$composeFile = Join-Path $platformRoot "compose.yaml"
$devComposeFile = Join-Path $platformRoot "compose.dev.yaml"
$supervisorScript = Join-Path $PSScriptRoot "run-local-backend-dev.ps1"
$state = Get-LocalDevState
$script:warnings = @()
$customerServiceStop = Join-Path $platformRoot "customer-service\tools\stop-platform-dev.ps1"
$connectorStop = Join-Path $platformRoot "customer-service\tools\stop-shopify-connector-dev.ps1"
$viteEntry = Join-Path $frontendRoot "node_modules\vite\bin\vite.js"
if (Test-Path -LiteralPath $viteEntry -PathType Leaf) {
  $viteEntry = Resolve-AbsoluteFile -Path $viteEntry -Label "Vite entry"
} else {
  $viteEntry = $null
}

function Stop-OwnedPid {
  param([string]$PidFile, [string]$NamePattern, [string[]]$RequiredLiterals, [string]$Label)
  if (-not (Test-Path -LiteralPath $PidFile)) { return "absent" }
  $processId = Read-PidFile -Path $PidFile
  if (-not $processId) {
    $script:warnings += "$Label PID record is malformed and was left untouched."
    return "malformed"
  }
  if (-not (Get-ProcessInfo -ProcessId $processId)) {
    Remove-Item -LiteralPath $PidFile -Force
    return "stale-stopped"
  }
  if (Stop-VerifiedProcessTree -RootProcessId $processId -NamePattern $NamePattern -RequiredLiterals $RequiredLiterals) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped $Label."
    return "verified-stopped"
  }
  $script:warnings += "$Label PID record belongs to an unverified process and was not stopped."
  return "unverified"
}

function Stop-OwnedVite {
  if (-not (Test-Path -LiteralPath $state.VitePid)) { return }
  $processId = Read-PidFile -Path $state.VitePid
  if (-not $processId) {
    $script:warnings += "local Vite HMR PID record is malformed and was left untouched."
    return
  }
  if (-not (Get-ProcessInfo -ProcessId $processId)) {
    Remove-Item -LiteralPath $state.VitePid -Force
    return
  }
  if (-not $viteEntry -or -not (Test-ProjectViteProcess -ProcessId $processId -ViteEntry $viteEntry)) {
    $script:warnings += "local Vite HMR PID record belongs to an unverified process and was not stopped."
    return
  }
  Stop-Process -Id $processId -ErrorAction Stop
  Remove-Item -LiteralPath $state.VitePid -Force -ErrorAction SilentlyContinue
  Write-Output "Stopped local Vite HMR."
}

function Stop-OwnedBackendMaven {
  if (-not (Test-Path -LiteralPath $state.BackendPid)) { return }
  $processId = Read-PidFile -Path $state.BackendPid
  if (-not $processId) {
    $script:warnings += "local backend Maven PID record is malformed and was left untouched."
    return
  }
  if (-not (Get-ProcessInfo -ProcessId $processId)) {
    Remove-Item -LiteralPath $state.BackendPid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $state.BackendOwner -Force -ErrorAction SilentlyContinue
    return
  }
  $ownerToken = Read-BackendOwnerToken -Path $state.BackendOwner
  if (-not $ownerToken) {
    $script:warnings += "local backend Maven owner record is missing or malformed; the running process was not stopped."
    return
  }
  try {
    $maven = Resolve-MavenCommand
  } catch {
    $script:warnings += "local backend Maven could not be resolved; the running process was not stopped."
    return
  }
  if (-not (Test-BackendMavenProcess -ProcessId $processId -MavenCommand $maven -OwnerToken $ownerToken)) {
    $script:warnings += "local backend Maven PID record belongs to an unverified process and was not stopped."
    return
  }
  if (-not (Stop-VerifiedProcessTree -RootProcessId $processId -NamePattern "^(cmd|mvn)(\.exe)?$" -RequiredLiterals @($maven, "-Dxz.erp.local.dev.owner=$ownerToken", "spring-boot:run"))) {
    $script:warnings += "local backend Maven process could not be safely stopped."
    return
  }
  Remove-Item -LiteralPath $state.BackendPid -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $state.BackendOwner -Force -ErrorAction SilentlyContinue
  Write-Output "Stopped local backend Maven orphan."
}

function Assert-RootOwnerRecords {
  if (Test-Path -LiteralPath $state.VitePid -PathType Leaf) {
    $processId = Read-PidFile -Path $state.VitePid
    if (-not $processId) { throw "local Vite HMR PID record is malformed; preflight made no changes." }
    if ((Get-ProcessInfo -ProcessId $processId) -and
        (-not $viteEntry -or -not (Test-ProjectViteProcess -ProcessId $processId -ViteEntry $viteEntry))) {
      throw "local Vite HMR PID record belongs to an unverified process; preflight made no changes."
    }
  }
  if (Test-Path -LiteralPath $state.SupervisorPid -PathType Leaf) {
    $processId = Read-PidFile -Path $state.SupervisorPid
    if (-not $processId) { throw "local backend supervisor PID record is malformed; preflight made no changes." }
    if ((Get-ProcessInfo -ProcessId $processId) -and
        -not (Test-ProcessCommand -ProcessId $processId -NamePattern "^(powershell|pwsh)(\.exe)?$" -RequiredLiterals @($supervisorScript))) {
      throw "local backend supervisor PID record belongs to an unverified process; preflight made no changes."
    }
  }
  if (Test-Path -LiteralPath $state.BackendPid -PathType Leaf) {
    $processId = Read-PidFile -Path $state.BackendPid
    if (-not $processId) { throw "local backend Maven PID record is malformed; preflight made no changes." }
    if (Get-ProcessInfo -ProcessId $processId) {
      $ownerToken = Read-BackendOwnerToken -Path $state.BackendOwner
      if (-not $ownerToken) { throw "local backend Maven owner record is missing or malformed; preflight made no changes." }
      $maven = Resolve-MavenCommand
      if (-not (Test-BackendMavenProcess -ProcessId $processId -MavenCommand $maven -OwnerToken $ownerToken)) {
        throw "local backend Maven PID record belongs to an unverified process; preflight made no changes."
      }
    }
  }
}

# Validate every owner record and shared Compose label before stopping anything.
if (Test-Path -LiteralPath $customerServiceStop -PathType Leaf) {
  [void](& $customerServiceStop -PreflightOnly)
}
if (Test-Path -LiteralPath $connectorStop -PathType Leaf) {
  [void](& $connectorStop -PreflightOnly)
}
Assert-RootOwnerRecords
$docker = Resolve-DockerCommand
[void](Test-DockerDaemon -Docker $docker)
[void](Get-VerifiedComposeServices `
  -Docker $docker `
  -PlatformRoot $platformRoot `
  -ComposeFiles @($composeFile, $devComposeFile) `
  -ProjectName "xz-erp-local")

if (Test-Path -LiteralPath $customerServiceStop -PathType Leaf) {
  try { & $customerServiceStop } catch { $script:warnings += $_.Exception.Message }
}
if (Test-Path -LiteralPath $connectorStop -PathType Leaf) {
  try { & $connectorStop } catch { $script:warnings += $_.Exception.Message }
}

Stop-OwnedVite
$supervisorStopResult = Stop-OwnedPid -PidFile $state.SupervisorPid -NamePattern "^(powershell|pwsh)(\.exe)?$" -RequiredLiterals @($supervisorScript) -Label "local backend supervisor"
if (Test-BackendOrphanRecoveryAllowed -SupervisorStopResult $supervisorStopResult) {
  Stop-OwnedBackendMaven
} else {
  $script:warnings += "local backend Maven was not treated as an orphan because supervisor stop state is $supervisorStopResult."
}

if ($script:warnings.Count -gt 0) { throw ($script:warnings -join " ") }
& $docker compose --project-directory $platformRoot -f $composeFile -f $devComposeFile stop postgres
if ($LASTEXITCODE -ne 0) { throw "docker compose stop postgres failed with exit code $LASTEXITCODE." }
Write-Output "Stopped local PostgreSQL. Database volumes were retained."
