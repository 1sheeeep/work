param(
    [Parameter(Mandatory = $true)][string]$RemoteToolDirectory
)
$ErrorActionPreference = 'Stop'
throw 'Native password recovery is retired. ERP and copied customer service now share the ERP account; do not set a second password.'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run this script with PowerShell 7 (pwsh), not Windows PowerShell 5.' }
# Run personally in a normal PowerShell terminal. Never paste passwords into a
# chat, command argument, transcript, environment file, or reusable JSON file.
if ($RemoteToolDirectory -notmatch '^/opt/xz-erp-customer-service-uat/tools/native-recovery-[0-9TZ-]+$') {
    throw 'Unexpected recovery directory.'
}
$sshArguments = @('-i', (Join-Path $env:USERPROFILE '.ssh/id_ed25519_xzdesk_aws'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'ubuntu@13.215.3.189')
$inspect = & ssh.exe @sshArguments "sudo -n sh '$RemoteToolDirectory/operator.sh' inspect"
if ($LASTEXITCODE -ne 0) { throw 'Read-only account inspection failed.' }
$plan = ($inspect -join "`n") | ConvertFrom-Json
if ($plan.tenantId -ne '7d055c24-3a32-4d28-bac2-b512fa1423b6' -or $plan.accounts.Count -ne 2 -or ($plan.accounts | Where-Object { -not $_.eligible })) {
    throw 'Existing account state changed; ask the release operator to inspect it. No password was changed.'
}
$accounts = @()
foreach ($account in $plan.accounts) {
    Write-Host "Existing account: $($account.displayName) / $($account.userId)"
    $email = Read-Host 'Confirm the new independent login email for this exact account'
    $accounts += @{ userId = $account.userId; email = $email; password = $null }
}
Write-Host 'Account IDs, enterprise, permissions and business data will remain unchanged. Existing sessions for these accounts will be cleared.'
if ((Read-Host 'Type RECOVER TWO ACCOUNTS to confirm the login assignments') -cne 'RECOVER TWO ACCOUNTS') { throw 'Cancelled; nothing changed.' }
$payload = $null
try {
    foreach ($account in $accounts) {
        $first = Read-Host "New password for $($account.email) (12-72 UTF-8 bytes, no surrounding spaces)" -AsSecureString
        $second = Read-Host 'Repeat the new password' -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $first).Password
        $confirmation = [System.Net.NetworkCredential]::new('', $second).Password
        try {
            $byteCount = [System.Text.Encoding]::UTF8.GetByteCount($plain)
            if ($plain -cne $confirmation -or $plain.Trim() -cne $plain -or $byteCount -lt 12 -or $byteCount -gt 72) { throw 'Password confirmation or length is invalid. Nothing was sent.' }
            $account.password = $plain
        } finally { $plain = $null; $confirmation = $null; $first.Dispose(); $second.Dispose() }
    }
    $payload = @{ revision = $plan.revision; snapshotSHA256 = $plan.snapshotSHA256; accounts = $accounts } | ConvertTo-Json -Depth 4 -Compress
    $start = [System.Diagnostics.ProcessStartInfo]::new('ssh.exe')
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
    foreach ($arg in ($sshArguments + @("sudo -n sh '$RemoteToolDirectory/operator.sh' apply"))) { $start.ArgumentList.Add($arg) }
    $process = [System.Diagnostics.Process]::Start($start)
    try {
        $process.StandardInput.Write($payload)
        $process.StandardInput.Close()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw 'Recovery was not confirmed. Keep the cutover paused and inspect state before retrying.' }
    } finally { $process.Dispose() }
} finally {
    $payload = $null
    foreach ($account in $accounts) { $account.password = $null }
}
Write-Host 'Account recovery committed. Tell the release operator to continue the native-login deployment and verify sign-in.'
