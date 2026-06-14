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
if ($content -notmatch "right:234px;top:0") {
  throw "Update button titlebar placement must sit on the native titlebar button grid."
}
if ($content -notmatch "SHOULD_INSTALL_UPDATE_BUTTON = IS_TEST_PAGE \|\| \(IS_TITLEBAR_PAGE && !IS_FIGMA_PAGE\)") {
  throw "Update button must not install inside figma.com content pages."
}
if ($content -notmatch "width:32px;height:37px;background:#383838") {
  throw "Update button visual hit area must match the native titlebar hover cell."
}
if ($content -notmatch "min-width:0;min-height:0") {
  throw "Update button must neutralize inherited button minimum sizes."
}
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\{width:32px;height:37px;background:#383838;border-left:1px solid #4c4c4c;\}") {
  throw "Update button titlebar placement must keep the native divider from the button on its left."
}
if ($content -notmatch "border-radius:0") {
  throw "Update button hover radius must match the native titlebar ghost style."
}
if ($content -notmatch "background:#424242") {
  throw "Update button hover state must match the native titlebar ghost style."
}
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button:hover,\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button:active,\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\[aria-pressed='true'\]\{background:#424242!important;color:#d6d6d6!important;\}") {
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
if ($content -notmatch "\.figboost-menu-button\[aria-pressed='true'\]") {
  throw "Update button selected state must persist after pointer hover ends."
}
if ($content -notmatch "if \(host\.placement === `"titlebar`"\)") {
  throw "Update button titlebar placement must not open a clipped dropdown menu."
}
if ($content -notmatch "await FIGBOOST_MENU_ITEMS\[0\]\.run\(\);") {
  throw "Update button titlebar click must run the update check directly."
}
if ($content -notmatch "let titlebarUpdateBusy = false;" -or $content -match "button\.disabled = true") {
  throw "Update button titlebar busy state must not trigger disabled browser styles."
}
if ($content -notmatch "svg\{width:12px;height:12px") {
  throw "Update button icon must match the compact native titlebar icon size."
}

$core = Get-Content -LiteralPath (Join-Path $root "payload\src\content\localizer-core.js") -Raw
if ($core -notmatch "MAX_TRANSLATION_CACHE_SIZE") {
  throw "Translation cache must have a bounded size."
}
if ($core -notmatch "cache\.delete\(cache\.keys\(\)\.next\(\)\.value\)") {
  throw "Translation cache must evict the oldest entry at the size limit."
}

Write-Host "All tests passed."
