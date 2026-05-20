param(
  [string]$OutputPath = "$PSScriptRoot\..\dist\FigmaCnPatcher.exe",
  [string]$Version = "0.2.0"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$source = Join-Path $root "src\FigmaCnPatcher.ps1"
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)

Import-Module ps2exe -ErrorAction Stop
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null

$embedFiles = @{
  ".\payload\manifest.json" = (Join-Path $root "payload\manifest.json")
  ".\payload\src\dictionary\zh-CN.js" = (Join-Path $root "payload\src\dictionary\zh-CN.js")
  ".\payload\src\content\localizer-core.js" = (Join-Path $root "payload\src\content\localizer-core.js")
  ".\payload\src\content\content.js" = (Join-Path $root "payload\src\content\content.js")
}

Invoke-ps2exe `
  -inputFile $source `
  -outputFile $output `
  -embedFiles $embedFiles `
  -title "Figma 客户端汉化补丁" `
  -description "Figma Desktop Chinese patcher" `
  -product "FigmaCnPatcher" `
  -company "tnanren-ux" `
  -version "$Version.0" `
  -STA `
  -DPIAware `
  -winFormsDPIAware

Write-Host "Built $output v$Version"
