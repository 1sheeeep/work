Set-StrictMode -Version Latest

function Clear-UnifiedLocalProviderEnvironment {
    $providerPattern = '(^|_)(SHOPIFY|AI|OUTLOOK|GMAIL|EMAIL|MICROSOFT|GOOGLE|FASTMO|OPENAI|DEEPSEEK|ANTHROPIC|SMTP|IMAP|AZURE|CUIQIU|SEVENTEENTRACK)($|_)'
    foreach ($key in @([Environment]::GetEnvironmentVariables("Process").Keys)) {
        $name = [string]$key
        if ($name -match $providerPattern -or $name -in @("DATABASE_URL", "PUBLIC_BASE_URL")) {
            [Environment]::SetEnvironmentVariable($name, "", "Process")
        }
    }
}

function Assert-SafeRuntimeAncestors {
    param([Parameter(Mandatory = $true)][string]$RuntimeDirectory)

    $runtime = [System.IO.Path]::GetFullPath($RuntimeDirectory).TrimEnd("\")
    $current = $runtime
    while (-not (Test-Path -LiteralPath $current)) {
        $parent = [System.IO.Directory]::GetParent($current)
        if ($null -eq $parent) {
            throw "Scratch runtime path has no existing owned ancestor: $runtime"
        }
        $current = $parent.FullName
    }
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (-not $item.PSIsContainer) {
            throw "Scratch runtime ancestor is not a directory: $current"
        }
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Scratch runtime path contains a junction or reparse point: $current"
        }
        $normalizedItem = [System.IO.Path]::GetFullPath($item.FullName)
        if (-not $normalizedItem.Equals([System.IO.Path]::GetPathRoot($normalizedItem), [System.StringComparison]::OrdinalIgnoreCase)) {
            $normalizedItem = $normalizedItem.TrimEnd("\")
        }
        if (-not $normalizedItem.Equals($current, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Scratch runtime ancestor resolved outside its expected path: $current"
        }
        $parent = [System.IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = [System.IO.Path]::GetFullPath($parent.FullName)
        if (-not $current.Equals([System.IO.Path]::GetPathRoot($current), [System.StringComparison]::OrdinalIgnoreCase)) {
            $current = $current.TrimEnd("\")
        }
    }
    return $runtime
}

function Assert-SafeRuntimeDirectory {
    param([Parameter(Mandatory = $true)][string]$RuntimeDirectory)

    $runtime = Assert-SafeRuntimeAncestors -RuntimeDirectory $RuntimeDirectory
    if (-not (Test-Path -LiteralPath $runtime -PathType Container)) {
        throw "Scratch runtime directory does not exist: $runtime"
    }
    return $runtime
}

function New-IsolatedLocalStatePath {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeDirectory,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Extension
    )

    if ($Prefix -notmatch '^[a-z0-9-]+-$' -or $Extension -notmatch '^\.[a-z0-9]+$') {
        throw "Scratch state prefix or extension is invalid."
    }
    $runtime = Assert-SafeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
    $ownerId = [Guid]::NewGuid().ToString("N")
    $path = [System.IO.Path]::GetFullPath((Join-Path $runtime "$Prefix$ownerId$Extension"))
    if (-not [System.IO.Path]::GetDirectoryName($path).Equals($runtime, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Scratch state path escaped the runtime directory."
    }
    if (Test-Path -LiteralPath $path) {
        throw "Fresh scratch state path already exists; refusing to reuse it."
    }
    return $path
}

function Assert-OwnedScratchPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RuntimeDirectory,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Extension
    )

    $runtime = Assert-SafeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $expectedName = '^' + [regex]::Escape($Prefix) + '[0-9a-f]{32}' + [regex]::Escape($Extension) + '$'
    if (-not [System.IO.Path]::GetDirectoryName($fullPath).Equals($runtime, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($fullPath) -notmatch $expectedName) {
        throw "Scratch state owner record is outside the expected runtime namespace."
    }
    return $fullPath
}

function Remove-OwnedScratchArtifacts {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RuntimeDirectory,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Extension,
        [switch]$IncludeTenantDirectory,
        [switch]$IncludeLockFile
    )

    $fullPath = Assert-OwnedScratchPath -Path $Path -RuntimeDirectory $RuntimeDirectory -Prefix $Prefix -Extension $Extension
    $targets = @($fullPath)
    if ($IncludeLockFile) { $targets += "$fullPath.lock" }
    if ($IncludeTenantDirectory) { $targets += "$fullPath.tenants" }

    foreach ($target in $targets) {
        [void](Assert-SafeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory)
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Scratch cleanup refused a reparse point: $target"
        }
        if ($item.PSIsContainer) {
            $reparse = @(Get-ChildItem -LiteralPath $target -Force -Recurse -ErrorAction Stop | Where-Object {
                ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
            })
            if ($reparse.Count -gt 0) {
                throw "Scratch cleanup refused a directory containing a reparse point: $target"
            }
            Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
        } else {
            Remove-Item -LiteralPath $target -Force -ErrorAction Stop
        }
    }
}

function Remove-StaleOwnedScratchRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RuntimeDirectory,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Extension,
        [Parameter(Mandatory = $true)][string]$OwnerRecordPath,
        [Parameter(Mandatory = $true)][string]$ExpectedOwnerRecordName,
        [switch]$IncludeTenantDirectory,
        [switch]$IncludeLockFile
    )

    $runtime = Assert-SafeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
    $recordPath = [System.IO.Path]::GetFullPath($OwnerRecordPath)
    if (-not [System.IO.Path]::GetDirectoryName($recordPath).Equals($runtime, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not [System.IO.Path]::GetFileName($recordPath).Equals($ExpectedOwnerRecordName, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Stale scratch owner record is outside the expected runtime namespace."
    }
    $record = Get-Item -LiteralPath $recordPath -Force -ErrorAction Stop
    if ($record.PSIsContainer -or ($record.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Stale scratch owner record is not a regular file."
    }

    Remove-OwnedScratchArtifacts `
        -Path $Path `
        -RuntimeDirectory $runtime `
        -Prefix $Prefix `
        -Extension $Extension `
        -IncludeTenantDirectory:$IncludeTenantDirectory `
        -IncludeLockFile:$IncludeLockFile

    [void](Assert-SafeRuntimeDirectory -RuntimeDirectory $runtime)
    $record = Get-Item -LiteralPath $recordPath -Force -ErrorAction Stop
    if ($record.PSIsContainer -or ($record.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Stale scratch owner record changed before cleanup."
    }
    Remove-Item -LiteralPath $recordPath -Force -ErrorAction Stop
}
