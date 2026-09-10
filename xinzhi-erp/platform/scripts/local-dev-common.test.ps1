$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "local-dev-common.ps1")
$customerServiceTools = Join-Path (Get-PlatformRoot) "customer-service\tools"
$runtimeSafetyScript = Join-Path $customerServiceTools "local-runtime-safety.ps1"
. $runtimeSafetyScript

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

Assert-True (Test-PathInside -Path "C:\safe\child\tool.exe" -Root "C:\safe") "Expected child path to be inside root."
Assert-True (-not (Test-PathInside -Path "C:\safe-other\tool.exe" -Root "C:\safe")) "Sibling path must not be inside root."
$repositoryRoot = Get-RepositoryRoot
Assert-True (Test-PathInside -Path (Join-Path $repositoryRoot "untrusted-tool.exe") -Root $repositoryRoot) "Repository-root tools must be considered untrusted."

$pidFixture = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $pidFixture -Value "123" -NoNewline -Encoding ascii
  Assert-True ((Read-PidFile -Path $pidFixture) -eq 123) "Expected numeric PID to parse."
  Set-Content -LiteralPath $pidFixture -Value "not-a-pid" -NoNewline -Encoding ascii
  Assert-True ($null -eq (Read-PidFile -Path $pidFixture)) "Malformed PID must be rejected."
} finally {
  Remove-Item -LiteralPath $pidFixture -Force -ErrorAction SilentlyContinue
}

$tokenFixture = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $tokenFixture -Value "0123456789abcdef0123456789abcdef" -NoNewline -Encoding ascii
  Assert-True ((Read-BackendOwnerToken -Path $tokenFixture) -eq "0123456789abcdef0123456789abcdef") "Expected backend owner token to parse."
  Set-Content -LiteralPath $tokenFixture -Value "invalid-token" -NoNewline -Encoding ascii
  Assert-True ($null -eq (Read-BackendOwnerToken -Path $tokenFixture)) "Malformed backend owner token must be rejected."
} finally {
  Remove-Item -LiteralPath $tokenFixture -Force -ErrorAction SilentlyContinue
}

