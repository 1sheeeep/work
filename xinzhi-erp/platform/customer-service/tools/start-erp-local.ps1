$ErrorActionPreference = "Stop"

$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startPlatformDev = Join-Path $toolsDir "start-platform-dev.ps1"

# This wrapper starts only the imported repository copy and uses a synthetic
# local workload credential when the parent ERP launcher did not provide one.
$env:XZDESK_ALLOWED_ORIGINS = "http://127.0.0.1:18888"
$env:XZDESK_ERP_IAM_BASE_URL = "http://127.0.0.1:8080"
$env:XZDESK_PUBLIC_ORIGIN = "http://127.0.0.1:8787"
$env:XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL = ""
$env:XZDESK_LOCAL_DEMO = "1"
$env:SUPPORT_PLATFORM_ADDR = "127.0.0.1:8787"
if (-not $env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN -and -not $env:XZ_ERP_CONNECTOR_TOKEN) {
    $env:ERP_XZ_ERP_APP_CONNECTOR_TOKEN = "xz-erp-local-customer-service-workload"
}

& $startPlatformDev -ERPIntegration -CustomerServiceOnly
