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
if ($content -notmatch "right:250px;top:0;border-left:solid 1px var\(--color-bordertranslucent\);border-right:solid 1px var\(--color-bordertranslucent\)") {
  throw "Update button titlebar placement must sit on the native titlebar button grid."
}
if ($content -notmatch "data-overlapped='true'\]\{visibility:hidden;pointer-events:none;\}" -or $content -notmatch "function syncTitlebarButtonVisibility\(wrap\)" -or $content -notmatch "document\.elementsFromPoint" -or $content -notmatch "window\.addEventListener\(`"resize`", schedule\);") {
  throw "Update button titlebar placement must hide when it overlaps native controls."
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
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\{background-color:unset;display:flex;align-items:center;justify-content:center;width:50px;height:38px;-webkit-app-region:no-drag;color:var\(--color-text-secondary\);fill:var\(--color-text-secondary\);--fpl-icon-color:var\(--color-text-secondary\);pointer-events:bounding-box;cursor:default;\}") {
  throw "Update button titlebar placement must reuse the native caption button style."
}
if ($content -notmatch "border-radius:0") {
  throw "Update button hover radius must match the native titlebar ghost style."
}
if ($content -notmatch "data-hover-suppressed='true'" -or $content -notmatch "background-color:var\(--color-bghovertransparent\)!important") {
  throw "Update button hover state must match the native titlebar caption button style."
}
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button:active,\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\[aria-expanded='true'\],\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-button\[aria-pressed='true'\]\{background-color:var\(--color-bgtransparent-secondary-hover\)!important;color:var\(--color-text\)!important;fill:var\(--color-text\)!important;--fpl-icon-color:var\(--color-text\)!important;\}") {
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
if ($content -notmatch "resetFigBoostButtonState\(button\)" -or $content -notmatch 'button\.blur\(\)' -or $content -notmatch 'figboost:feature-menu-closed' -or $content -notmatch "suppressFigBoostButtonHover\(button\)" -or $content -notmatch "wrap\.dataset\.hoverSuppressed = `"true`"" -or $content -notmatch 'document\.addEventListener\("pointermove", release, true\)') {
  throw "Update button titlebar menu close must clear the button ghost state."
}
if ($content -notmatch "getFigBoostFeatureMenuBridge\(\)" -or $content -notmatch "getFigBoostMenuBounds\(button\)" -or $content -notmatch "bridge\(bounds\)" -or $content -notmatch "figboost://open-feature-menu") {
  throw "Update button titlebar placement must open the native feature menu bridge with button bounds."
}
if ($content -match "await bridge\(getFigBoostMenuBounds\(button\)\)") {
  throw "Update button titlebar click must not wait for the native menu to close."
}
if ($content -match "setTimeout\(\(\) => \{\s*resetFigBoostButtonState\(button\);") {
  throw "Update button titlebar click must keep the pressed state until the native menu closes."
}
if ($content -notmatch "toggleFigBoostMenu\(wrap\);") {
  throw "Update button click must fall back to the shared DOM feature menu."
}
if ($content -match "titlebarUpdateBusy" -or $content -match "await FIGBOOST_MENU_ITEMS\[0\]\.run\(\);" -or $content -match "button\.disabled = true") {
  throw "Update button titlebar click must not bypass the feature menu or trigger disabled browser styles."
}
if ($content -notmatch "\.figboost-menu-wrap\[data-placement='titlebar'\] \.figboost-menu-panel\{top:44px;right:0;min-width:168px;padding:6px 0;border:1px solid rgba\(255,255,255,\.08\);border-radius:10px;background:#252525;color:#f1f1f1;box-shadow:0 10px 28px rgba\(0,0,0,\.35\);\}") {
  throw "Update button titlebar menu must use a dark feature selection popup."
}
if ($content -notmatch "svg\{width:14px;height:14px" -or $content -notmatch 'stroke-width="0\.9"') {
  throw "Update button icon must be slightly larger with a lighter stroke."
}

$main = Get-Content -LiteralPath (Join-Path $root "payload\src\main\menu-localizer.js") -Raw
if ($main -notmatch 'ipcMain\.handle\("figboost:open-feature-menu"' -or $main -notmatch "Menu\.buildFromTemplate\(buildFigBoostFeatureMenuTemplate\(\)\)" -or $main -notmatch 'label: "检查更新"') {
  throw "Main process must expose a native FigBoost feature menu."
}
if ($main -notmatch "findOwnerWindowForWebContents" -or $main -notmatch "window\.getBrowserViews\(\)" -or $main -notmatch "BrowserWindow\.getFocusedWindow\(\)" -or $main -notmatch "normalizeFigBoostMenuBounds" -or $main -notmatch "popupOptions\.x = point\.x" -or $main -notmatch "__FIGBOOST_ACTIVE_FEATURE_MENUS__" -or $main -notmatch "__FIGBOOST_OPEN_FEATURE_MENU__ = openFigBoostFeatureMenu" -or $main -notmatch "menu\.popup\(popupOptions\)") {
  throw "Native FigBoost feature menu must bind to the owning BrowserWindow and button position."
}
if ($main -notmatch "parseFigBoostMenuBoundsFromUrl" -or $main -notmatch "openMenu\(contents, parseFigBoostMenuBoundsFromUrl\(url\)\)") {
  throw "Native FigBoost feature menu fallback URL must keep the button position."
}
if ($main -notmatch "dispatchFeatureMenuClosed" -or $main -notmatch "figboost:feature-menu-closed" -or $main -notmatch "if \(sender\) dispatchFeatureMenuClosed\(sender\)") {
  throw "Native FigBoost feature menu must notify the renderer when the popup closes."
}

$core = Get-Content -LiteralPath (Join-Path $root "payload\src\content\localizer-core.js") -Raw
if ($core -notmatch "MAX_TRANSLATION_CACHE_SIZE") {
  throw "Translation cache must have a bounded size."
}
if ($core -notmatch "cache\.delete\(cache\.keys\(\)\.next\(\)\.value\)") {
  throw "Translation cache must evict the oldest entry at the size limit."
}

Write-Host "All tests passed."
