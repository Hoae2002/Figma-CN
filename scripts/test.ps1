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

$figBoost = Get-Content -LiteralPath (Join-Path $root "src\FigBoost.ps1") -Raw
$version = (Get-Content -LiteralPath (Join-Path $root "VERSION") -Raw).Trim()
$build = Get-Content -LiteralPath (Join-Path $root "scripts\build.ps1") -Raw
if ($figBoost -notmatch "\`$PatcherVersion = `"$([regex]::Escape($version))`"" -or $build -notmatch "\[string\]\`$Version = `"$([regex]::Escape($version))`"") {
  throw "Patcher version must stay consistent across src, build script, and VERSION."
}
if (-not $build.Contains("-noConsole") -or -not $build.Contains("-noOutput")) {
  throw "FigBoost.exe must be built without a console window."
}
if (-not $figBoost.Contains('Join-Path $env:LOCALAPPDATA "FigBoost"') -or -not $figBoost.Contains('Add-Content -LiteralPath (Join-Path $logDir "FigBoost.log")')) {
  throw "GUI logs must go to a file instead of opening or writing to a console window."
}
if (-not $figBoost.Contains('$Host.Name -eq "ConsoleHost"') -or -not $figBoost.Contains('Write-Log "Self-test passed."')) {
  throw "Compiled command-mode logs must not be shown as no-console message boxes."
}
if (-not $figBoost.Contains("function Test-IsWindows11OrNewer") -or -not $figBoost.Contains("HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion") -or -not $figBoost.Contains("CurrentBuildNumber") -or -not $figBoost.Contains("[Environment]::OSVersion.Version.Build -ge 22000") -or -not $figBoost.Contains('$isWindows11OrNewer') -or -not $figBoost.Contains('if ($isWindows11OrNewer)')) {
  throw "Main GUI must keep Windows 11 layout changes behind a Windows 11 build check."
}
if (-not $figBoost.Contains('$form.Width = 900') -or -not $figBoost.Contains('$form.Height = 650') -or -not $figBoost.Contains('$form.MinimumSize = New-Object System.Drawing.Size(860, 630)') -or -not $figBoost.Contains('$btnStatus.Top = 350')) {
  throw "Windows 10 default layout dimensions must remain unchanged."
}
if (-not $figBoost.Contains('$form.Width = 1000') -or -not $figBoost.Contains('$form.Height = 700') -or -not $figBoost.Contains('$currentGroup.Height = 104') -or -not $figBoost.Contains('$btnInstall.Width = 150') -or -not $figBoost.Contains('$btnFeatureManager.Width = 190') -or -not $figBoost.Contains('$form.StartPosition = "Manual"') -or -not $figBoost.Contains('[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea')) {
  throw "Windows 11 layout must use roomier dimensions and button widths."
}
if (-not $figBoost.Contains("https://api.github.com/repos/Hoae2002/Figma-CN/releases/latest") -or -not $figBoost.Contains('$PatcherReleaseAssetName = "FigBoost.exe"') -or -not $figBoost.Contains("function Get-LatestPatcherRelease") -or -not $figBoost.Contains("browser_download_url") -or -not $figBoost.Contains("function Check-PatcherUpdate") -or -not $figBoost.Contains('Compare-VersionString $release.Version $CurrentVersion') -or -not $figBoost.Contains("function Invoke-PatcherSelfUpdate") -or -not $figBoost.Contains('$currentExeLiteral = $currentExe.Replace') -or -not $figBoost.Contains('Copy-Item -LiteralPath ''$tempExeLiteral'' -Destination ''$currentExeLiteral'' -Force') -or -not $figBoost.Contains("Prompt-PatcherUpdateIfAvailable")) {
  throw "FigBoost self-update must use GitHub latest release, FigBoost.exe asset, version compare, and post-exit replacement."
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
if ($content -notmatch "getFigBoostBulkExportBridge\(\)" -or $content -notmatch "bulk-export-files" -or $content -notmatch "批量导出画板文件" -or $content -notmatch "visible: \(\) => Boolean\(getFigBoostBulkExportBridge\(\)") {
  throw "Update button fallback menu must expose batch file export."
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
if ($content -notmatch "result && result\.ok === false" -or $content -notmatch "\.then\(\(result\) =>" -or $content -notmatch "toggleFigBoostMenu\(wrap\);") {
  throw "Update button titlebar click must use the shared DOM menu when native menu opening fails."
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
if ($figBoost -notmatch 'Id = "bulk-export-figma-files"' -or $figBoost -notmatch 'Install-Feature "bulk-export-figma-files"' -or $figBoost -notmatch 'Uninstall-Feature "bulk-export-figma-files"') {
  throw "Feature manager must expose install/uninstall for board scan and batch export."
}
if ($main -notmatch 'figboost:bulk-export-files' -or $main -notmatch '\\u6279\\u91cf\\u5bfc\\u51fa\\u753b\\u677f\\u6587\\u4ef6\.\.\.' -or $main -notmatch "function bulkExportFigmaFiles" -or $main -notmatch "createTimestampExportDir" -or $main -notmatch "showOpenDialog" -or $main -notmatch "failed\.push" -or $main -notmatch 'isFigBoostFeatureEnabled\("bulk-export-figma-files"\)') {
  throw "Native FigBoost feature menu must include batch .fig export with timestamp folder, path selection, and failure summary."
}
if ($main -notmatch "function showBulkExportSelectionWindow" -or $main -notmatch "selectAll" -or $main -notmatch "selectNone" -or $main -notmatch "keys: Array\.from\(selected\)" -or $main -notmatch "getFigmaPageCategory" -or $main -notmatch "projectPath" -or $main -notmatch "collapsed" -or $main -notmatch "\\\\u25b6") {
  throw "Batch .fig export must show a project-categorized selectable file list with select-all and collapse controls."
}
if ($main -notmatch "showInactive" -or $main -notmatch "createFigmaExportContext" -or $main -notmatch "moveExportWindowToBackground" -or $main -notmatch 'postMessageToActiveWebBinding\("' -or $main -notmatch "save-as" -or $main -notmatch "maxPages = 90" -or $main -notmatch "scanTargets") {
  throw "Batch .fig export must reduce foreground disruption, expand scanning, and reuse a background export context."
}
if ($main -match 'https://www\.figma\.com/files/drafts') {
  throw "Batch .fig export scan must not include Drafts pages."
}
if ($main -match 'https://www\.figma\.com/files/recent') {
  throw "Batch .fig export scan must not include Recent pages."
}
if ($main -notmatch "function getFigmaFileBrowserUrlsFromSettings" -or $main -notmatch "settings\.json" -or $main -notmatch "all-projects" -or $main -notmatch "function isFigmaProjectOverviewPage") {
  throw "Batch .fig export scan must use Figma's saved all-projects file browser path and ignore project overview cache links."
}
if ($main -notmatch "function getFigmaTeamIdsFromSettings" -or $main -notmatch "fetchFigmaTeamProjectsAndFilesViaRest" -or $main -notmatch "/v1/teams/" -or $main -notmatch "/v1/projects/" -or $main -notmatch "fetchFigmaTeamProjectsViaLiveGraph" -or $main -notmatch "FileBrowserTeamPageProjectsView" -or $main -notmatch "PaginatedFilesByProjectAndEditorTypeView") {
  throw "Batch .fig export scan must use fast team/project APIs first and fall back to LiveGraph project views."
}
if ($main -notmatch "recents-and-sharing\|deleted\|trash\|community" -or $main -match 'recents-and-sharing\?fuid') {
  throw "Batch .fig export scan must exclude recents-and-sharing and other non-project browser pages."
}
if ($main -notmatch 'editorType === "design" \|\| editorType === 0' -or $main -match 'editorType === undefined \|\| editorType === null \|\| editorType === "design"') {
  throw "Batch .fig export scan must not treat unknown editor types as Figma Design files."
}
if ($main -notmatch "const isDesign = editorType === `"design`" \|\| editorType === 0;" -or $main -notmatch "projectPathFromPage" -or $main -notmatch "collectSnapshot" -or $main -notmatch "for \(let index = 0; index < 14") {
  throw "Batch .fig export fast page scan must accumulate scrolled project/file rows and keep only design files."
}
if ($main -notmatch "function createFigmaScanTarget" -or $main -notmatch "openInBackground: false" -or $main -notmatch "figboost-bulk-scan" -or $main -notmatch "activeJobs" -or $main -notmatch "getFigmaScanTargetWebContents" -or $main -notmatch "scanDeadline" -or $main -notmatch "function isExpectedFigmaScanUrl") {
  throw "Batch .fig export scan must use real Figma background windows and parallel queue workers."
}
if ($main -notmatch "function shouldReadVisibleFigmaPage" -or $main -notmatch "desktop_new_tab" -or $main -notmatch "team_id" -or $main -notmatch "project_id" -or $main -notmatch "webContents\.getAllWebContents\(\)" -or $main -notmatch "shouldReadVisibleFigmaPage\(currentUrl\)" -or $main -notmatch "readFigmaPageLinksFast" -or $main -notmatch "\\u6587\\u4ef6" -or $main -notmatch "elementFromPoint\(point\.x, point\.y\)") {
  throw "Batch .fig export scan must read visible All Projects pages while filtering drafts, recent, and new-tab cache pages."
}
if ($main -notmatch "function waitForDownloadToPath" -or $main -notmatch 'session\.once\("will-download"' -or $main -notmatch "item\.setSavePath\(targetPath\)" -or $main -notmatch "function openFigmaFileInDesktop" -or $main -notmatch "Open File URL From Clipboard" -or $main -notmatch "function withSaveDialogTarget" -or $main -notmatch "dialog\.showSaveDialog = async" -or $main -notmatch "function triggerFigmaSaveLocalCopy" -or $main -notmatch "Save Local Copy" -or $main -match "function findSaveLocalCopyMenuItem" -or $main -match "clickFigmaMainMenu") {
  throw "Batch .fig export must open real Figma tabs, invoke native Save Local Copy, and intercept the save/download path."
}
if ($main -notmatch "findOwnerWindowForWebContents" -or $main -notmatch "window\.getBrowserViews\(\)" -or $main -notmatch "BrowserWindow\.getFocusedWindow\(\)" -or $main -notmatch "normalizeFigBoostMenuBounds" -or $main -notmatch "popupOptions\.x = point\.x" -or $main -notmatch "__FIGBOOST_ACTIVE_FEATURE_MENUS__" -or $main -notmatch "__FIGBOOST_OPEN_FEATURE_MENU__ = openFigBoostFeatureMenu" -or $main -notmatch "menu\.popup\(popupOptions\)") {
  throw "Native FigBoost feature menu must bind to the owning BrowserWindow and button position."
}
if ($main -notmatch "getOwnerBrowserWindow" -or $main -notmatch "figBoostViewOwnsWebContents" -or $main -notmatch "window\.contentView" -or $main -notmatch "webContents\.getFocusedWebContents" -or $main -notmatch "function popupFigBoostFeatureMenu" -or $main -notmatch "menu\.popup\.length > 1" -or $main -notmatch "menu\.popup\(owner, point\.x, point\.y, undefined, onClosed\)") {
  throw "Native FigBoost feature menu must support old Electron popup signatures and newer contentView ownership."
}
if ($main -notmatch "parseFigBoostMenuBoundsFromUrl" -or $main -notmatch "openMenu\(contents, parseFigBoostMenuBoundsFromUrl\(url\)\)") {
  throw "Native FigBoost feature menu fallback URL must keep the button position."
}
if ($main -notmatch "dispatchFeatureMenuClosed" -or $main -notmatch "figboost:feature-menu-closed" -or $main -notmatch "if \(sender\) dispatchFeatureMenuClosed\(sender\)") {
  throw "Native FigBoost feature menu must notify the renderer when the popup closes."
}

if ($main -notmatch "function showOfficialUpdateCheckingWindow" -or $main -notmatch "\\u6b63\\u5728\\u68c0\\u67e5\\u66f4\\u65b0" -or $main -notmatch "const checkingWindow = showOfficialUpdateCheckingWindow\(\)" -or $main -notmatch "checkingWindow\.close\(\)") {
  throw "Manual update check must show and close a checking progress dialog."
}
if ($main -notmatch "const looksLikeOptions" -or $main -notmatch "const optionIndex = looksLikeOptions\(args\[1\]\) \? 1 : 0;") {
  throw "Dialog localization hook must not mistake BrowserWindow arguments for message box options."
}
if ($main -notmatch "useContentSize: true" -or $main -notmatch "autoHideMenuBar: true" -or $main -notmatch "removeMenu" -or $main -notmatch "overflow:hidden") {
  throw "Manual update checking dialog must hide menus and avoid clipped scrollable content."
}
if ($main -notmatch "__FIGBOOST_SKIP_RENDERER_INJECTION__" -or $main -notmatch "if \(contents\.__FIGBOOST_SKIP_RENDERER_INJECTION__\) return;" -or $main -match 'class="icon"' -or $main -match "\.icon\{") {
  throw "Manual update checking dialog must not receive injected buttons or extra body icons."
}

$core = Get-Content -LiteralPath (Join-Path $root "payload\src\content\localizer-core.js") -Raw
if ($core -notmatch "MAX_TRANSLATION_CACHE_SIZE") {
  throw "Translation cache must have a bounded size."
}
if ($core -notmatch "cache\.delete\(cache\.keys\(\)\.next\(\)\.value\)") {
  throw "Translation cache must evict the oldest entry at the size limit."
}

Write-Host "All tests passed."
