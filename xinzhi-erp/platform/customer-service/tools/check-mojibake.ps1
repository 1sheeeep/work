$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$paths = @(
    (Join-Path $root "frontend\src"),
    (Join-Path $root "internal"),
    (Join-Path $root "sidecar"),
    (Join-Path $root "packaging"),
    (Join-Path $root "tools"),
    (Join-Path $root "README.md"),
    (Join-Path $root "RUNTIME_SAFETY.md"),
    (Join-Path $root "app.go"),
    (Join-Path $root "main.go")
)

# Common mojibake lead characters seen when UTF-8 Chinese text is read or saved
# through the wrong Windows code page. Keep this file ASCII-only so PowerShell 5
# can parse it before any encoding setup.
$patternCodes = @(
    0x935A, # U+935A
    0x9422, # U+9422
    0x95C1, # U+95C1
    0x7AD4, # U+7AD4
    0x7487, # U+7487
    0x6434, # U+6434
    0x6D7C, # U+6D7C
    0x951B, # U+951B
    0xFFFD  # replacement character
)
$patterns = $patternCodes | ForEach-Object { [char]$_ }

$hits = @()
foreach ($path in $paths) {
    if (Test-Path $path -PathType Container) {
        $files = Get-ChildItem -Path $path -Recurse -File -Include *.go,*.ts,*.tsx,*.css,*.json,*.js,*.mjs,*.md,*.ps1,*.iss |
            Where-Object { $_.FullName -notmatch '\\(node_modules|dist|build|release|qa-screens\d*)\\' }
    } elseif (Test-Path $path -PathType Leaf) {
        $files = @(Get-Item $path)
    } else {
        $files = @()
    }
    foreach ($file in $files) {
        $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        foreach ($pattern in $patterns) {
            if ($text.Contains($pattern)) {
                $hits += [PSCustomObject]@{ File = $file.FullName; CodePoint = ("U+{0:X4}" -f [int][char]$pattern) }
            }
        }
    }
}

if ($hits.Count -gt 0) {
    Write-Host "Mojibake check failed:" -ForegroundColor Red
    $hits | Sort-Object File, CodePoint | Format-Table -AutoSize
    exit 1
}

Write-Host "Mojibake check passed."
