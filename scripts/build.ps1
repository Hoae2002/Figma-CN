param(
  [string]$OutputPath = "$PSScriptRoot\..\FigmaCnPatcher.exe",
  [string]$Version = "0.2.3"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$source = Join-Path $root "src\FigmaCnPatcher.ps1"
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$generatedSource = Join-Path ([System.IO.Path]::GetTempPath()) ("FigmaCnPatcher.embedded." + [Guid]::NewGuid().ToString("N") + ".ps1")
$iconFile = Join-Path $root "assets\figma-cn-patcher.ico"

Import-Module ps2exe -ErrorAction Stop
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null

$payloadFiles = @(
  "payload\manifest.json",
  "payload\src\dictionary\zh-CN.js",
  "payload\src\content\localizer-core.js",
  "payload\src\content\content.js"
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
    -title "Figma 客户端汉化补丁" `
    -description "Figma Desktop Chinese patcher" `
    -product "FigmaCnPatcher" `
    -company "tnanren-ux" `
    -version "$Version.0" `
    -iconFile $iconFile `
    -STA `
    -DPIAware
} finally {
  Remove-Item -LiteralPath $generatedSource -Force -ErrorAction SilentlyContinue
}

Write-Host "Built $output v$Version"
