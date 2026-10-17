param(
  [string]$OutputPath = "$PSScriptRoot\..\FigBoost.exe",
  [string]$Version = "0.5.33"
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
  "payload\src\main\menu-localizer.js",
  "payload\src\shared\translation-policy.js",
  "payload\src\content\translation-runtime.js",
  "payload\src\main\translation-service.js",
  "payload\src\main\translation-host.js",
  "payload\src\main\translation-settings-preload.js",
  "payload\src\main\translation-settings.html",
  "payload\src\main\translation-settings.css",
  "payload\src\main\translation-settings.js"
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
$buttonSource = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'src\ActionButton.cs')))
$sourceText = $sourceText.Replace('$EmbeddedButtonSource = ""', ('$EmbeddedButtonSource = "' + $buttonSource + '"'))
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

# Publish the exact build and payload together; the updater pins downloads to one Git commit.
$updateDir = Join-Path $root "updates"
New-Item -ItemType Directory -Force -Path $updateDir | Out-Null
$payloadMap = [ordered]@{}
foreach ($relativePath in $payloadFiles) {
  $payloadMap[$relativePath] = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root $relativePath)))
}
$payloadVersion = (Get-Content -LiteralPath (Join-Path $root 'payload\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$bundle = [ordered]@{ schema = 1; version = $payloadVersion; minPatcherVersion = '0.5.28'; files = $payloadMap }
$bundlePath = Join-Path $updateDir 'payload.json'
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($bundlePath, ($bundle | ConvertTo-Json -Depth 5 -Compress), $utf8)
$latest = [ordered]@{
  schema = 1
  client = [ordered]@{ version = $Version; size = (Get-Item -LiteralPath $output).Length; sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() }
  payload = [ordered]@{ version = $payloadVersion; minPatcherVersion = $bundle.minPatcherVersion; size = (Get-Item -LiteralPath $bundlePath).Length; sha256 = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant() }
}
[IO.File]::WriteAllText((Join-Path $updateDir 'latest.json'), ($latest | ConvertTo-Json -Depth 4) + "`n", $utf8)
Write-Host "Prepared updates/latest.json and updates/payload.json"
