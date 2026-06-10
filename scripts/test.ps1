param()

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")

$jsFiles = @(
  "payload\src\dictionary\zh-CN.js",
  "payload\src\content\localizer-core.js",
  "payload\src\content\content.js",
  "payload\src\main\menu-localizer.js"
)

foreach ($relativePath in $jsFiles) {
  node --check (Join-Path $root $relativePath) | Out-Null
}

$content = Get-Content -LiteralPath (Join-Path $root "payload\src\content\content.js") -Raw
if ($content -notmatch "if \(!isFigBoostUpdateButtonEnabled\(\)\) return;") {
  throw "Update button observer must not start when the feature is disabled."
}
if ($content -notmatch "observer\.disconnect\(\);") {
  throw "Update button observer must disconnect after the menu is installed."
}

$core = Get-Content -LiteralPath (Join-Path $root "payload\src\content\localizer-core.js") -Raw
if ($core -notmatch "MAX_TRANSLATION_CACHE_SIZE") {
  throw "Translation cache must have a bounded size."
}
if ($core -notmatch "cache\.delete\(cache\.keys\(\)\.next\(\)\.value\)") {
  throw "Translation cache must evict the oldest entry at the size limit."
}

Write-Host "All tests passed."
