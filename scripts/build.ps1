param(
  [string]$OutputPath = "$PSScriptRoot\..\FigBoost.exe",
  [string]$Version = "0.3.5"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$source = Join-Path $root "src\FigBoost.ps1"
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$generatedSource = Join-Path ([System.IO.Path]::GetTempPath()) ("FigBoost.embedded." + [Guid]::NewGuid().ToString("N") + ".ps1")
$iconFile = Join-Path $root "assets\figboost.ico"

Import-Module ps2exe -ErrorAction Stop
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null

$payloadFiles = @(
  "payload\manifest.json",
  "payload\src\dictionary\zh-CN.js",
  "payload\src\content\localizer-core.js",
  "payload\src\content\content.js",
  "payload\src\main\menu-localizer.js"
)

$embeddedLines = @('$EmbeddedPayloadFiles = @{')
foreach ($relativePath in $payloadFiles) {
  $fullPath = Join-Path $root $relativePath
  $base64 = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($fullPath))
  $embeddedLines += "  `"$relativePath`" = `"$base64`""
}
$embeddedLines += '}'

$sourceText = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
$sourceText = $sourceText.Replace('$EmbeddedPayloadFiles = @{}', ($embeddedLines -join "`r`n"))
[System.IO.File]::WriteAllText($generatedSource, $sourceText, (New-Object System.Text.UTF8Encoding($true)))

try {
  Invoke-ps2exe `
    -inputFile $generatedSource `
    -outputFile $output `
    -title "FigBoost" `
    -description "FigBoost Figma Desktop Chinese patcher" `
    -product "FigBoost" `
    -company "tnanren-ux" `
    -version "$Version.0" `
    -iconFile $iconFile `
    -STA `
    -noConsole `
    -noOutput `
    -DPIAware
} finally {
  Remove-Item -LiteralPath $generatedSource -Force -ErrorAction SilentlyContinue
}

Write-Host "Built $output v$Version"
