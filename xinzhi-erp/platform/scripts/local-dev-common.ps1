Set-StrictMode -Version Latest

function Get-PlatformRoot {
  return (Split-Path -Parent $PSScriptRoot)
}

function Get-RepositoryRoot {
  return (Split-Path -Parent (Get-PlatformRoot))
}

function Get-LocalDevState {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) "xz-erp-local-dev"
  return [pscustomobject]@{
    Root = $root
    VitePid = (Join-Path $root "vite.pid")
    SupervisorPid = (Join-Path $root "backend-supervisor.pid")
    BackendPid = (Join-Path $root "backend-maven.pid")
    BackendOwner = (Join-Path $root "backend-owner.token")
    BackendOut = (Join-Path $root "backend.out.log")
    BackendErr = (Join-Path $root "backend.err.log")
  }
}

function Initialize-LocalDevState {
  $state = Get-LocalDevState
  if (-not (Test-Path -LiteralPath $state.Root)) {
    New-Item -ItemType Directory -Path $state.Root -Force | Out-Null
  }
  return $state
}

function Resolve-AbsoluteFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    throw "$Label must be an absolute path."
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label was not found."
  }
  return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
}

function Test-PathInside {
  param([string]$Path, [string]$Root)
  $normalizedPath = [System.IO.Path]::GetFullPath($Path).TrimEnd("\\")
  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\\")
  return $normalizedPath.StartsWith("$normalizedRoot\", [System.StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-CommandFile {
  param([string[]]$Names, [string]$Label)
  foreach ($name in $Names) {
    $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue
    if ($command -and [System.IO.Path]::IsPathRooted($command.Source) -and
        (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $command.Source).Path
    }
  }
  throw "$Label was not found on PATH."
}

function Get-OfflineToolchainRoot {
  if (-not $env:USERPROFILE) { return $null }
  return (Join-Path $env:USERPROFILE ".codex\tmp\erp-production-readiness-toolchain")
}

function Resolve-Java25 {
  $repositoryRoot = Get-RepositoryRoot
  $candidates = @()
  foreach ($toolHome in @($env:ERP_DEV_JAVA_HOME, $env:JAVA_HOME)) {
    if ($toolHome) { $candidates += (Join-Path $toolHome "bin\java.exe") }
  }
  $pathJava = Get-Command java.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($pathJava) { $candidates += $pathJava.Source }
  $offlineRoot = Get-OfflineToolchainRoot
  if ($offlineRoot) {
    $candidates += (Join-Path $offlineRoot "jdk\jdk-25.0.4+7\bin\java.exe")
  }

  foreach ($candidate in $candidates) {
    try {
      $java = Resolve-AbsoluteFile -Path $candidate -Label "Java executable"
      if (Test-PathInside -Path $java -Root $repositoryRoot) { continue }
      $previousErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = "Continue"
        $versionOutput = (& $java -version 2>&1 | Out-String)
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }
      if ($versionOutput -match '(?m)version\s+"25(?:\.|\b)') {
        return [pscustomobject]@{ Executable = $java; Home = (Split-Path -Parent (Split-Path -Parent $java)) }
      }
    } catch {
      continue
    }
  }
  throw "Java 25 was not found. Set ERP_DEV_JAVA_HOME, provide a valid JAVA_HOME/PATH Java 25, or restore the approved offline toolchain."
}

function Resolve-MavenCommand {
  $repositoryRoot = Get-RepositoryRoot
  $candidates = @()
  foreach ($toolHome in @($env:ERP_DEV_MAVEN_HOME, $env:MAVEN_HOME)) {
    if ($toolHome) { $candidates += (Join-Path $toolHome "bin\mvn.cmd") }
  }
  $pathMaven = Get-Command mvn.cmd -CommandType Application -ErrorAction SilentlyContinue
  if ($pathMaven) { $candidates += $pathMaven.Source }
  $offlineRoot = Get-OfflineToolchainRoot
  if ($offlineRoot) {
    $candidates += (Join-Path $offlineRoot "maven\apache-maven-3.9.11\bin\mvn.cmd")
  }

  foreach ($candidate in $candidates) {
    try {
      $maven = Resolve-AbsoluteFile -Path $candidate -Label "Maven command"
      if (-not (Test-PathInside -Path $maven -Root $repositoryRoot)) { return $maven }
    } catch {
      continue
    }
  }
  throw "Maven was not found. Set ERP_DEV_MAVEN_HOME, provide a valid MAVEN_HOME/PATH Maven, or restore the approved offline toolchain."
}

