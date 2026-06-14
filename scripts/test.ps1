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
$tabSelectorIndex = $content.IndexOf("[class*='tab_bar']")
if ($tabSelectorIndex -lt 0) {
  throw "Update button must look for the tab bar host."
}
$titlebarHostIndex = $content.IndexOf('if (IS_TITLEBAR_PAGE && document.body) return { element: document.body, placement: "titlebar" };')
if ($titlebarHostIndex -lt 0 -or $titlebarHostIndex -gt $tabSelectorIndex) {
  throw "Update button titlebar placement must take precedence over in-page tab hosts."
}
if ($content.Contains("[class*='top_bar']")) {
  throw "Update button must not fall back to the in-file top bar."
}
if ($content -notmatch "data-placement='tab'") {
  throw "Update button must include the tab bar placement style."
}
if ($content -notmatch "data-placement='titlebar'") {
  throw "Update button must include the titlebar fallback placement style."
}
if ($content -notmatch "right:250px;top:0;border-left:solid 1px var\(--color-bordertranslucent\)") {
  throw "Update button titlebar placement must sit on the native titlebar button grid."
}
if ($content -notmatch "SHOULD_INSTALL_UPDATE_BUTTON = IS_TEST_PAGE \|\| \(IS_TITLEBAR_PAGE && !IS_FIGMA_PAGE\)") {
  throw "Update button must not install inside figma.com content pages."
}
if ($content -notmatch "width:50px;height:38px") {
  throw "Update button visual hit area must match the native titlebar caption button."
}
if ($content -notmatch "min-width:0;min-height:0") {
  throw "Update button must neutralize inherited button minimum sizes."
}
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\{background-color:unset;display:flex;align-items:center;justify-content:center;width:50px;height:38px;-webkit-app-region:no-drag;color:var\(--color-text-secondary\);fill:var\(--color-text-secondary\);--fpl-icon-color:var\(--color-text-secondary\);pointer-events:bounding-box;\}") {
  throw "Update button titlebar placement must reuse the native caption button style."
}
if ($content -notmatch "border-radius:0") {
  throw "Update button hover radius must match the native titlebar ghost style."
}
if ($content -notmatch "background-color:var\(--color-bghovertransparent\)!important") {
  throw "Update button hover state must match the native titlebar caption button style."
}
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button:active,\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\[aria-pressed='true'\]\{background-color:var\(--color-bgtransparent-secondary-hover\)!important;color:var\(--color-text\)!important;fill:var\(--color-text\)!important;--fpl-icon-color:var\(--color-text\)!important;\}") {
  throw "Update button titlebar states must override native/global button styles."
}
if ($content -notmatch "appearance:none;-webkit-appearance:none;outline:0;box-shadow:none;transform:none;-webkit-app-region:no-drag") {
  throw "Update button must use native titlebar button interaction behavior."
}
if ($content -notmatch "\.figboost-menu-button:active\{background:#424242;color:#d6d6d6;box-shadow:none;transform:none;\}") {
  throw "Update button active state must match the native titlebar hover state."
}
if ($content -notmatch "\.figboost-menu-button:focus-visible\{outline:1px solid #6a6a6a;outline-offset:-1px;\}") {
  throw "Update button focus-visible state must avoid the browser default blue outline."
}
if ($content -match 'button\.setAttribute\("aria-pressed", "true"\)') {
  throw "Update button titlebar click must not leave a persistent selected highlight."
}
if ($content -notmatch "if \(host\.placement === `"titlebar`"\)") {
  throw "Update button titlebar placement must not open a clipped dropdown menu."
}
if ($content -notmatch "await FIGBOOST_MENU_ITEMS\[0\]\.run\(\);") {
  throw "Update button titlebar click must run the update check directly."
}
if ($content -notmatch "let titlebarUpdateBusy = false;" -or $content -match "button\.disabled = true" -or $content -notmatch 'button\.setAttribute\("aria-pressed", "false"\);') {
  throw "Update button titlebar busy state must not trigger disabled browser styles."
}
if ($content -notmatch "svg\{width:14px;height:14px" -or $content -notmatch 'stroke-width="1\.1"') {
  throw "Update button icon must be slightly larger with a lighter stroke."
}

$core = Get-Content -LiteralPath (Join-Path $root "payload\src\content\localizer-core.js") -Raw
if ($core -notmatch "MAX_TRANSLATION_CACHE_SIZE") {
  throw "Translation cache must have a bounded size."
}
if ($core -notmatch "cache\.delete\(cache\.keys\(\)\.next\(\)\.value\)") {
  throw "Translation cache must evict the oldest entry at the size limit."
}

Write-Host "All tests passed."
