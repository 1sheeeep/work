param(
    [switch]$ClearWebViewCache
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$devExe = Join-Path $projectRoot "build\bin\XzdeskAgent-dev.exe"
$frontendRootPattern = [regex]::Escape((Join-Path $projectRoot "frontend"))
$projectRootPattern = [regex]::Escape($projectRoot)

$targets = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ne "powershell.exe" -and (
        $_.ExecutablePath -eq $devExe -or
        ($_.Name -eq "wails.exe" -and $_.CommandLine -match "\sdev(\s|$)") -or
        ($_.Name -eq "node.exe" -and $_.CommandLine -match $frontendRootPattern -and $_.CommandLine -match "vite") -or
        ($_.Name -eq "esbuild.exe" -and $_.ExecutablePath -match $projectRootPattern) -or
        ($_.Name -eq "msedgewebview2.exe" -and $_.CommandLine -match "XzdeskAgent-dev\.exe")
    )
}

foreach ($process in $targets) {
    try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Host ("Stopped {0} ({1})" -f $process.Name, $process.ProcessId)
    } catch {
        Write-Host ("Warning: failed to stop {0} ({1}): {2}" -f $process.Name, $process.ProcessId, $_.Exception.Message)
    }
}

if ($targets.Count -gt 0) {
    Start-Sleep -Seconds 2
}

if ($ClearWebViewCache) {
    foreach ($cacheRootName in @("XzdeskAgent-dev.exe")) {
        $cacheRoot = Join-Path $env:APPDATA $cacheRootName
        $cachePath = Join-Path $cacheRoot "EBWebView"
        if (Test-Path -LiteralPath $cachePath) {
            $resolvedCache = (Resolve-Path -LiteralPath $cachePath).Path
            $resolvedRoot = (Resolve-Path -LiteralPath $cacheRoot).Path
            if (-not $resolvedCache.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to remove unexpected WebView cache path: $resolvedCache"
            }
            try {
                Remove-Item -LiteralPath $resolvedCache -Recurse -Force -ErrorAction Stop
                Write-Host "Cleared WebView cache: $resolvedCache"
            } catch [System.IO.FileNotFoundException] {
                Write-Host "WebView cache was already removed: $resolvedCache"
            } catch [System.Management.Automation.ItemNotFoundException] {
                Write-Host "WebView cache was already removed: $resolvedCache"
            } catch {
                Write-Host "Warning: failed to fully clear WebView cache: $($_.Exception.Message)"
            }
        }
    }
}