function Resolve-DockerCommand {
  $command = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($command) { return (Resolve-Path -LiteralPath $command.Source).Path }
  $candidates = @(
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "Docker Desktop CLI was not found. Start Docker Desktop manually and retry."
}

function Test-DockerDaemon {
  param([string]$Docker)
  $serverVersion = & $Docker version --format "{{.Server.Version}}" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $serverVersion) {
    throw "Docker daemon is unavailable. Start Docker Desktop manually; this script will not start it."
  }
  return $serverVersion.Trim()
}

function Get-VerifiedComposeServices {
  param(
    [Parameter(Mandatory = $true)][string]$Docker,
    [Parameter(Mandatory = $true)][string]$PlatformRoot,
    [Parameter(Mandatory = $true)][string[]]$ComposeFiles,
    [Parameter(Mandatory = $true)][string]$ProjectName,
    [string[]]$Services = @("postgres", "web", "backend")
  )
  $expectedWorkingDirectory = [System.IO.Path]::GetFullPath($PlatformRoot).TrimEnd("\")
  $expectedConfigs = @($ComposeFiles | ForEach-Object { [System.IO.Path]::GetFullPath($_) })
  $verified = @{}
  $containerIds = @(& $Docker ps -a --filter "label=com.docker.compose.project=$ProjectName" --format "{{.ID}}")
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect local Compose ownership." }
  foreach ($containerId in $containerIds) {
    if (-not $containerId) { continue }
    $container = @(& $Docker inspect $containerId | ConvertFrom-Json)[0]
    $labels = $container.Config.Labels
    $service = [string]$labels.'com.docker.compose.service'
    if ($service -notin $Services) { continue }
    $workingDirectory = [System.IO.Path]::GetFullPath([string]$labels.'com.docker.compose.project.working_dir').TrimEnd("\")
    $configs = @(([string]$labels.'com.docker.compose.project.config_files').Split(",") | ForEach-Object {
      [System.IO.Path]::GetFullPath($_)
    })
    $configsMatch = $configs.Count -eq $expectedConfigs.Count
    foreach ($expected in $expectedConfigs) {
      $configsMatch = $configsMatch -and @($configs | Where-Object { $_.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1
    }
    if (-not $workingDirectory.Equals($expectedWorkingDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or -not $configsMatch) {
      throw "Compose service $service belongs to another project directory; preflight made no changes."
    }
    if ($verified.ContainsKey($service)) { throw "Compose service $service has ambiguous containers; preflight made no changes." }
    $verified[$service] = $container
  }
  return $verified
}

function Test-ComposePublishesPort {
  param([object]$Container, [int]$ContainerPort, [int]$HostPort)
  if (-not $Container -or -not [bool]$Container.State.Running -or -not $Container.NetworkSettings) { return $false }
  $binding = $Container.NetworkSettings.Ports.PSObject.Properties["$ContainerPort/tcp"]
  if (-not $binding -or -not $binding.Value) { return $false }
  $matches = @($binding.Value | Where-Object {
    $_.HostIp -eq "127.0.0.1" -and [int]$_.HostPort -eq $HostPort
  })
  return $matches.Count -eq 1
}

function Get-LocalDatabaseConfig {
  $platformRoot = Get-PlatformRoot
  $values = @{}
  $envFile = Join-Path $platformRoot ".env"
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $envFile -Encoding utf8) {
      if ($line -match '^\s*(ERP_DB_NAME|ERP_DB_USER|ERP_DB_PASSWORD|ERP_DB_HOST_PORT)=(.*)$') {
        $values[$matches[1]] = $matches[2]
      }
    }
  }
  foreach ($key in @("ERP_DB_NAME", "ERP_DB_USER", "ERP_DB_PASSWORD", "ERP_DB_HOST_PORT")) {
    $processValue = [Environment]::GetEnvironmentVariable($key, "Process")
    if ($processValue) { $values[$key] = $processValue }
  }
  $name = if ($values["ERP_DB_NAME"]) { $values["ERP_DB_NAME"] } else { "xz_erp" }
  $user = if ($values["ERP_DB_USER"]) { $values["ERP_DB_USER"] } else { "erp_app" }
  $password = $values["ERP_DB_PASSWORD"]
  $port = if ($values["ERP_DB_HOST_PORT"]) { $values["ERP_DB_HOST_PORT"] } else { "5432" }
  if ($name -notmatch '^[A-Za-z0-9_]+$' -or $user -notmatch '^[A-Za-z0-9_]+$') {
    throw "Local database name and user may contain only letters, numbers, and underscores."
  }
  if (-not $password) { throw "ERP_DB_PASSWORD must be set in the process environment or platform/.env before host backend development can start." }
  if ($port -notmatch '^\d+$' -or [int]$port -lt 1 -or [int]$port -gt 65535) {
    throw "ERP_DB_HOST_PORT must be a valid TCP port."
  }
  return [pscustomobject]@{ Name = $name; User = $user; Password = $password; Port = [int]$port }
}

function Read-PidFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $raw = (Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue).Trim()
  if ($raw -notmatch '^\d+$') { return $null }
  return [int]$raw
}

function Read-BackendOwnerToken {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $token = (Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue).Trim()
  if ($token -notmatch '^[0-9a-f]{32}$') { return $null }
  return $token
}

function Get-ProcessInfo {
  param([int]$ProcessId)
  return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-ProcessCommand {
  param([int]$ProcessId, [string]$NamePattern, [string[]]$RequiredLiterals)
  $process = Get-ProcessInfo -ProcessId $ProcessId
  if ($null -eq $process -or $process.Name -notmatch $NamePattern) { return $false }
  foreach ($literal in $RequiredLiterals) {
    if ([string]::IsNullOrWhiteSpace($process.CommandLine) -or
        $process.CommandLine -notmatch [regex]::Escape($literal)) { return $false }
  }
  return $true
}

function Test-ProjectViteProcess {
  param([int]$ProcessId, [string]$ViteEntry)
  return Test-ProcessCommand -ProcessId $ProcessId -NamePattern "^node(\.exe)?$" -RequiredLiterals @(
    $ViteEntry,
    "--host",
    "127.0.0.1",
    "--port",
    "18888",
    "--strictPort"
  )
}

function Test-BackendMavenProcess {
  param([int]$ProcessId, [string]$MavenCommand, [string]$OwnerToken)
  if ($OwnerToken -notmatch '^[0-9a-f]{32}$') { return $false }
  return Test-ProcessCommand -ProcessId $ProcessId -NamePattern "^(cmd|mvn)(\.exe)?$" -RequiredLiterals @(
    $MavenCommand,
    "-Dxz.erp.local.dev.owner=$OwnerToken",
    "spring-boot:run"
  )
}

function Test-BackendOrphanRecoveryAllowed {
  param([string]$SupervisorStopResult)
  return $SupervisorStopResult -in @("absent", "stale-stopped", "verified-stopped")
}

function Get-ListeningProcessIds {
  param([int]$Port)
  return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-ProcessDescendsFrom {
  param([int]$ProcessId, [int]$AncestorProcessId)
  $current = $ProcessId
  while ($current -gt 0) {
    if ($current -eq $AncestorProcessId) { return $true }
    $process = Get-ProcessInfo -ProcessId $current
    if ($null -eq $process -or $process.ParentProcessId -eq $current) { return $false }
    $current = [int]$process.ParentProcessId
  }
  return $false
}

function Stop-VerifiedProcessTree {
  param([int]$RootProcessId, [string]$NamePattern, [string[]]$RequiredLiterals)
  if (-not (Test-ProcessCommand -ProcessId $RootProcessId -NamePattern $NamePattern -RequiredLiterals $RequiredLiterals)) {
    return $false
  }
  $descendants = @()
  $pending = @($RootProcessId)
  while ($pending.Count -gt 0) {
    $parent = $pending[0]
    if ($pending.Count -eq 1) { $pending = @() } else { $pending = $pending[1..($pending.Count - 1)] }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $parent" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      $descendants += [int]$child.ProcessId
      $pending += [int]$child.ProcessId
    }
  }
  foreach ($processId in ($descendants | Sort-Object -Descending)) {
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $RootProcessId -ErrorAction SilentlyContinue
  return $true
}
