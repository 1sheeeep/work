param(
    [string]$Addr = "127.0.0.1:18787",
    [switch]$StartPostgres
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$serverExe = Join-Path $runtimeDir "support-server-smoke.exe"
$serverLog = Join-Path $runtimeDir "support-server-smoke.log"
$serverErr = Join-Path $runtimeDir "support-server-smoke.err.log"
$envFile = Join-Path $root ".env"
$composeFile = Join-Path $root "deploy\docker-compose.yml"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

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

function Invoke-Json {
    param(
        [string]$Method,
        [string]$Url,
        [object]$Body,
        [string]$Token
    )
    $headers = @{}
    if ($Token) {
        $headers["Authorization"] = "Bearer $Token"
    }
    if ($null -eq $Body) {
        return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers
    }
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 8)
}

function Wait-ForHealth {
    param([string]$BaseUrl)
    $deadline = (Get-Date).AddSeconds(25)
    do {
        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/healthz" -Method Get
            if ($health.ok) {
                return $health
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "support server did not become healthy at $BaseUrl"
}

function Start-SmokeServer {
    Push-Location $root
    try {
        go build -o $serverExe .\cmd\support-server
    } finally {
        Pop-Location
    }
    return Start-Process -FilePath $serverExe `
        -ArgumentList @("-addr", $Addr) `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $serverLog `
        -RedirectStandardError $serverErr `
        -PassThru
}

function Stop-SmokeServer {
    param($Process)
    if ($Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
}

Import-DotEnv -Path $envFile

if ($StartPostgres) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker is not available, cannot start development PostgreSQL."
    }
    Push-Location $root
    try {
        docker compose -f $composeFile up -d | Write-Host
    } finally {
        Pop-Location
    }
}

if (-not $env:DATABASE_URL) {
    throw "DATABASE_URL is required for persistence smoke. Create .env from .env.example or set DATABASE_URL before running this script."
}

$baseUrl = "http://$Addr"
$adminEmail = if ($env:SUPPORT_PLATFORM_SMOKE_EMAIL) { $env:SUPPORT_PLATFORM_SMOKE_EMAIL } else { "smoke-owner@example.com" }
$adminPassword = if ($env:SUPPORT_PLATFORM_SMOKE_PASSWORD) { $env:SUPPORT_PLATFORM_SMOKE_PASSWORD } else { "password-123" }
$server = $null

try {
    $server = Start-SmokeServer
    $health = Wait-ForHealth -BaseUrl $baseUrl
    if ($health.storage.name -ne "postgres") {
        throw "expected postgres storage, got $($health.storage.name)"
    }

    $status = Invoke-Json -Method Get -Url "$baseUrl/api/v1/bootstrap/status"
    if ($status.needsBootstrap) {
        $auth = Invoke-Json -Method Post -Url "$baseUrl/api/v1/bootstrap/admin" -Body @{
            email = $adminEmail
            displayName = "Smoke Owner"
            password = $adminPassword
        }
    } else {
        try {
            $auth = Invoke-Json -Method Post -Url "$baseUrl/api/v1/auth/login" -Body @{
                email = $adminEmail
                password = $adminPassword
            }
        } catch {
            throw "database already has users, but smoke admin login failed. Set SUPPORT_PLATFORM_SMOKE_EMAIL and SUPPORT_PLATFORM_SMOKE_PASSWORD to an existing admin, or use a fresh development database."
        }
    }

    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $shop = Invoke-Json -Method Post -Url "$baseUrl/api/v1/shops" -Token $auth.token -Body @{
        displayName = "Smoke Shop $stamp"
        platform = "shopify"
        externalId = "smoke-$stamp"
    }
    $source = Invoke-Json -Method Post -Url "$baseUrl/api/v1/shops/$($shop.id)/sources" -Token $auth.token -Body @{
        type = "shopify_chat"
        provider = "shopify"
        address = "smoke-$stamp.myshopify.com"
    }
    $conversation = Invoke-Json -Method Post -Url "$baseUrl/api/v1/conversations" -Token $auth.token -Body @{
        shopId = $shop.id
        sourceId = $source.id
        customerName = "Smoke Customer"
        customerEmail = "smoke-$stamp@example.com"
        subject = "Persistence smoke"
    }
    $body = "Stored across restart $stamp"
    $null = Invoke-Json -Method Post -Url "$baseUrl/api/v1/conversations/$($conversation.id)/messages" -Token $auth.token -Body @{
        direction = "customer"
        body = $body
        senderName = "Smoke Customer"
    }

    Stop-SmokeServer -Process $server
    $server = Start-SmokeServer
    $health = Wait-ForHealth -BaseUrl $baseUrl
    if ($health.storage.name -ne "postgres") {
        throw "expected postgres storage after restart, got $($health.storage.name)"
    }

    $auth = Invoke-Json -Method Post -Url "$baseUrl/api/v1/auth/login" -Body @{
        email = $adminEmail
        password = $adminPassword
    }
    $shops = Invoke-Json -Method Get -Url "$baseUrl/api/v1/shops" -Token $auth.token
    $foundShop = @($shops | Where-Object { $_.id -eq $shop.id })
    if ($foundShop.Count -ne 1) {
        throw "created shop was not found after restart: $($shop.id)"
    }
    $conversations = Invoke-Json -Method Get -Url "$baseUrl/api/v1/conversations?shopId=$($shop.id)" -Token $auth.token
    $foundConversation = @($conversations | Where-Object { $_.id -eq $conversation.id })
    if ($foundConversation.Count -ne 1) {
        throw "created conversation was not found after restart: $($conversation.id)"
    }
    $messages = Invoke-Json -Method Get -Url "$baseUrl/api/v1/conversations/$($conversation.id)/messages" -Token $auth.token
    $foundMessage = @($messages | Where-Object { $_.body -eq $body })
    if ($foundMessage.Count -ne 1) {
        throw "created message was not found after restart"
    }

    Write-Host "Persistence smoke passed."
    Write-Host "Storage: postgres"
    Write-Host "Shop: $($shop.displayName) <$($shop.id)>"
    Write-Host "Conversation: $($conversation.id)"
} finally {
    Stop-SmokeServer -Process $server
}
