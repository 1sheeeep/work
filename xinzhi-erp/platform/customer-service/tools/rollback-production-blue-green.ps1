[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ServerHost,
    [string]$ServerUser = "ubuntu",
    [string]$SshKeyPath = "$HOME\.ssh\id_ed25519_xzdesk_aws",
    [string]$RemoteRoot = "/opt/xzdesk"
)

$ErrorActionPreference = "Stop"
$key = Get-Item -LiteralPath $SshKeyPath
$target = "$ServerUser@$ServerHost"
& ssh.exe -i $key.FullName -o BatchMode=yes -o ServerAliveInterval=15 $target "XZDESK_ROOT_DIR='$RemoteRoot' sh '$RemoteRoot/deploy/deploy-blue-green.sh' rollback"
if ($LASTEXITCODE -ne 0) {
    throw "Production rollback failed with code $LASTEXITCODE"
}
Write-Host "Production rollback completed"
