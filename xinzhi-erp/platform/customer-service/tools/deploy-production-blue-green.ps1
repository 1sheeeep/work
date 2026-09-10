[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$ServerHost,
    [string]$ServerUser = "ubuntu",
    [string]$SshKeyPath = "$HOME\.ssh\id_ed25519_xzdesk_aws",
    [string]$RemoteRoot = "/opt/xzdesk"
)

$ErrorActionPreference = "Stop"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command exited with code $LASTEXITCODE"
    }
}

$package = Get-Item -LiteralPath $PackagePath
$key = Get-Item -LiteralPath $SshKeyPath
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue) -or -not (Get-Command scp.exe -ErrorAction SilentlyContinue)) {
    throw "Windows OpenSSH client is required"
}
if ($ServerHost -notmatch '^[A-Za-z0-9.-]+$') {
    throw "ServerHost contains unsupported characters"
}
if ($ServerUser -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ServerUser contains unsupported characters"
}
if ($RemoteRoot -notmatch '^/[A-Za-z0-9._/-]+$') {
    throw "RemoteRoot must be an absolute Linux path"
}

$target = "$ServerUser@$ServerHost"
$remotePackage = "/tmp/$($package.Name)"
$sshCommon = @("-i", $key.FullName, "-o", "BatchMode=yes", "-o", "ServerAliveInterval=15")

Invoke-Native -Command "scp.exe" -Arguments ($sshCommon + @($package.FullName, "${target}:$remotePackage"))

$remoteCommand = @"
set -eu
stage=`$(mktemp -d /tmp/xzdesk-release.XXXXXX)
cleanup() { rm -rf -- "`$stage" "$remotePackage"; }
trap cleanup EXIT HUP INT TERM
tar -xzf "$remotePackage" -C "`$stage"
installer="`$stage/deploy-blue-green.sh"
if [ ! -f "`$installer" ]; then
  installer="`$stage/deploy/deploy-blue-green.sh"
fi
test -f "`$installer"
XZDESK_ROOT_DIR="$RemoteRoot" sh "`$installer" install "`$stage"
"@
Invoke-Native -Command "ssh.exe" -Arguments ($sshCommon + @($target, $remoteCommand))
Write-Host "Production deployment completed for $($package.Name)"