$script:fixtureProcess = [pscustomobject]@{
  Name = "node.exe"
  CommandLine = "node `"$repositoryRoot\platform\frontend\node_modules\vite\bin\vite.js`" --host 127.0.0.1 --port 18888 --strictPort"
}
function Get-ProcessInfo {
  param([int]$ProcessId)
  return $script:fixtureProcess
}
$currentViteEntry = "$repositoryRoot\platform\frontend\node_modules\vite\bin\vite.js"
Assert-True (Test-ProjectViteProcess -ProcessId 123 -ViteEntry $currentViteEntry) "Expected the project Vite process to be recognized."
Assert-True (-not (Test-ProjectViteProcess -ProcessId 123 -ViteEntry "C:\other-project\platform\frontend\node_modules\vite\bin\vite.js")) "An unrelated Vite process must not be adopted."
$script:fixtureProcess = [pscustomobject]@{
  Name = "cmd.exe"
  CommandLine = "cmd.exe /c C:\tools\mvn.cmd -Dxz.erp.local.dev.owner=0123456789abcdef0123456789abcdef spring-boot:run"
}
Assert-True (Test-BackendMavenProcess -ProcessId 123 -MavenCommand "C:\tools\mvn.cmd" -OwnerToken "0123456789abcdef0123456789abcdef") "Expected owned backend Maven process to be recognized."
Assert-True (-not (Test-BackendMavenProcess -ProcessId 123 -MavenCommand "C:\tools\mvn.cmd" -OwnerToken "fedcba9876543210fedcba9876543210")) "Backend Maven process with another owner token must not be stopped."
foreach ($safeSupervisorState in @("absent", "stale-stopped", "verified-stopped")) {
  Assert-True (Test-BackendOrphanRecoveryAllowed -SupervisorStopResult $safeSupervisorState) "Backend orphan recovery must be allowed only after supervisor state $safeSupervisorState."
}
foreach ($unsafeSupervisorState in @("malformed", "unverified")) {
  Assert-True (-not (Test-BackendOrphanRecoveryAllowed -SupervisorStopResult $unsafeSupervisorState)) "Backend orphan recovery must be blocked for supervisor state $unsafeSupervisorState."
}

$original = @{}
foreach ($key in @("ERP_DB_NAME", "ERP_DB_USER", "ERP_DB_PASSWORD", "ERP_DB_HOST_PORT")) {
  $original[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}
try {
  [Environment]::SetEnvironmentVariable("ERP_DB_NAME", "xz_erp_test", "Process")
  [Environment]::SetEnvironmentVariable("ERP_DB_USER", "erp_test", "Process")
  [Environment]::SetEnvironmentVariable("ERP_DB_PASSWORD", "fixture", "Process")
  [Environment]::SetEnvironmentVariable("ERP_DB_HOST_PORT", "55432", "Process")
  $database = Get-LocalDatabaseConfig
  Assert-True ($database.Port -eq 55432 -and $database.Name -eq "xz_erp_test") "Expected strict local database configuration."
} finally {
  foreach ($key in $original.Keys) {
    [Environment]::SetEnvironmentVariable($key, $original[$key], "Process")
  }
}

$providerKeys = @(
  "SHOPIFY_ADMIN_ACCESS_TOKEN_STORE_FIXTURE",
  "SHOPIFY_CREDENTIALS_ENCRYPTION_KEY",
  "AI_SETTINGS_ENCRYPTION_KEY",
  "OUTLOOK_WEBHOOK_SECRET",
  "GMAIL_CLIENT_SECRET",
  "EMAIL_PROVIDER_TOKEN",
  "OPENAI_API_KEY",
  "VITE_SHOPIFY_ADMIN_ACCESS_TOKEN_FIXTURE",
  "CUIQIU_TOKEN",
  "SEVENTEENTRACK_API_KEY",
  "PUBLIC_BASE_URL"
)
$providerOriginal = @{}
foreach ($key in $providerKeys) {
  $providerOriginal[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
  [Environment]::SetEnvironmentVariable($key, "synthetic-secret-fixture", "Process")
}
try {
  Clear-UnifiedLocalProviderEnvironment
  foreach ($key in $providerKeys) {
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key, "Process"))) "Unified runtime did not clear inherited provider key $key."
  }
} finally {
  foreach ($key in $providerKeys) {
    [Environment]::SetEnvironmentVariable($key, $providerOriginal[$key], "Process")
  }
}

$scratchFixture = Join-Path ([System.IO.Path]::GetTempPath()) ("xz-erp-scratch-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $scratchFixture -ErrorAction Stop | Out-Null
try {
  $legacyFile = Join-Path $scratchFixture "platform-dev-data.json"
  Set-Content -LiteralPath $legacyFile -Encoding utf8 -Value '{"sources":[{"provider":"outlook","accessToken":"historical-token","refreshToken":"historical-refresh"}]}'
  $customerScratch = New-IsolatedLocalStatePath -RuntimeDirectory $scratchFixture -Prefix "customer-service-unified-" -Extension ".json"
  $connectorScratch = New-IsolatedLocalStatePath -RuntimeDirectory $scratchFixture -Prefix "shopify-connector-unified-" -Extension ".enc"
  Assert-True (-not $customerScratch.Equals($legacyFile, [System.StringComparison]::OrdinalIgnoreCase)) "Customer-service scratch store reused the historical provider snapshot."
  Assert-True (-not (Test-Path -LiteralPath $customerScratch)) "Customer-service scratch path must be proven absent before launch."
  Assert-True (-not (Test-Path -LiteralPath $connectorScratch)) "Connector scratch path must be proven absent before launch."
  Assert-True ($customerScratch -ne $connectorScratch) "Customer-service and connector must not share scratch state."

  Set-Content -LiteralPath $customerScratch -Encoding utf8 -Value '{"sources":[{"provider":"outlook","accessToken":"stale-synthetic-token"}]}'
  New-Item -ItemType Directory -Path "$customerScratch.tenants" -ErrorAction Stop | Out-Null
  Set-Content -LiteralPath (Join-Path "$customerScratch.tenants" "tenant.json") -Encoding utf8 -Value '{}'
  $staleOwnerRecord = Join-Path $scratchFixture "platform-dev-pids.json"
  Set-Content -LiteralPath $staleOwnerRecord -Encoding utf8 -Value '{"backendPid":2147483000,"mode":"unified"}'
  Remove-StaleOwnedScratchRecord `
    -Path $customerScratch `
    -RuntimeDirectory $scratchFixture `
    -Prefix "customer-service-unified-" `
    -Extension ".json" `
    -OwnerRecordPath $staleOwnerRecord `
    -ExpectedOwnerRecordName "platform-dev-pids.json" `
    -IncludeTenantDirectory
  Assert-True (-not (Test-Path -LiteralPath $customerScratch)) "Stale customer-service data file was retained."
  Assert-True (-not (Test-Path -LiteralPath "$customerScratch.tenants")) "Stale customer-service tenant scratch was retained."
  Assert-True (-not (Test-Path -LiteralPath $staleOwnerRecord)) "Stale customer-service owner record was retained."
} finally {
  $resolvedScratchFixture = [System.IO.Path]::GetFullPath($scratchFixture)
  $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\")
  $scratchItem = Get-Item -LiteralPath $resolvedScratchFixture -Force -ErrorAction Stop
  if (-not $resolvedScratchFixture.StartsWith("$expectedTempRoot\xz-erp-scratch-test-", [System.StringComparison]::OrdinalIgnoreCase) -or
      ($scratchItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Scratch test cleanup target failed validation."
  }
  Remove-Item -LiteralPath $resolvedScratchFixture -Recurse -Force -ErrorAction Stop
}

$junctionFixture = Join-Path ([System.IO.Path]::GetTempPath()) ("xz-erp-junction-test-" + [Guid]::NewGuid().ToString("N"))
$junctionParent = Join-Path $junctionFixture "owned"
$junctionTarget = Join-Path $junctionFixture "outside"
$junctionRuntime = Join-Path $junctionParent "runtime"
New-Item -ItemType Directory -Path $junctionParent -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $junctionTarget -ErrorAction Stop | Out-Null
$sentinel = Join-Path $junctionTarget "must-survive.txt"
Set-Content -LiteralPath $sentinel -Value "synthetic" -Encoding utf8
New-Item -ItemType Junction -Path $junctionRuntime -Target $junctionTarget -ErrorAction Stop | Out-Null
try {
  $junctionRejected = $false
  try {
    [void](New-IsolatedLocalStatePath -RuntimeDirectory $junctionRuntime -Prefix "customer-service-unified-" -Extension ".json")
  } catch {
    $junctionRejected = $_.Exception.Message -match "junction or reparse point"
  }
  Assert-True $junctionRejected "Scratch allocation must reject a runtime ancestor junction."

  $missingRuntimeRejected = $false
  try {
    [void](Assert-SafeRuntimeAncestors -RuntimeDirectory (Join-Path $junctionRuntime "not-created"))
  } catch {
    $missingRuntimeRejected = $_.Exception.Message -match "junction or reparse point"
  }
  Assert-True $missingRuntimeRejected "Scratch preflight must reject a missing runtime below an ancestor junction before directory creation."

  $junctionOwnerPath = Join-Path $junctionRuntime ("customer-service-unified-" + (("a" * 32) -join "") + ".json")
  $cleanupRejected = $false
  try {
    Remove-OwnedScratchArtifacts -Path $junctionOwnerPath -RuntimeDirectory $junctionRuntime -Prefix "customer-service-unified-" -Extension ".json" -IncludeTenantDirectory
  } catch {
    $cleanupRejected = $_.Exception.Message -match "junction or reparse point"
  }
  Assert-True $cleanupRejected "Scratch cleanup must reject a runtime ancestor junction."
  Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) "Junction rejection must not traverse or delete the external target."
} finally {
  if (Test-Path -LiteralPath $junctionRuntime) {
    $junctionItem = Get-Item -LiteralPath $junctionRuntime -Force -ErrorAction Stop
    if (($junctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
      throw "Junction test cleanup refused a non-junction runtime path."
    }
    [System.IO.Directory]::Delete($junctionRuntime)
  }
  $resolvedJunctionFixture = [System.IO.Path]::GetFullPath($junctionFixture)
  $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\")
  $remainingReparse = @(Get-ChildItem -LiteralPath $resolvedJunctionFixture -Force -Recurse -ErrorAction Stop | Where-Object {
    ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  })
  if (-not $resolvedJunctionFixture.StartsWith("$expectedTempRoot\xz-erp-junction-test-", [System.StringComparison]::OrdinalIgnoreCase) -or
      $remainingReparse.Count -gt 0) {
    throw "Junction test cleanup target failed validation."
  }
  Remove-Item -LiteralPath $resolvedJunctionFixture -Recurse -Force -ErrorAction Stop
}

$commonSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "local-dev-common.ps1") -Raw
$supervisorSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "run-local-backend-dev.ps1") -Raw
$startSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "start-local-dev.ps1") -Raw
$stopSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "stop-local-dev.ps1") -Raw
$customerStartSource = Get-Content -LiteralPath (Join-Path $customerServiceTools "start-platform-dev.ps1") -Raw
$customerOnlySource = Get-Content -LiteralPath (Join-Path $customerServiceTools "start-erp-local.ps1") -Raw
$connectorStartSource = Get-Content -LiteralPath (Join-Path $customerServiceTools "start-shopify-connector-dev.ps1") -Raw
$connectorStopSource = Get-Content -LiteralPath (Join-Path $customerServiceTools "stop-shopify-connector-dev.ps1") -Raw
$supportServerSource = Get-Content -LiteralPath (Join-Path (Get-PlatformRoot) "customer-service\cmd\support-server\main.go") -Raw
$mailAPISource = Get-Content -LiteralPath (Join-Path (Get-PlatformRoot) "customer-service\internal\mailapi\mailapi.go") -Raw
Assert-True ($commonSource.Contains("`$repositoryRoot = Get-RepositoryRoot")) "Java and Maven tool rejection must use the repository root."
Assert-True ($commonSource.Contains("function Test-BackendMavenProcess")) "Backend orphan recovery must require a verified owner token."
Assert-True ($stopSource.Contains("`$supervisorStopResult = Stop-OwnedPid")) "Stop must evaluate supervisor state before Maven orphan recovery."
Assert-True ($supervisorSource.Contains("Backend supervisor PID record is malformed; refusing to replace it.")) "Supervisor startup must fail closed for malformed PID records."
Assert-True ($supervisorSource.Contains('$env:SERVER_ADDRESS = "127.0.0.1"')) "Backend supervisor must bind Spring to loopback."
Assert-True ($startSource.Contains('http://127.0.0.1:18888/api/v1/system/info')) "Vite proxy readiness probe must use a public API endpoint."
Assert-True (-not $startSource.Contains('http://127.0.0.1:18888/api/actuator/health/readiness')) "Vite proxy must not probe an unauthenticated actuator path under /api."
Assert-True ($startSource.Contains('$env:XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL = "http://127.0.0.1:8790"')) "Unified startup must inject the independent connector base URL."
Assert-True ($startSource.Contains('http://127.0.0.1:8790/healthz')) "Unified startup must check connector health."
Assert-True ($startSource.Contains('http://127.0.0.1:5173/')) "Unified startup must check the customer-service frontend separately."
Assert-True ($startSource.Contains('-ERPIntegration -UnifiedLocal -PreflightOnly')) "Root start must preflight customer-service ownership."
Assert-True ($startSource.Contains('$connectorStart -PreflightOnly')) "Root start must preflight connector ownership."
Assert-True ($startSource.IndexOf('$composeServices = Get-VerifiedComposeServices') -lt $startSource.IndexOf('Invoke-Compose @("stop", "web", "backend")')) "Compose ownership must be checked before Compose stop."
foreach ($portStatement in @(
  'Assert-PortAvailableOrOwned -Port 18888',
  'Assert-PortAvailableOrOwned -Port 8080',
  'Assert-PortAvailableOrOwned -Port $database.Port'
)) {
  Assert-True ($startSource.IndexOf($portStatement) -lt $startSource.IndexOf('Invoke-Compose @("stop", "web", "backend")')) "$portStatement must run before the first Compose mutation."
}
Assert-True ($startSource.IndexOf('[void](Initialize-LocalDevState)') -gt $startSource.IndexOf('Assert-PortAvailableOrOwned -Port $database.Port')) "Root owner state must not be initialized before all port checks pass."
Assert-True ($stopSource.Contains('stop-shopify-connector-dev.ps1')) "Unified stop must include the owned connector process."
Assert-True ($stopSource.IndexOf('Get-VerifiedComposeServices') -lt $stopSource.IndexOf('try { & $customerServiceStop }')) "Unified stop must verify Compose ownership before stopping any child process."
Assert-True ($stopSource.IndexOf('Assert-RootOwnerRecords') -lt $stopSource.IndexOf('try { & $customerServiceStop }')) "Unified stop must validate root PID ownership before stopping any child process."
Assert-True ($stopSource.IndexOf('if ($script:warnings.Count -gt 0)') -lt $stopSource.IndexOf('& $docker compose')) "Unverified process warnings must abort before PostgreSQL is stopped."
Assert-True ($customerStartSource.Contains('XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL = if ($UnifiedLocal)')) "Customer service must receive the connector base only in unified mode."
Assert-True ($customerStartSource.Contains('Clear-UnifiedLocalProviderEnvironment')) "Unified customer-service mode must scrub inherited provider credential families."
Assert-True ($customerStartSource.Contains('New-IsolatedLocalStatePath')) "Unified customer-service mode must use a fresh scratch store."
Assert-True ($customerStartSource.Contains('StaleRecord = $true; DataFile = [string]$record.dataFile')) "Stale customer-service ownership must carry its scratch path into cleanup."
Assert-True ($customerStartSource.Contains('Remove-StaleOwnedScratchRecord')) "Stale customer-service scratch and owner record must be removed together before replacement allocation."
Assert-True ($customerStartSource.Contains('XZDESK_STRICT_OFFLINE_LOCAL = "1"')) "Unified customer-service mode must enable strict offline runtime."
Assert-True ($customerStartSource.Contains('if (-not $UnifiedLocal -and -not $CustomerServiceOnly)')) "Unified modes must not import the customer-service .env file."
Assert-True ($customerOnlySource.Contains('-CustomerServiceOnly')) "The independent customer-service launcher must explicitly omit connector orchestration."
Assert-True ($connectorStartSource.Contains('-Prefix "shopify-connector-unified-"')) "Connector development data must use a fresh owned scratch repository."
Assert-True ($connectorStartSource.Contains('[Guid]::NewGuid()')) "Connector smoke must use random identities rather than a canonical fixed UUID."
Assert-True ($connectorStartSource.Contains('SHOPIFY_APP_API_VERSION = "2026-07"')) "Connector development startup must provide the explicit Admin API version required by the runtime."
Assert-True ($connectorStartSource.Contains('$summary.state -ne "NOT_CONFIGURED"')) "Fresh connector startup must require NOT_CONFIGURED behavior."
Assert-True (-not $connectorStartSource.Contains('shopify-connector-migrate')) "Unified startup must never invoke the migration command."
Assert-True ($connectorStopSource.Contains('ExecutablePath')) "Connector stop must verify its exact executable."
Assert-True (-not $connectorStopSource.Contains('Get-NetTCPConnection')) "Connector stop must never kill by port lookup."
Assert-True ($supportServerSource.Contains('strict offline local runtime: external provider background work is disabled')) "Support server must explicitly disable provider background registration in strict offline mode."
Assert-True ($supportServerSource.Contains('offlinehttp.Guard')) "Support server default clients must use the shared strict-offline HTTP guard."
Assert-True ($mailAPISource.Contains('Transport: offlinehttp.Wrap(transport)')) "Explicit email provider transports must use the shared strict-offline guard."

Write-Output "local-dev-common tests passed"
