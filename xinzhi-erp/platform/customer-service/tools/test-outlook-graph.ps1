param(
  [Parameter(Mandatory = $true)]
  [string]$ClientId,

  [string]$Tenant = "common",

  [string]$RedirectUri = "http://localhost:8400/",

  [string]$ProxyUrl = "",

  [int]$Top = 5
)

$ErrorActionPreference = "Stop"

function New-Base64Url([byte[]]$Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-PkceVerifier {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return New-Base64Url $bytes
}

function New-PkceChallenge([string]$Verifier) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Verifier)
  return New-Base64Url ($sha.ComputeHash($bytes))
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers = @{},
    $Body = $null,
    [string]$ContentType = ""
  )

  $args = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
  }
  if ($null -ne $Body) { $args.Body = $Body }
  if ($ContentType) { $args.ContentType = $ContentType }
  if ($ProxyUrl) { $args.Proxy = $ProxyUrl }

  return Invoke-RestMethod @args
}

$scope = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send"
$verifier = New-PkceVerifier
$challenge = New-PkceChallenge $verifier

$authParams = @{
  client_id = $ClientId
  response_type = "code"
  redirect_uri = $RedirectUri
  response_mode = "query"
  scope = $scope
  prompt = "select_account"
  code_challenge = $challenge
  code_challenge_method = "S256"
}

$authQuery = ($authParams.GetEnumerator() | ForEach-Object {
  "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString([string]$_.Value)
}) -join "&"

$authUrl = "https://login.microsoftonline.com/$Tenant/oauth2/v2.0/authorize?$authQuery"

Write-Host ""
Write-Host "1) Open this URL in the browser already signed in to the matching account:" -ForegroundColor Cyan
Write-Host $authUrl
Write-Host ""
try {
  Set-Clipboard -Value $authUrl
  Write-Host "The authorization URL was copied to your clipboard." -ForegroundColor Green
} catch {
  Write-Host "Could not copy URL to clipboard. Copy it manually from above." -ForegroundColor Yellow
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($RedirectUri)
$listener.Start()

Write-Host ""
Write-Host "2) Waiting for Microsoft to redirect back to $RedirectUri ..." -ForegroundColor Cyan
Write-Host "If Microsoft shows AADSTS50011, add this Redirect URI to the app registration: $RedirectUri" -ForegroundColor Yellow

$context = $listener.GetContext()
$requestUrl = $context.Request.Url
$query = [System.Web.HttpUtility]::ParseQueryString($requestUrl.Query)
$code = $query["code"]
$errorCode = $query["error"]
$errorDescription = $query["error_description"]

$responseHtml = "<html><body><h2>Outlook authorization received.</h2><p>You can close this tab and return to Codex.</p></body></html>"
$buffer = [System.Text.Encoding]::UTF8.GetBytes($responseHtml)
$context.Response.ContentType = "text/html; charset=utf-8"
$context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
$context.Response.Close()
$listener.Stop()

if ($errorCode) {
  throw "Authorization failed: $errorCode $errorDescription"
}
if (-not $code) {
  throw "No authorization code was returned."
}

Write-Host "Authorization code captured." -ForegroundColor Green

if ($ProxyUrl) {
  Write-Host ""
  Write-Host "3) Checking outbound IP through proxy..." -ForegroundColor Cyan
  $ip = Invoke-JsonRequest -Method "GET" -Uri "https://api.ipify.org?format=json"
  Write-Host ("Outbound IP: " + $ip.ip) -ForegroundColor Green
}

Write-Host ""
Write-Host "4) Exchanging code for token..." -ForegroundColor Cyan
$tokenBody = @{
  client_id = $ClientId
  scope = $scope
  code = $code
  redirect_uri = $RedirectUri
  grant_type = "authorization_code"
  code_verifier = $verifier
}

$token = Invoke-JsonRequest `
  -Method "POST" `
  -Uri "https://login.microsoftonline.com/$Tenant/oauth2/v2.0/token" `
  -Body $tokenBody `
  -ContentType "application/x-www-form-urlencoded"

Write-Host "Token exchange succeeded." -ForegroundColor Green
Write-Host ("Access token expires in seconds: " + $token.expires_in)
if ($token.refresh_token) {
  Write-Host "Refresh token returned: yes" -ForegroundColor Green
} else {
  Write-Host "Refresh token returned: no" -ForegroundColor Yellow
}

$headers = @{ Authorization = "Bearer $($token.access_token)" }

Write-Host ""
Write-Host "5) Calling Microsoft Graph /me..." -ForegroundColor Cyan
$me = Invoke-JsonRequest -Method "GET" -Uri "https://graph.microsoft.com/v1.0/me" -Headers $headers
Write-Host ("Signed in user: {0} <{1}>" -f $me.displayName, $me.userPrincipalName) -ForegroundColor Green

Write-Host ""
Write-Host "6) Reading latest messages..." -ForegroundColor Cyan
$messagesUri = "https://graph.microsoft.com/v1.0/me/messages?`$top=$Top&`$select=id,receivedDateTime,from,subject,isRead"
$messages = Invoke-JsonRequest -Method "GET" -Uri $messagesUri -Headers $headers

foreach ($msg in $messages.value) {
  $from = ""
  if ($msg.from -and $msg.from.emailAddress) { $from = $msg.from.emailAddress.address }
  Write-Host ("- [{0}] {1} | {2} | {3}" -f $msg.receivedDateTime, $from, $msg.isRead, $msg.subject)
}

Write-Host ""
Write-Host "Outlook Graph API test completed." -ForegroundColor Green
Write-Host "Do not paste access_token or refresh_token into chat." -ForegroundColor Yellow
